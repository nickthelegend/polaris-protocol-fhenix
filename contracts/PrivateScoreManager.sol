// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title PrivateScoreManager
 * @notice Confidential credit score AND credit limit using Fhenix CoFHE.
 *         Both values are encrypted on-chain — only the user can decrypt.
 */
contract PrivateScoreManager {

    uint64 public constant MIN_SCORE = 300;
    uint64 public constant MAX_SCORE = 850;
    uint64 public constant REPAYMENT_BONUS = 5;
    uint64 public constant LIQUIDATION_PENALTY = 50;

    mapping(address => euint64) private encryptedScores;
    mapping(address => euint64) private encryptedLimits;
    mapping(address => bool) public isInitialized;
    mapping(address => bool) public authorizedCallers;
    address public owner;

    event ScoreInitialized(address indexed user);
    event RepaymentRecorded(address indexed user);
    event LiquidationRecorded(address indexed user);
    event LimitUpdated(address indexed user);
    event CallerAuthorized(address indexed caller);
    event OwnershipTransferred(address indexed prev, address indexed next_);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyAuthorized() { require(authorizedCallers[msg.sender] || msg.sender == owner, "Not authorized"); _; }

    constructor() { owner = msg.sender; }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    
    function authorizeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    // ── Score Logic ────────────────────────────────────────────────────────

    function initializeScore(address user) public {
        if (isInitialized[user]) return;
        euint64 s = FHE.asEuint64(MIN_SCORE);
        encryptedScores[user] = s;
        euint64 l = FHE.asEuint64(0);
        encryptedLimits[user] = l;
        isInitialized[user] = true;
        FHE.allowThis(s); FHE.allow(s, user);
        FHE.allowThis(l); FHE.allow(l, user);
        emit ScoreInitialized(user);
    }

    function recordRepayment(address user) external onlyAuthorized {
        _ensureInitialized(user);
        euint64 current = encryptedScores[user];
        euint64 uncapped = FHE.add(current, FHE.asEuint64(REPAYMENT_BONUS));
        ebool ok = FHE.lte(uncapped, FHE.asEuint64(MAX_SCORE));
        euint64 finalScore = FHE.select(ok, uncapped, FHE.asEuint64(MAX_SCORE));
        encryptedScores[user] = finalScore;
        FHE.allowThis(finalScore); FHE.allow(finalScore, user);
        emit RepaymentRecorded(user);
    }

    function recordLiquidation(address user) external onlyAuthorized {
        _ensureInitialized(user);
        euint64 current = encryptedScores[user];
        euint64 threshold = FHE.add(FHE.asEuint64(MIN_SCORE), FHE.asEuint64(LIQUIDATION_PENALTY));
        ebool canSub = FHE.gte(current, threshold);
        euint64 subbed = FHE.sub(current, FHE.asEuint64(LIQUIDATION_PENALTY));
        euint64 finalScore = FHE.select(canSub, subbed, FHE.asEuint64(MIN_SCORE));
        encryptedScores[user] = finalScore;
        FHE.allowThis(finalScore); FHE.allow(finalScore, user);
        emit LiquidationRecorded(user);
    }

    // ── Credit Limit Logic ───────────────────────────────────────────────

    function setCreditLimit(address user, InEuint64 calldata encLimit) external onlyOwner {
        _ensureInitialized(user);
        euint64 lim = FHE.asEuint64(encLimit);
        encryptedLimits[user] = lim;
        FHE.allowThis(lim); FHE.allow(lim, user);
        emit LimitUpdated(user);
    }

    function setScore(address user, InEuint64 calldata encScore) external onlyOwner {
        euint64 s = FHE.asEuint64(encScore);
        encryptedScores[user] = s;
        isInitialized[user] = true;
        FHE.allowThis(s); FHE.allow(s, user);
        emit ScoreInitialized(user);
    }

    // ── Views ────────────────────────────────────────────────────────────

    function getEncryptedScore(address user) external view returns (euint64) { return encryptedScores[user]; }
    function getEncryptedLimit(address user) external view returns (euint64) { return encryptedLimits[user]; }
    function hasScore(address user) external view returns (bool) { return isInitialized[user]; }

    function _ensureInitialized(address user) internal {
        if (!isInitialized[user]) initializeScore(user);
    }
}
