// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { PrivateCollateralVault } from "./PrivateCollateralVault.sol";
import { PrivateBorrowManager } from "./PrivateBorrowManager.sol";

/**
 * @title PrivateLiquidationEngine
 * @notice Confidential liquidation logic using Fhenix CoFHE
 */
contract PrivateLiquidationEngine {
    PrivateCollateralVault public collateralVault;
    PrivateBorrowManager public borrowManager;

    // Liquidation threshold (lower than borrow ratio, e.g. 1.25x)
    uint64 constant LIQUIDATION_THRESHOLD = 125;

    // Store the pending health check handle per user
    mapping(address => ebool) private pendingHealthChecks;

    // Track if a user is currently under liquidation (revealed)
    mapping(address => bool) public isLiquidatable;

    event LiquidationStarted(address indexed user);
    event Liquidated(address indexed user, address indexed liquidator);

    constructor(address _collateralVault, address _borrowManager) {
        collateralVault = PrivateCollateralVault(_collateralVault);
        borrowManager = PrivateBorrowManager(_borrowManager);
    }

    function setBorrowManager(address _borrow) external {
        borrowManager = PrivateBorrowManager(_borrow);
    }

    function setCollateralVault(address _vault) external {
        collateralVault = PrivateCollateralVault(_vault);
    }

    /**
     * @notice Get the pending health check handle for a user (for testing/resolving)
     * @param user The user address
     */
    function getPendingHealthCheck(address user) external view returns (ebool) {
        return pendingHealthChecks[user];
    }

    /**
     * @notice Check health factor and request public decryption
     * @param user The user address to audit
     */
    function auditHealth(address user) external {
        euint64 collateral = collateralVault.getCollateralAmount(user);
        euint64 debt = borrowManager.getDebtAmount(user);

        // Under threshold: collateral * 100 < debt * LIQUIDATION_THRESHOLD
        euint64 weightedCollateral = FHE.mul(collateral, FHE.asEuint64(100));
        euint64 thresholdCollateral = FHE.mul(debt, FHE.asEuint64(LIQUIDATION_THRESHOLD));

        ebool isUnhealthy = FHE.lt(weightedCollateral, thresholdCollateral);

        pendingHealthChecks[user] = isUnhealthy;
        FHE.allowThis(isUnhealthy);
        FHE.allowPublic(isUnhealthy);

        emit LiquidationStarted(user);
    }

    /**
     * @notice Resolve audit with KMS decryption proof
     * @param user The user address to liquidate
     * @param isUnhealthy Decrypted health status (true if unhealthy)
     * @param signature KMS decryption signature
     */
    function resolveAudit(
        address user,
        bool isUnhealthy,
        bytes calldata signature
    ) external {
        ebool check = pendingHealthChecks[user];
        require(FHE.isInitialized(check), "No pending audit");

        FHE.publishDecryptResult(check, isUnhealthy, signature);

        require(isUnhealthy, "User is healthy, cannot liquidate");

        isLiquidatable[user] = true;
        
        ebool cleared = FHE.asEbool(false);
        FHE.allowThis(cleared);
        pendingHealthChecks[user] = cleared;

        emit Liquidated(user, msg.sender);
    }
}
