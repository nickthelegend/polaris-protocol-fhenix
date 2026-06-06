// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/INativeQueryVerifier.sol";
import "hardhat/console.sol";

contract MockNativeQueryVerifier is INativeQueryVerifier {
    bool public shouldSucceed = true;

    function setShouldSucceed(bool _shouldSucceed) external {
        shouldSucceed = _shouldSucceed;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool success) {
        console.log("MockVerifier: verifyAndEmit called");
        return shouldSucceed;
    }

    function verify(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool success) {
        return shouldSucceed;
    }
}
