// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, InEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ConfidentialToken } from "./ConfidentialToken.sol";

/**
 * @title ConfidentialSwapPool
 * @notice A confidential, fixed/oracle-rate swap between two ConfidentialTokens with REAL
 *         custody. Trade amounts stay encrypted (euint64) end to end.
 *
 *         Design note: this is a fixed-rate (oracle-priced) pool, NOT a constant-product
 *         AMM. A constant-product pool would have to expose reserves / price impact, which
 *         leaks information about encrypted trades. A fixed rate keeps every amount private
 *         while still moving real tokens — the right tradeoff for confidential swaps.
 *
 *         Flow:
 *           1. user: tokenIn.setOperator(pool, shortExpiry)
 *           2. user: pool.swapAToB(encAmountIn)  (or swapBToA)
 *              -> pull encrypted amountIn (tokenIn) into the pool
 *              -> amountOut = amountIn * rate, sent (tokenOut) to the user
 *                 (zero-replaced if the pool is short on output liquidity)
 */
contract ConfidentialSwapPool is Ownable {
    ConfidentialToken public immutable tokenA;
    ConfidentialToken public immutable tokenB;

    // Price: 1 unit of A == rateNum/rateDen units of B (public price, private amounts).
    uint64 public rateNum;
    uint64 public rateDen;

    euint64 private _encRateNum;
    euint64 private _encRateDen;

    event LiquidityAdded(address indexed provider, bool isA);
    event Swapped(address indexed user, bool aToB);
    event RateUpdated(uint64 rateNum, uint64 rateDen);

    constructor(address _tokenA, address _tokenB, uint64 _rateNum, uint64 _rateDen) Ownable(msg.sender) {
        require(_rateNum > 0 && _rateDen > 0, "bad rate");
        tokenA = ConfidentialToken(_tokenA);
        tokenB = ConfidentialToken(_tokenB);
        rateNum = _rateNum;
        rateDen = _rateDen;
        _encRateNum = FHE.asEuint64(uint256(_rateNum));
        _encRateDen = FHE.asEuint64(uint256(_rateDen));
        FHE.allowThis(_encRateNum);
        FHE.allowThis(_encRateDen);
    }

    function setRate(uint64 _rateNum, uint64 _rateDen) external onlyOwner {
        require(_rateNum > 0 && _rateDen > 0, "bad rate");
        rateNum = _rateNum;
        rateDen = _rateDen;
        _encRateNum = FHE.asEuint64(uint256(_rateNum));
        _encRateDen = FHE.asEuint64(uint256(_rateDen));
        FHE.allowThis(_encRateNum);
        FHE.allowThis(_encRateDen);
        emit RateUpdated(_rateNum, _rateDen);
    }

    // ─────────────────────────── Liquidity (seed reserves) ────────────────────

    function addLiquidityA(InEuint64 calldata encAmount) external {
        _pull(tokenA, encAmount);
        emit LiquidityAdded(msg.sender, true);
    }

    function addLiquidityB(InEuint64 calldata encAmount) external {
        _pull(tokenB, encAmount);
        emit LiquidityAdded(msg.sender, false);
    }

    // ───────────────────────────────── Swaps ─────────────────────────────────

    /// @notice Swap encrypted tokenA -> tokenB. Caller must `tokenA.setOperator(pool, expiry)` first.
    function swapAToB(InEuint64 calldata encAmountIn) external {
        euint64 movedIn = _pull(tokenA, encAmountIn);
        // amountOut = amountIn * rateNum / rateDen
        euint64 out = FHE.div(FHE.mul(movedIn, _encRateNum), _encRateDen);
        _send(tokenB, msg.sender, out);
        emit Swapped(msg.sender, true);
    }

    /// @notice Swap encrypted tokenB -> tokenA. Caller must `tokenB.setOperator(pool, expiry)` first.
    function swapBToA(InEuint64 calldata encAmountIn) external {
        euint64 movedIn = _pull(tokenB, encAmountIn);
        // amountOut = amountIn * rateDen / rateNum
        euint64 out = FHE.div(FHE.mul(movedIn, _encRateDen), _encRateNum);
        _send(tokenA, msg.sender, out);
        emit Swapped(msg.sender, false);
    }

    // ─────────────────────────────────  Views  ───────────────────────────────

    /// @notice The pool's encrypted reserve of A (only meaningful to addresses with ACL).
    function getReserveA() external view returns (euint64) {
        return tokenA.confidentialBalanceOf(address(this));
    }

    function getReserveB() external view returns (euint64) {
        return tokenB.confidentialBalanceOf(address(this));
    }

    // ────────────────────────────── Internals ────────────────────────────────

    /// @dev Decode the user input HERE (msg.sender == user), pull min(amount,balance) into the pool.
    function _pull(ConfidentialToken token, InEuint64 calldata enc) internal returns (euint64 moved) {
        euint64 amount = FHE.asEuint64(enc);
        FHE.allowThis(amount);
        FHE.allowTransient(amount, address(token));
        moved = token.confidentialTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev Send an internally-computed encrypted amount out of the pool (zero-replaced if short).
    function _send(ConfidentialToken token, address to, euint64 amount) internal {
        FHE.allowThis(amount);
        FHE.allowTransient(amount, address(token));
        token.confidentialTransfer(to, amount);
    }
}
