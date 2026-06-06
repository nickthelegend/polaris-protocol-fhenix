// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Replicating CCNext Prover types to remain compatible with official infrastructure.
 */
enum QueryState { NonExistent, Unprocessed, Processed, Invalid }

struct LayoutSegment {
    uint64 offset;
    uint64 size;
}

struct ChainQuery {
    uint64 chainId;
    uint64 height;
    uint64 index;
    LayoutSegment[] layoutSegments;
}

struct ResultSegment {
    uint256 offset;
    bytes32 abiBytes;
}

struct QueryDetails {
    QueryState state;
    ChainQuery query;
    uint256 escrowedAmount;
    address principal;
    uint256 estimatedCost;
    uint256 timestamp;
    ResultSegment[] resultSegments;
}

interface ICreditcoinProver {
    function getQueryDetails(bytes32 queryId) external view returns (QueryDetails memory queryDetails);
}
