// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint32, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { AuthorizedManagers } from "./AuthorizedManagers.sol";

/**
 * @title ConfidentialScoreManager
 * @notice Encrypted credit score (euint32, 300–850) + encrypted credit limit (euint64).
 *
 *         Only the user can decrypt their own score/limit (granted via FHE.allow), and
 *         only authorized protocol contracts (the lending pool / liquidation engine) may
 *         mutate them. The pool calls `recordRepayment` on repay and the liquidation
 *         engine calls `recordLiquidation` on seizure — this is how scores actually move.
 *
 *         Encrypted constants are cached once in the constructor and reused, per the
 *         gas-optimization best practice (no per-call re-encryption of MIN/MAX/etc.).
 */
contract ConfidentialScoreManager is AuthorizedManagers {
    uint32 public constant MIN_SCORE = 300;
    uint32 public constant MAX_SCORE = 850;
    uint32 public constant REPAYMENT_BONUS = 5;
    uint32 public constant LIQUIDATION_PENALTY = 50;

    mapping(address => euint32) private _scores;
    mapping(address => euint64) private _limits;
    mapping(address => bool) public isInitialized;

    // Cached encrypted constants (allowThis'd once).
    euint32 private _encMin;
    euint32 private _encMax;
    euint32 private _encBonus;
    euint32 private _encPenalty;
    euint32 private _encMinPlusPenalty;
    euint64 private _encZero64;

    event ScoreInitialized(address indexed user);
    event RepaymentRecorded(address indexed user);
    event LiquidationRecorded(address indexed user);
    event LimitUpdated(address indexed user);

    constructor() {
        _encMin = FHE.asEuint32(uint256(MIN_SCORE));
        _encMax = FHE.asEuint32(uint256(MAX_SCORE));
        _encBonus = FHE.asEuint32(uint256(REPAYMENT_BONUS));
        _encPenalty = FHE.asEuint32(uint256(LIQUIDATION_PENALTY));
        _encMinPlusPenalty = FHE.asEuint32(uint256(MIN_SCORE + LIQUIDATION_PENALTY));
        _encZero64 = FHE.asEuint64(0);
        FHE.allowThis(_encMin);
        FHE.allowThis(_encMax);
        FHE.allowThis(_encBonus);
        FHE.allowThis(_encPenalty);
        FHE.allowThis(_encMinPlusPenalty);
        FHE.allowThis(_encZero64);
    }

    // ─────────────────────────────── Lifecycle ───────────────────────────────

    /// @notice Initialize a user at MIN_SCORE with a 0 credit limit. Idempotent.
    function initialize(address user) public {
        if (isInitialized[user]) return;
        _scores[user] = _encMin;
        _limits[user] = _encZero64;
        isInitialized[user] = true;
        FHE.allowThis(_encMin);
        FHE.allow(_encMin, user);
        FHE.allowThis(_encZero64);
        FHE.allow(_encZero64, user);
        _grantManagers32(_encMin);
        _grantManagers(_encZero64);
        emit ScoreInitialized(user);
    }

    function _ensure(address user) internal {
        if (!isInitialized[user]) initialize(user);
    }

    // ───────────────────────────── Score mutation ────────────────────────────

    /// @notice +REPAYMENT_BONUS (capped at MAX_SCORE). Called by an authorized pool on repay.
    function recordRepayment(address user) external onlyAuthorized {
        _ensure(user);
        euint32 current = _scores[user];
        euint32 uncapped = FHE.add(current, _encBonus);
        ebool withinMax = FHE.lte(uncapped, _encMax);
        euint32 finalScore = FHE.select(withinMax, uncapped, _encMax);
        _scores[user] = finalScore;
        FHE.allowThis(finalScore);
        FHE.allow(finalScore, user);
        _grantManagers32(finalScore);
        emit RepaymentRecorded(user);
    }

    /// @notice -LIQUIDATION_PENALTY (floored at MIN_SCORE). Called by the liquidation engine.
    function recordLiquidation(address user) external onlyAuthorized {
        _ensure(user);
        euint32 current = _scores[user];
        ebool canSubtract = FHE.gte(current, _encMinPlusPenalty);
        euint32 subbed = FHE.sub(current, _encPenalty);
        euint32 finalScore = FHE.select(canSubtract, subbed, _encMin);
        _scores[user] = finalScore;
        FHE.allowThis(finalScore);
        FHE.allow(finalScore, user);
        _grantManagers32(finalScore);
        emit LiquidationRecorded(user);
    }

    // ───────────────────────────── Limit mutation ────────────────────────────

    /// @notice Owner sets a user's encrypted credit limit (e.g. derived off-chain from score history).
    function setCreditLimit(address user, InEuint64 calldata encLimit) external onlyOwner {
        _ensure(user);
        euint64 lim = FHE.asEuint64(encLimit);
        _limits[user] = lim;
        FHE.allowThis(lim);
        FHE.allow(lim, user);
        _grantManagers(lim);
        emit LimitUpdated(user);
    }

    /// @notice Owner override of a user's encrypted score (e.g. KYC bootstrap).
    function setScore(address user, InEuint64 calldata encScore) external onlyOwner {
        euint32 s = FHE.asEuint32(FHE.asEuint64(encScore));
        _scores[user] = s;
        isInitialized[user] = true;
        FHE.allowThis(s);
        FHE.allow(s, user);
        _grantManagers32(s);
        emit ScoreInitialized(user);
    }

    // ─────────────────────────────────  Views  ───────────────────────────────

    function getEncryptedScore(address user) external view returns (euint32) {
        return _scores[user];
    }

    function getEncryptedLimit(address user) external view returns (euint64) {
        return _limits[user];
    }

    function hasScore(address user) external view returns (bool) {
        return isInitialized[user];
    }
}
