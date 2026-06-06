// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title LiquidityVault
 * @dev Deployed on source chains (Sepolia, Base, etc.)
 * Accepts stablecoin deposits and locks them for Polaris protocol.
 * Releases funds based on authorized validator signatures (Reverse Bridge).
 */
contract LiquidityVault is ReentrancyGuard, Ownable, EIP712 {
    using SafeERC20 for IERC20;

    address public validator;
    mapping(bytes32 => bool) public withdrawalProcessed;
    mapping(address => bool) public whitelistedTokens;
    uint256 public depositNonce;

    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(address user,address token,uint256 amount,uint256 nonce)"
    );

    event LiquidityDeposited(address indexed lender, address indexed token, uint256 amount, uint256 depositId);
    event LiquidityReleased(address indexed user, address indexed token, uint256 amount, uint256 nonce);
    event TokenWhitelistStatusChanged(address indexed token, bool status);
    event ValidatorUpdated(address indexed newValidator);

    constructor(address _validator) Ownable(msg.sender) EIP712("Polaris_LiquidityVault", "1.0.0") {
        validator = _validator;
    }

    function setValidator(address _validator) external onlyOwner {
        validator = _validator;
        emit ValidatorUpdated(_validator);
    }

    function setTokenWhitelist(address token, bool status) external onlyOwner {
        whitelistedTokens[token] = status;
        emit TokenWhitelistStatusChanged(token, status);
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        require(whitelistedTokens[token], "Token not whitelisted");
        require(amount > 0, "Amount must be greater than 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 depositId = depositNonce++;
        emit LiquidityDeposited(msg.sender, token, amount, depositId);
    }

    /**
     * @dev Releases funds on source chain using a signature from the protocol validator.
     * This replaces the Mock Prover for a production-ready Relayer-based security model.
     */
    function completeWithdrawal(
        address user,
        address token,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 withdrawalId = keccak256(abi.encodePacked(user, token, amount, nonce));
        require(!withdrawalProcessed[withdrawalId], "Withdrawal already processed");

        // Verify EIP-712 Signature
        bytes32 structHash = keccak256(abi.encode(WITHDRAWAL_TYPEHASH, user, token, amount, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        
        address recoveredAddress = ECDSA.recover(digest, signature);
        require(recoveredAddress == validator, "Invalid validator signature");

        withdrawalProcessed[withdrawalId] = true;
        IERC20(token).safeTransfer(user, amount);

        emit LiquidityReleased(user, token, amount, nonce);
    }

    // Emergency withdraw for owner in case of issues
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
