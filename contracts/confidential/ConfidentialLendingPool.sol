// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, euint32, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { AuthorizedManagers } from "./AuthorizedManagers.sol";
import { ConfidentialToken } from "./ConfidentialToken.sol";
import { ConfidentialCollateralVault } from "./ConfidentialCollateralVault.sol";
import { ConfidentialScoreManager } from "./ConfidentialScoreManager.sol";

/**
 * @title ConfidentialLendingPool
 * @notice A confidential money market for a single borrowable asset (a ConfidentialToken).
 *         Everything — supplied liquidity, per-user debt, totals — is encrypted, and the
 *         pool holds REAL custody of the confidential asset:
 *
 *           supply   : pull cTokens user -> pool (operator), credit encrypted LP balance
 *           withdraw : send cTokens pool -> user, debit encrypted LP balance
 *           borrow   : check encrypted health factor + encrypted credit limit, then
 *                      disburse cTokens pool -> user (real money out), record encrypted debt
 *           repay    : pull cTokens user -> pool, reduce encrypted debt, bump credit score
 *
 *         Borrowing is gated by BOTH:
 *           - collateral health: collateral*100 >= newDebt*COLLATERAL_RATIO
 *           - encrypted credit limit: newDebt <= limit (from ConfidentialScoreManager)
 *         All comparisons are branchless (FHE.select); a failing check disburses 0.
 */
