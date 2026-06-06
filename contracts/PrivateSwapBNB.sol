// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { FhenixEthereumConfig } from "@fhevm/solidity/config/FhenixConfig.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PrivateSwapBNB is FhenixEthereumConfig {
    IERC20 public immutable token;
    
    mapping(address => euint64) private encryptedBalances;
    
    event DepositEncrypted(address indexed user);
    event WithdrawEncrypted(address indexed user, uint256 amount);
    event SwapExecuted(address indexed user);
    
    constructor(address _token) {
        token = IERC20(_token);
    }
    
    function depositEncrypted(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        
        euint64 newBalance;
        if (FHE.isInitialized(encryptedBalances[msg.sender])) {
            newBalance = FHE.add(encryptedBalances[msg.sender], amount);
        } else {
            newBalance = amount;
        }
        encryptedBalances[msg.sender] = newBalance;
        
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, msg.sender);
        
        emit DepositEncrypted(msg.sender);
    }
    
    function withdrawEncrypted(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(FHE.isInitialized(encryptedBalances[msg.sender]), "No balance");
        
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 currentBalance = encryptedBalances[msg.sender];
        
        ebool hasBalance = FHE.le(amount, currentBalance);
        euint64 amountToSubtract = FHE.select(hasBalance, amount, currentBalance);
        
        euint64 newBalance = FHE.sub(currentBalance, amountToSubtract);
        encryptedBalances[msg.sender] = newBalance;
        
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, msg.sender);
        
        emit WithdrawEncrypted(msg.sender, 0);
    }
    
    function getEncryptedBalance() external view returns (euint64) {
        return encryptedBalances[msg.sender];
    }
    
    function swapEncrypted(
        externalEuint64 encryptedAmountIn,
        bytes calldata inputProof,
        address targetToken
    ) external {
        require(FHE.isInitialized(encryptedBalances[msg.sender]), "No balance");
        
        euint64 amountIn = FHE.fromExternal(encryptedAmountIn, inputProof);
        euint64 currentBalance = encryptedBalances[msg.sender];
        
        ebool hasBalance = FHE.le(amountIn, currentBalance);
        euint64 amountToSubtract = FHE.select(hasBalance, amountIn, currentBalance);
        
        euint64 newBalance = FHE.sub(currentBalance, amountToSubtract);
        encryptedBalances[msg.sender] = newBalance;
        
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, msg.sender);
        
        emit SwapExecuted(msg.sender);
    }
}
