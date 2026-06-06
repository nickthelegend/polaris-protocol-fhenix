// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IUSCOracle.sol";

/**
 * @title MockOracleRelayer
 * @dev Simulates the Creditcoin USC Oracle for the demo.
 * Stores "verified" results that can be queried by PoolManager.
 */
contract MockOracleRelayer is IUSCOracle {
    mapping(bytes32 => bytes) public results;

    event ProofRelayed(bytes32 indexed queryId, bytes data);

    function getQueryResult(bytes32 queryId) external view override returns (bytes memory) {
        return results[queryId];
    }

    /**
     * @dev Called by the "Relayer" (frontend/script) to seed a proof result.
     * In prod, this would be an internal function called by CCIP/LayerZero callback.
     */
    function seedProof(bytes32 queryId, bytes memory data) external {
        results[queryId] = data;
        emit ProofRelayed(queryId, data);
    }
}
