// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { PrivateCollateralVault } from "./PrivateCollateralVault.sol";

/**
 * @title PrivateBorrowManager
 * @notice Confidential debt management using Fhenix CoFHE
 */
contract PrivateBorrowManager {
    PrivateCollateralVault public collateralVault;
    address public lendingPool;

    // Mapping of user to their debt amount (encrypted)
    mapping(address => euint64) private debtAmounts;

    // Authorization for other protocol contracts (e.g. LiquidationEngine)
    mapping(address => bool) private authorizedManagers;
    address[] private authorizedManagerList;

    // Config: Fixed collateral requirement ratio of 1.5x (150%)
    uint64 constant COLLATERAL_RATIO = 150;

    event Borrowed(address indexed user);
    event Repaid(address indexed user);
    event DecryptionRequested(address indexed user, bytes32 handle);
    event DebtProfileRevealed(address indexed user, uint64 cleartextDebt);

    constructor(address _collateralVault) {
        collateralVault = PrivateCollateralVault(_collateralVault);
    }

    function setLendingPool(address _lendingPool) external {
        lendingPool = _lendingPool;
    }

    function setCollateralVault(address _vault) external {
        collateralVault = PrivateCollateralVault(_vault);
    }

    /**
     * @notice Authorize a contract to use encrypted debt handles in FHE operations
     * @param contractAddress The contract to authorize
     */
    function authorizeContract(address contractAddress) external {
        if (!authorizedManagers[contractAddress]) {
            authorizedManagers[contractAddress] = true;
            authorizedManagerList.push(contractAddress);
        }
    }

    /**
     * @dev Grant FHE access to all authorized managers for a given handle
     */
    function _grantAuthorizedAccess(euint64 handle) internal {
        for (uint256 i = 0; i < authorizedManagerList.length; i++) {
            FHE.allow(handle, authorizedManagerList[i]);
        }
    }

    /**
     * @notice Borrow tokens privately
     * @param encryptedAmount The encrypted amount handle
     */
    function borrow(InEuint64 calldata encryptedAmount) external {
        euint64 amountToBorrow = FHE.asEuint64(encryptedAmount);
        
        euint64 currentDebt;
        if (FHE.isInitialized(debtAmounts[msg.sender])) {
            currentDebt = debtAmounts[msg.sender];
        } else {
            currentDebt = FHE.asEuint64(0);
        }
        
        euint64 collateral = collateralVault.getCollateralAmount(msg.sender);

        // Calculate new debt
        euint64 newDebt = FHE.add(currentDebt, amountToBorrow);

        // Check health factor: collateral * 100 >= newDebt * 150
        euint64 weightedCollateral = FHE.mul(collateral, FHE.asEuint64(100));
        euint64 requiredCollateral = FHE.mul(newDebt, FHE.asEuint64(COLLATERAL_RATIO));

        ebool isHealthy = FHE.gte(weightedCollateral, requiredCollateral);

        // Only update debt if it's healthy (branchless)
        euint64 finalizedDebt = FHE.select(isHealthy, newDebt, currentDebt);
        debtAmounts[msg.sender] = finalizedDebt;

        // Access control
        FHE.allowThis(finalizedDebt);
        FHE.allow(finalizedDebt, msg.sender);
        _grantAuthorizedAccess(finalizedDebt);

        emit Borrowed(msg.sender);
    }

    /**
     * @notice Repay tokens privately
     * @param encryptedAmount The encrypted amount handle
     */
    function repay(InEuint64 calldata encryptedAmount) external {
        euint64 amountToRepay = FHE.asEuint64(encryptedAmount);
        
        require(FHE.isInitialized(debtAmounts[msg.sender]), "No debt found");
        euint64 currentDebt = debtAmounts[msg.sender];

        ebool hasDebt = FHE.lte(amountToRepay, currentDebt);
        euint64 amountToSubtract = FHE.select(hasDebt, amountToRepay, currentDebt);

        euint64 newDebt = FHE.sub(currentDebt, amountToSubtract);
        debtAmounts[msg.sender] = newDebt;

        // Access control
        FHE.allowThis(newDebt);
        FHE.allow(newDebt, msg.sender);
        _grantAuthorizedAccess(newDebt);

        emit Repaid(msg.sender);
    }

    /**
     * @notice Get encrypted debt amount of the user
     * @param user The user address
     */
    function getDebtAmount(address user) external view returns (euint64) {
        return debtAmounts[user];
    }

    // Alias getDebtHandle to align with potential frontend usages
    function getDebtHandle(address user) external view returns (euint64) {
        return debtAmounts[user];
    }

    // Two-step decryption/reveal flow for debt management
    function requestPublicDebt(address user) external {
        euint64 debt = debtAmounts[user];
        FHE.allowPublic(debt);
        emit DecryptionRequested(user, euint64.unwrap(debt));
    }

    function finalizePublicDebt(
        address user,
        uint64 cleartextDebt,
        bytes calldata signature
    ) external {
        euint64 debt = debtAmounts[user];
        FHE.publishDecryptResult(debt, cleartextDebt, signature);
        emit DebtProfileRevealed(user, cleartextDebt);
    }
}
