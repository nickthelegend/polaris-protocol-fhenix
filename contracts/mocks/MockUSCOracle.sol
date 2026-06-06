// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICreditcoinProver.sol";

contract MockUSCOracle is ICreditcoinProver {
    mapping(bytes32 => QueryDetails) private _proofs;

    function setProof(bytes32 queryId, QueryDetails memory details) external {
        // Handle manual copy to avoid struct array to storage error in some versions
        _proofs[queryId].state = details.state;
        _proofs[queryId].principal = details.principal;
        
        // Copy segments
        delete _proofs[queryId].resultSegments;
        for (uint i = 0; i < details.resultSegments.length; i++) {
            _proofs[queryId].resultSegments.push(details.resultSegments[i]);
        }
    }

    function getQueryDetails(bytes32 queryId) external view override returns (QueryDetails memory) {
        return _proofs[queryId];
    }
}
