// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title PrivateLendingPool
 * @notice Confidential asset supply and withdrawal using Fhenix CoFHE
 */
contract PrivateLendingPool {
    // Mapping of user to their supplied amount (encrypted)
    mapping(address => euint64) private suppliedAmounts;

    // Total liquidity in the pool (encrypted)
    euint64 private totalLiquidity;

    address public borrowManager;

    event Supplied(address indexed user);
    event Withdrawn(address indexed user);

    constructor() {
        totalLiquidity = FHE.asEuint64(0);
        FHE.allowThis(totalLiquidity);
    }

    function setBorrowManager(address _borrow) external {
        borrowManager = _borrow;
    }

    /**
     * @notice Supply tokens privately
     * @param encryptedAmount The encrypted amount handle
     */
    function supply(InEuint64 calldata encryptedAmount) external {
        euint64 amount = FHE.asEuint64(encryptedAmount);

        euint64 newSupplied;
        if (FHE.isInitialized(suppliedAmounts[msg.sender])) {
            newSupplied = FHE.add(suppliedAmounts[msg.sender], amount);
        } else {
            newSupplied = amount;
        }
        suppliedAmounts[msg.sender] = newSupplied;

        totalLiquidity = FHE.add(totalLiquidity, amount);

        // Access control
        FHE.allowThis(newSupplied);
        FHE.allow(newSupplied, msg.sender);
        FHE.allowThis(totalLiquidity);

        emit Supplied(msg.sender);
    }

    /**
     * @notice Withdraw tokens privately
     * @param encryptedAmount The encrypted amount handle
     */
    function withdraw(InEuint64 calldata encryptedAmount) external {
        euint64 amount = FHE.asEuint64(encryptedAmount);
        
        require(FHE.isInitialized(suppliedAmounts[msg.sender]), "No balance found");
        euint64 currentBalance = suppliedAmounts[msg.sender];

        ebool hasBalance = FHE.lte(amount, currentBalance);
        euint64 amountToSubtract = FHE.select(hasBalance, amount, currentBalance);

        euint64 newSupplied = FHE.sub(currentBalance, amountToSubtract);
        suppliedAmounts[msg.sender] = newSupplied;
        totalLiquidity = FHE.sub(totalLiquidity, amountToSubtract);

        // Access control
        FHE.allowThis(newSupplied);
        FHE.allow(newSupplied, msg.sender);
        FHE.allowThis(totalLiquidity);

        emit Withdrawn(msg.sender);
    }

    /**
     * @notice Get encrypted supplied amount of the user
     * @param user The user address
     */
    function getSuppliedAmount(address user) external view returns (euint64) {
        return suppliedAmounts[user];
    }

    /**
     * @notice Get total liquidity (only accessible by protocol for now)
     */
    function getTotalLiquidity() external view returns (euint64) {
        return totalLiquidity;
    }
}
