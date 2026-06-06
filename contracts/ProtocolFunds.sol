// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title ProtocolFunds
 * @dev Stores and manages protocol fees collected from loans using Fhenix CoFHE.
 */
contract ProtocolFunds is Ownable {
    mapping(address => euint64) private tokenBalances;
    
    event FundsDeposited(address indexed token);
    event FundsWithdrawn(address indexed token, address indexed to);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Record a deposit of protocol fees (Encrypted).
     */
    function deposit(address token, euint64 amount) external {
        if (FHE.isInitialized(tokenBalances[token])) {
            tokenBalances[token] = FHE.add(tokenBalances[token], amount);
        } else {
            tokenBalances[token] = amount;
        }
        FHE.allowThis(tokenBalances[token]);
        emit FundsDeposited(token);
    }

    /**
     * @dev Withdraw funds (Encrypted check).
     */
    function withdraw(address token, euint64 amount, address to) public onlyOwner {
        euint64 balance = tokenBalances[token];
        ebool hasBalance = FHE.gte(balance, amount);
        euint64 actualAmount = FHE.select(hasBalance, amount, balance);
        
        tokenBalances[token] = FHE.sub(balance, actualAmount);
        FHE.allowThis(tokenBalances[token]);
        
        emit FundsWithdrawn(token, to);
    }

    // Alias for frontend withdrawal calls using packed inputs
    function withdrawFees(address token, InEuint64 calldata encAmount, address to) external onlyOwner {
        euint64 amount = FHE.asEuint64(encAmount);
        withdraw(token, amount, to);
    }

    function getTokenBalance(address token) external view returns (euint64) {
        return tokenBalances[token];
    }
}
