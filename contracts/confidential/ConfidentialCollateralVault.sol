// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { AuthorizedManagers } from "./AuthorizedManagers.sol";
import { ConfidentialToken } from "./ConfidentialToken.sol";

/**
 * @title ConfidentialCollateralVault
 * @notice Confidential collateral custody. Unlike the previous version, deposits move
 *         REAL confidential tokens into the vault via `confidentialTransferFrom` (the
 *         user grants the vault a short operator window first). The encrypted collateral
 *         balance therefore actually backs real custodied tokens.
 *
 *         Authorized managers (the lending pool + liquidation engine) are granted ACL
 *         access to each user's collateral handle so they can compute health factors.
 */
contract ConfidentialCollateralVault is AuthorizedManagers {
    ConfidentialToken public immutable collateralToken;

    mapping(address => euint64) private _collateral;

    event CollateralDeposited(address indexed user);
    event CollateralWithdrawn(address indexed user);
    event CollateralSeized(address indexed user, address indexed to);

    constructor(address _collateralToken) {
        collateralToken = ConfidentialToken(_collateralToken);
    }

    /**
     * @notice Deposit collateral. The caller must first call
     *         `collateralToken.setOperator(thisVault, expiry)` so the vault can pull funds.
     * @param encAmount Encrypted deposit amount (InEuint64).
     */
    function deposit(InEuint64 calldata encAmount) external {
        // Decode the user input HERE (msg.sender == the depositor, so the input proof
        // verifies), then hand the resulting handle to the token with transient access.
        euint64 want = FHE.asEuint64(encAmount);
        FHE.allowThis(want);
        FHE.allowTransient(want, address(collateralToken));

        // Real custody: pull min(want, userBalance) confidential tokens into the vault.
        euint64 moved = collateralToken.confidentialTransferFrom(msg.sender, address(this), want);

        euint64 newCollateral = FHE.isInitialized(_collateral[msg.sender])
            ? FHE.add(_collateral[msg.sender], moved)
            : moved;
        _collateral[msg.sender] = newCollateral;

        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, msg.sender);
        _grantManagers(newCollateral);

        emit CollateralDeposited(msg.sender);
    }

    /**
     * @notice Withdraw collateral back to the caller (capped at their balance, branchless).
     * @dev Does not itself enforce solvency — the lending pool/liquidation engine gate risk.
     */
    function withdraw(InEuint64 calldata encAmount) external {
        require(FHE.isInitialized(_collateral[msg.sender]), "No collateral");
        euint64 current = _collateral[msg.sender];
        euint64 want = FHE.asEuint64(encAmount);

        ebool hasEnough = FHE.lte(want, current);
        euint64 actual = FHE.select(hasEnough, want, current);

        euint64 newCollateral = FHE.sub(current, actual);
        _collateral[msg.sender] = newCollateral;

        // Return the real tokens. Grant the token transient access so it can compute on `actual`.
        FHE.allowThis(actual);
        FHE.allowTransient(actual, address(collateralToken));
        collateralToken.confidentialTransfer(msg.sender, actual);

        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, msg.sender);
        _grantManagers(newCollateral);

        emit CollateralWithdrawn(msg.sender);
    }

    /**
     * @notice Seize a user's entire collateral to `to`. Only callable by an authorized
     *         manager (the liquidation engine), after a public health reveal.
     * @return seized The encrypted amount moved.
     */
    function seizeAll(address user, address to) external onlyAuthorized returns (euint64 seized) {
        require(FHE.isInitialized(_collateral[user]), "No collateral");
        seized = _collateral[user];
        FHE.allowThis(seized);
        FHE.allowTransient(seized, address(collateralToken));

        // Move the custodied tokens to the recipient (e.g. the lending pool).
        collateralToken.confidentialTransfer(to, seized);

        euint64 zero = FHE.asEuint64(0);
        _collateral[user] = zero;
        FHE.allowThis(zero);
        FHE.allow(zero, user);
        _grantManagers(zero);

        emit CollateralSeized(user, to);
    }

    function getCollateral(address user) external view returns (euint64) {
        return _collateral[user];
    }
}