contract ConfidentialLendingPool is AuthorizedManagers {
    ConfidentialToken public immutable asset;
    ConfidentialCollateralVault public collateralVault;
    ConfidentialScoreManager public scoreManager;

    uint64 public constant COLLATERAL_RATIO = 150; // 150% over-collateralization

    mapping(address => euint64) private _supplied;
    mapping(address => euint64) private _debt;
    euint64 private _totalSupplied;
    euint64 private _totalBorrowed;

    // Cached encrypted constants.
    euint64 private _encZero;
    euint64 private _encHundred;
    euint64 private _encRatio;

    event Supplied(address indexed user);
    event Withdrawn(address indexed user);
    event Borrowed(address indexed user);
    event Repaid(address indexed user);
    event DebtCleared(address indexed user);

    constructor(address _asset, address _collateralVault, address _scoreManager) {
        asset = ConfidentialToken(_asset);
        collateralVault = ConfidentialCollateralVault(_collateralVault);
        scoreManager = ConfidentialScoreManager(_scoreManager);

        _encZero = FHE.asEuint64(0);
        _encHundred = FHE.asEuint64(100);
        _encRatio = FHE.asEuint64(uint256(COLLATERAL_RATIO));
        _totalSupplied = FHE.asEuint64(0);
        _totalBorrowed = FHE.asEuint64(0);
        FHE.allowThis(_encZero);
        FHE.allowThis(_encHundred);
        FHE.allowThis(_encRatio);
        FHE.allowThis(_totalSupplied);
        FHE.allowThis(_totalBorrowed);
    }

    // ─────────────────────────────── Admin wiring ────────────────────────────

    function setCollateralVault(address v) external onlyOwner {
        collateralVault = ConfidentialCollateralVault(v);
    }

    function setScoreManager(address s) external onlyOwner {
        scoreManager = ConfidentialScoreManager(s);
    }

    // ─────────────────────────────── Supply side ─────────────────────────────

    /// @notice Supply liquidity. Caller must `asset.setOperator(thisPool, expiry)` first.
    function supply(InEuint64 calldata encAmount) external {
        // Decode the user input HERE (msg.sender == supplier), then hand the handle to
        // the token with transient access.
        euint64 want = FHE.asEuint64(encAmount);
        FHE.allowThis(want);
        FHE.allowTransient(want, address(asset));

        euint64 moved = asset.confidentialTransferFrom(msg.sender, address(this), want);

        euint64 newSupplied = FHE.isInitialized(_supplied[msg.sender])
            ? FHE.add(_supplied[msg.sender], moved)
            : moved;
        _supplied[msg.sender] = newSupplied;
        _totalSupplied = FHE.add(_totalSupplied, moved);

        FHE.allowThis(newSupplied);
        FHE.allow(newSupplied, msg.sender);
        FHE.allowThis(_totalSupplied);

        emit Supplied(msg.sender);
    }

    /// @notice Withdraw supplied liquidity (capped at the user's supplied balance).
    function withdraw(InEuint64 calldata encAmount) external {
        require(FHE.isInitialized(_supplied[msg.sender]), "No supply");
        euint64 current = _supplied[msg.sender];
        euint64 want = FHE.asEuint64(encAmount);

        ebool hasEnough = FHE.lte(want, current);
        euint64 actual = FHE.select(hasEnough, want, current);

        euint64 newSupplied = FHE.sub(current, actual);
        _supplied[msg.sender] = newSupplied;
        _totalSupplied = FHE.sub(_totalSupplied, actual);

        FHE.allowThis(actual);
        FHE.allowTransient(actual, address(asset));
        asset.confidentialTransfer(msg.sender, actual);

        FHE.allowThis(newSupplied);
        FHE.allow(newSupplied, msg.sender);
        FHE.allowThis(_totalSupplied);

        emit Withdrawn(msg.sender);
    }

    // ─────────────────────────────── Borrow side ─────────────────────────────

    /// @notice Borrow against confidential collateral + encrypted credit limit.
    ///         Disburses real cTokens to the borrower; 0 if either check fails.
    function borrow(InEuint64 calldata encAmount) external {
        euint64 requested = FHE.asEuint64(encAmount);

        euint64 currentDebt = _initializedOr(_debt[msg.sender]);
        euint64 collateral = _readCollateral(msg.sender);
        euint64 limit = _readLimit(msg.sender);

        euint64 newDebt = FHE.add(currentDebt, requested);

        // Collateral health: collateral*100 >= newDebt*ratio
        euint64 weightedCollateral = FHE.mul(collateral, _encHundred);
        euint64 requiredCollateral = FHE.mul(newDebt, _encRatio);
        ebool healthy = FHE.gte(weightedCollateral, requiredCollateral);

        // Credit limit: newDebt <= limit
        ebool withinLimit = FHE.lte(newDebt, limit);

        // Both must pass (branchless AND via select).
        ebool approved = FHE.select(healthy, withinLimit, FHE.asEbool(false));
        euint64 amountOut = FHE.select(approved, requested, _encZero);

        // Disburse real tokens; the token zero-replaces if the pool is short on liquidity.
        FHE.allowThis(amountOut);
        FHE.allowTransient(amountOut, address(asset));
        euint64 moved = asset.confidentialTransfer(msg.sender, amountOut);

        // Debt reflects what was actually disbursed.
        euint64 finalDebt = FHE.add(currentDebt, moved);
        _debt[msg.sender] = finalDebt;
        _totalBorrowed = FHE.add(_totalBorrowed, moved);

        FHE.allowThis(finalDebt);
        FHE.allow(finalDebt, msg.sender);
        _grantManagers(finalDebt); // liquidation engine reads debt
        FHE.allowThis(_totalBorrowed);

        emit Borrowed(msg.sender);
    }

    /// @notice Repay debt. Caller must `asset.setOperator(thisPool, expiry)` first.
    ///         A successful (non-zero) repayment bumps the encrypted credit score.
    function repay(InEuint64 calldata encAmount) external {
        require(FHE.isInitialized(_debt[msg.sender]), "No debt");
        euint64 currentDebt = _debt[msg.sender];
        euint64 requested = FHE.asEuint64(encAmount);

        // Never collect more than is owed.
        ebool overpaying = FHE.gt(requested, currentDebt);
        euint64 capped = FHE.select(overpaying, currentDebt, requested);
        FHE.allowThis(capped);
        FHE.allowTransient(capped, address(asset));

        // Pull the real tokens (token caps again by the user's balance).
        euint64 moved = asset.confidentialTransferFrom(msg.sender, address(this), capped);

        euint64 newDebt = FHE.sub(currentDebt, moved);
        _debt[msg.sender] = newDebt;
        _totalBorrowed = FHE.sub(_totalBorrowed, moved);

        FHE.allowThis(newDebt);
        FHE.allow(newDebt, msg.sender);
        _grantManagers(newDebt);
        FHE.allowThis(_totalBorrowed);

        // Reward on-time repayment with an encrypted score bump (pool is authorized on the score manager).
        if (address(scoreManager) != address(0)) {
            scoreManager.recordRepayment(msg.sender);
        }

        emit Repaid(msg.sender);
    }

    /// @notice Clear a user's debt to 0. Only an authorized manager (liquidation engine).
    function clearDebt(address user) external onlyAuthorized {
        euint64 zero = FHE.asEuint64(0);
        _debt[user] = zero;
        FHE.allowThis(zero);
        FHE.allow(zero, user);
        _grantManagers(zero);
        emit DebtCleared(user);
    }

    // ─────────────────────────────────  Views  ───────────────────────────────

    function getSupplied(address user) external view returns (euint64) {
        return _supplied[user];
    }

    function getDebt(address user) external view returns (euint64) {
        return _debt[user];
    }

    function getTotalSupplied() external view returns (euint64) {
        return _totalSupplied;
    }

    function getTotalBorrowed() external view returns (euint64) {
        return _totalBorrowed;
    }

    // ────────────────────────────── Internals ────────────────────────────────

    /// @dev Return the handle if initialized, otherwise the cached encrypted zero.
    function _initializedOr(euint64 handle) internal view returns (euint64) {
        return FHE.isInitialized(handle) ? handle : _encZero;
    }

    function _readCollateral(address user) internal view returns (euint64) {
        euint64 c = collateralVault.getCollateral(user);
        return FHE.isInitialized(c) ? c : _encZero;
    }

    /// @dev Credit limit; uninitialized (no score) => 0 limit (cannot borrow on credit).
    function _readLimit(address user) internal view returns (euint64) {
        euint64 l = scoreManager.getEncryptedLimit(user);
        return FHE.isInitialized(l) ? l : _encZero;
    }
}
