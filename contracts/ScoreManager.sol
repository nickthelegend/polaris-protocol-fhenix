// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoolManager.sol";
import "./CreditOracle.sol";
import {FHE, euint64, euint32, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {FhenixEthereumConfig} from "@fhevm/solidity/config/FhenixConfig.sol";

/**
 * @title ScoreManager
 * @dev Manages user credit scores and calculates dynamic borrowing limits using Fhenix FHEVM.
 */
contract ScoreManager is Ownable, FhenixEthereumConfig {
    PoolManager public poolManager;
    CreditOracle public creditOracle;

    // Minimum score starts at 300 (Like FICO)
    uint32 public constant MIN_SCORE = 300;
    uint32 public constant MAX_SCORE = 850;

    // user => score (Encrypted)
    mapping(address => euint32) private scores;
    // user => totalRepaid (Encrypted)
    mapping(address => euint64) private totalRepaidMap;

    event ScoreUpdated(address indexed user, uint32 newScore, string reason);
    event OracleUpdated(address indexed newOracle);

    constructor(address _poolManager, address _creditOracle) Ownable(msg.sender) {
        poolManager = PoolManager(_poolManager);
        creditOracle = CreditOracle(_creditOracle);
    }

    /**
     * @dev Gets the user's current credit score (Encrypted).
     */
    function getScore(address user) public returns (euint32) {
        if (!FHE.isInitialized(scores[user])) return FHE.asEuint32(uint32(MIN_SCORE));
        return scores[user];
    }

    /**
     * @dev Updates user score based on behavior (Encrypted delta).
     */
    function updateScore(address user, int32 delta, string memory reason) public onlyOwner {
        euint32 current = getScore(user);
        euint32 newScore;
        
        if (delta >= 0) {
            newScore = FHE.add(current, uint32(delta));
            // Cap at MAX_SCORE
            ebool isOver = FHE.gt(newScore, FHE.asEuint32(uint32(MAX_SCORE)));
            newScore = FHE.select(isOver, FHE.asEuint32(uint32(MAX_SCORE)), newScore);
        } else {
            uint32 absDelta = uint32(-delta);
            ebool canSub = FHE.gt(current, FHE.asEuint32(uint32(absDelta + MIN_SCORE)));
            newScore = FHE.select(canSub, FHE.sub(current, absDelta), FHE.asEuint32(uint32(MIN_SCORE)));
        }

        FHE.allowThis(current);
        scores[user] = newScore;
        FHE.allow(newScore, user);
        FHE.allow(newScore, msg.sender);
        FHE.allowThis(newScore);
        
        emit ScoreUpdated(user, 0, reason); // Score value is private
    }

    function recordRepayment(address user, euint64 amount) external onlyOwner {
        if (FHE.isInitialized(totalRepaidMap[user])) {
            totalRepaidMap[user] = FHE.add(totalRepaidMap[user], amount);
        } else {
            totalRepaidMap[user] = amount;
        }
        FHE.allow(totalRepaidMap[user], user);
        FHE.allow(totalRepaidMap[user], msg.sender);
        FHE.allowThis(totalRepaidMap[user]);
        
        // Activity bonus: +5 points
        updateScore(user, 5, "Repayment Bonus");
    }

    function setCreditOracle(address _creditOracle) external onlyOwner {
        creditOracle = CreditOracle(_creditOracle);
        emit OracleUpdated(_creditOracle);
    }

    /**
     * @dev Calculates the max borrow amount for a user (Encrypted).
     * Formula: (Total Native Collateral + External Net Value) * (Score / 1000).
     */
    function getCreditLimit(address user) public returns (euint64) {
        euint64 nativeCollateral = poolManager.getUserTotalCollateral(user);
        
        // Get encrypted net value from external sources
        (euint64 externalNetValue, ebool isPositive) = creditOracle.getEncryptedNetValue(user);
        
        euint64 totalEffectiveCollateral;
        // if (isPositive) total = native + external else total = native - external (clamped at 0)
        euint64 sum = FHE.add(nativeCollateral, externalNetValue);
        
        ebool canSub = FHE.gt(nativeCollateral, externalNetValue);
        euint64 diff = FHE.select(canSub, FHE.sub(nativeCollateral, externalNetValue), FHE.asEuint64(0));
        
        totalEffectiveCollateral = FHE.select(isPositive, sum, diff);

        euint32 score = getScore(user);
        
        // Multiplier: Score / 1000
        // (totalEffectiveCollateral * score) / 1000
        euint64 limit = FHE.div(FHE.mul(totalEffectiveCollateral, FHE.asEuint64(score)), 1000);
        FHE.allow(limit, user);
        FHE.allow(limit, msg.sender); // Allow LoanEngine
        FHE.allowThis(limit);
        return limit;
    }
}


