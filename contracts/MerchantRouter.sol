// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoolManager.sol";
import "./LoanEngine.sol";
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {FhenixEthereumConfig} from "@fhevm/solidity/config/FhenixConfig.sol";

/**
 * @title MerchantRouter
 * @dev Routes payments to merchants privately using Fhenix FHEVM.
 */
contract MerchantRouter is Ownable, FhenixEthereumConfig {
    PoolManager public poolManager;
    LoanEngine public loanEngine;

    // Merchant balances (Encrypted)
    mapping(address => mapping(address => euint64)) private merchantBalances;

    event MerchantPaid(address indexed customer, address indexed merchant, address indexed token);
    event MerchantWithdrawn(address indexed merchant, address indexed token);

    constructor(address _poolManager, address _loanEngine) Ownable(msg.sender) {
        poolManager = PoolManager(_poolManager);
        loanEngine = LoanEngine(_loanEngine);
    }

    /**
     * @dev Customer pays a merchant using their credit line (Encrypted).
     */
    function payWithCredit(address merchant, address tokenOnSource, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        
        // 1. Create a loan for the customer (msg.sender)
        loanEngine.createLoan(msg.sender, encryptedAmount, inputProof, tokenOnSource);

        // 2. Crediting the merchant
        if (FHE.isInitialized(merchantBalances[merchant][tokenOnSource])) {
            merchantBalances[merchant][tokenOnSource] = FHE.add(merchantBalances[merchant][tokenOnSource], amount);
        } else {
            merchantBalances[merchant][tokenOnSource] = amount;
        }

        // Allow merchant to see their balance
        FHE.allow(merchantBalances[merchant][tokenOnSource], merchant);
        FHE.allowThis(merchantBalances[merchant][tokenOnSource]);

        emit MerchantPaid(msg.sender, merchant, tokenOnSource);
    }

    /**
     * @dev Merchant withdraws their earned funds (Encrypted).
     */
    function merchantWithdraw(address tokenOnSource, externalEuint64 encryptedAmount, bytes calldata inputProof, uint64 destChainId) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 balance = merchantBalances[msg.sender][tokenOnSource];
        
        ebool hasBalance = FHE.ge(balance, amount);
        euint64 actualAmount = FHE.select(hasBalance, amount, balance);
        
        merchantBalances[msg.sender][tokenOnSource] = FHE.sub(balance, actualAmount);
        FHE.allow(merchantBalances[msg.sender][tokenOnSource], msg.sender);
        FHE.allowThis(merchantBalances[msg.sender][tokenOnSource]);
        
        // Relies on PoolManager to authorize withdrawal. 
        // We pass the encrypted amount to PoolManager.
        // PoolManager will decrypt it for the bridge event.
        poolManager.requestWithdrawal(tokenOnSource, encryptedAmount, inputProof, destChainId);

        emit MerchantWithdrawn(msg.sender, tokenOnSource);
    }

    function getMerchantBalance(address merchant, address token) external view returns (euint64) {
        return merchantBalances[merchant][token];
    }
}

