// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUSCOracle {
    /**
     * @dev Fetches the verified query result from the Creditcoin USC Oracle.
     * @param queryId The unique identifier of the submitted query.
     * @return data ABI-encoded data from the source chain transaction.
     */
    function getQueryResult(bytes32 queryId) external view returns (bytes memory data);
}
