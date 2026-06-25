// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { AuthorizedManagers } from "./AuthorizedManagers.sol";
import { ConfidentialCollateralVault } from "./ConfidentialCollateralVault.sol";
import { ConfidentialLendingPool } from "./ConfidentialLendingPool.sol";
import { ConfidentialScoreManager } from "./ConfidentialScoreManager.sol";

/**
 * @title ConfidentialLiquidationEngine
 * @notice Confidential, two-phase liquidation:
 *
 *   1) auditHealth(user)  — computes an encrypted `unhealthy` flag from the user's
 *      confidential collateral and debt, marks it publicly decryptable (allowPublic).
 *      Only the single boolean "is this position liquidatable" is ever revealed — never
 *      the underlying amounts.
 *   2) resolveAudit(user, isUnhealthy, sig) — verifies the MPC-signed reveal with
 *      `FHE.publishDecryptResult`, and if unhealthy, seizes ALL collateral to the pool,
 *      clears the debt, and applies an encrypted credit-score penalty.
 *
 *   The engine is an authorized manager on the vault, pool, and score manager, so it can
 *   read their encrypted handles and trigger the privileged seize/clear/penalty calls.
 */
contract ConfidentialLiquidationEngine is AuthorizedManagers {
    ConfidentialCollateralVault public collateralVault;
    ConfidentialLendingPool public lendingPool;
    ConfidentialScoreManager public scoreManager;

    uint64 public constant LIQUIDATION_THRESHOLD = 125; // 125% — below this, liquidatable

    euint64 private _encHundred;
    euint64 private _encThreshold;

    mapping(address => ebool) private _pendingChecks;
    mapping(address => bool) public isLiquidatable;

    event LiquidationAudited(address indexed user, bytes32 handle);
    event Liquidated(address indexed user, address indexed liquidator);

    constructor(address _vault, address _pool, address _scoreManager) {
        collateralVault = ConfidentialCollateralVault(_vault);
        lendingPool = ConfidentialLendingPool(_pool);
        scoreManager = ConfidentialScoreManager(_scoreManager);
        _encHundred = FHE.asEuint64(100);
        _encThreshold = FHE.asEuint64(uint256(LIQUIDATION_THRESHOLD));
        FHE.allowThis(_encHundred);
        FHE.allowThis(_encThreshold);
    }

    function setVault(address v) external onlyOwner {
        collateralVault = ConfidentialCollateralVault(v);
    }

    function setPool(address p) external onlyOwner {
        lendingPool = ConfidentialLendingPool(p);
    }

    function setScoreManager(address s) external onlyOwner {
        scoreManager = ConfidentialScoreManager(s);
    }

    /// @notice Phase 1: compute and expose the encrypted liquidatable flag.
    function auditHealth(address user) external {
        euint64 collateralRaw = collateralVault.getCollateral(user);
        euint64 debt = lendingPool.getDebt(user);
        require(FHE.isInitialized(debt), "No debt");

        // A position with debt but no collateral reads as zero collateral (=> unhealthy).
        euint64 collateral = FHE.isInitialized(collateralRaw) ? collateralRaw : FHE.asEuint64(0);

        // unhealthy when collateral*100 < debt*threshold
        euint64 weighted = FHE.mul(collateral, _encHundred);
        euint64 thresholdValue = FHE.mul(debt, _encThreshold);
        ebool unhealthy = FHE.lt(weighted, thresholdValue);

        _pendingChecks[user] = unhealthy;
        FHE.allowThis(unhealthy);
        FHE.allowPublic(unhealthy);

        emit LiquidationAudited(user, ebool.unwrap(unhealthy));
    }

    /// @notice Phase 2: verify the reveal and, if unhealthy, liquidate.
    function resolveAudit(address user, bool isUnhealthy, bytes calldata signature) external {
        ebool check = _pendingChecks[user];
        require(FHE.isInitialized(check), "No pending audit");

        // Reverts if the signature does not match (check, isUnhealthy).
        FHE.publishDecryptResult(check, isUnhealthy, signature);
        require(isUnhealthy, "Position healthy");

        isLiquidatable[user] = true;

        // Seize all collateral to the pool, wipe the debt, penalize the score.
        collateralVault.seizeAll(user, address(lendingPool));
        lendingPool.clearDebt(user);
        if (address(scoreManager) != address(0)) {
            scoreManager.recordLiquidation(user);
        }

        // Reset the pending flag.
        ebool cleared = FHE.asEbool(false);
        FHE.allowThis(cleared);
        _pendingChecks[user] = cleared;

        emit Liquidated(user, msg.sender);
    }

    function getPendingHealthCheck(address user) external view returns (ebool) {
        return _pendingChecks[user];
    }
}
