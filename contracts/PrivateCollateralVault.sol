// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title PrivateCollateralVault
 * @notice Confidential collateral management using Fhenix CoFHE
 */
contract PrivateCollateralVault {
    // Mapping of user to their collateral amount (encrypted)
    mapping(address => euint64) private collateralAmounts;

    // Authorization for other protocol contracts (e.g. BorrowManager)
    mapping(address => bool) private authorizedVaultManagers;
    address[] private authorizedManagerList;

    event CollateralDeposited(address indexed user);
    event CollateralWithdrawn(address indexed user);

    /**
     * @notice Authorize a contract to use encrypted collateral handles in FHE operations
     * @param contractAddress The contract to authorize
     */
    function authorizeContract(address contractAddress) external {
        if (!authorizedVaultManagers[contractAddress]) {
            authorizedVaultManagers[contractAddress] = true;
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

    constructor() {}

    /**
     * @notice Deposit collateral privately
     * @param encryptedAmount The encrypted amount handle
     */
    function depositCollateral(InEuint64 calldata encryptedAmount) public {
        euint64 amount = FHE.asEuint64(encryptedAmount);

        euint64 newCollateral;
        if (FHE.isInitialized(collateralAmounts[msg.sender])) {
            newCollateral = FHE.add(collateralAmounts[msg.sender], amount);
        } else {
            newCollateral = amount;
        }
        collateralAmounts[msg.sender] = newCollateral;

        // Access control: grant to this contract, the user, and any authorized managers
        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, msg.sender);
        _grantAuthorizedAccess(newCollateral);

        emit CollateralDeposited(msg.sender);
    }

    // Alias deposit to align with frontend mega prompt
    function deposit(InEuint64 calldata encryptedAmount) external {
        depositCollateral(encryptedAmount);
    }

    /**
     * @notice Withdraw collateral privately
     * @param encryptedAmount The encrypted amount handle
     */
    function withdrawCollateral(InEuint64 calldata encryptedAmount) public {
        euint64 amount = FHE.asEuint64(encryptedAmount);
        
        require(FHE.isInitialized(collateralAmounts[msg.sender]), "No collateral found");
        euint64 currentCollateral = collateralAmounts[msg.sender];

        // Cap withdrawal at current balance (branchless, no underflow)
        ebool hasCollateral = FHE.lte(amount, currentCollateral);
        euint64 amountToSubtract = FHE.select(hasCollateral, amount, currentCollateral);
        
        euint64 newCollateral = FHE.sub(currentCollateral, amountToSubtract);
        collateralAmounts[msg.sender] = newCollateral;

        // Access control: grant to this contract, the user, and any authorized managers
        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, msg.sender);
        _grantAuthorizedAccess(newCollateral);

        emit CollateralWithdrawn(msg.sender);
    }

    // Alias withdraw to align with frontend mega prompt
    function withdraw(InEuint64 calldata encryptedAmount) external {
        withdrawCollateral(encryptedAmount);
    }

    /**
     * @notice Get encrypted collateral amount of the user
     * @param user The user address
     */
    function getCollateralAmount(address user) external view returns (euint64) {
        return collateralAmounts[user];
    }

    // Alias getCollateralHandle to align with frontend mega prompt
    function getCollateralHandle(address user) external view returns (euint64) {
        return collateralAmounts[user];
    }
}
