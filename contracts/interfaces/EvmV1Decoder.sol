// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title EvmV1Decoder
 * @notice Library for decoding ABI-encoded EVM transactions (types 0-4) and receipts
 */
library EvmV1Decoder {
    // ---------- Structs ----------
    struct AccessListEntry { address account; bytes32[] storageKeys; }

    struct AuthorizationListEntry {
        uint256 chainId;
        address account;
        uint64 nonce;
        uint8 yParity;
        uint256 r;
        uint256 s;
    }

    struct LogEntry { address address_; bytes32[] topics; bytes data; }
    struct LogEntryTuple { address address_; bytes32[] topics; bytes data; }

    struct CommonTxFields {
        uint64 nonce;
        uint64 gasLimit;
        address from;
        bool toIsNull;
        address to;
        uint256 value;
        bytes data;
    }

    struct ReceiptFields {
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntry[] receiptLogs;
        bytes receiptLogsBloom;
    }

    struct LegacyFields { uint128 gasPrice; uint256 v; bytes32 r; bytes32 s; }
    struct Type1Fields { uint64 chainId; uint128 gasPrice; AccessListEntry[] accessList; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type2Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type3Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; uint256 maxFeePerBlobGas; bytes32[] blobVersionedHashes; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type4Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; AuthorizationListEntry[] authorizationList; uint8 yParity; bytes32 r; bytes32 s; }

    struct DecodedTransactionType0 { CommonTxFields commonTx; LegacyFields type0; ReceiptFields receipt; }

    // ---------- Public utils ----------
    function getTransactionType(bytes memory encodedTx) public pure returns (uint8 txType) {
        (txType, ) = abi.decode(encodedTx, (uint8, bytes[]));
    }

    function isValidTransactionType(uint8 txType) public pure returns (bool) { return txType <= 4; }

    function getLogsByEventSignature(ReceiptFields memory receipt, bytes32 eventSignature)
        public pure returns (LogEntry[] memory)
    {
        uint256 n;
        for (uint256 i; i < receipt.receiptLogs.length; i++) {
            if (receipt.receiptLogs[i].topics.length > 0 && receipt.receiptLogs[i].topics[0] == eventSignature) n++;
        }
        LogEntry[] memory out_ = new LogEntry[](n);
        uint256 k;
        for (uint256 i; i < receipt.receiptLogs.length; i++) {
            if (receipt.receiptLogs[i].topics.length > 0 && receipt.receiptLogs[i].topics[0] == eventSignature) {
                out_[k++] = receipt.receiptLogs[i];
            }
        }
        return out_;
    }

    function decodeReceiptFields(bytes memory chunk) public pure returns (ReceiptFields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        uint8 txType = getTransactionType(chunk);
        return _decodeReceiptChunk(chunk, txType);
    }

    function _toLogs(LogEntryTuple[] memory t) private pure returns (LogEntry[] memory) {
        LogEntry[] memory out_ = new LogEntry[](t.length);
        for (uint256 i; i < t.length; i++) {
            out_[i] = LogEntry({ address_: t[i].address_, topics: t[i].topics, data: t[i].data });
        }
        return out_;
    }

    function _decodeReceiptChunk(bytes memory chunk, uint8 txType) internal pure returns (ReceiptFields memory receipt) {
        (, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));

        uint256 receiptChunkIndex;
        if (txType <= 2) {
            receiptChunkIndex = 2;
            require(chunks.length >= 3, "EvmV1Decoder: Invalid chunk count for Type 0-2");
        } else {
            receiptChunkIndex = 3;
            require(chunks.length >= 4, "EvmV1Decoder: Invalid chunk count for Type 3-4");
        }

        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntryTuple[] memory receiptLogs;
        bytes memory receiptLogsBloom;

        (receiptStatus, receiptGasUsed, receiptLogs, receiptLogsBloom) = abi.decode(chunks[receiptChunkIndex], (
            uint8, uint64, LogEntryTuple[], bytes
        ));

        receipt.receiptStatus = receiptStatus;
        receipt.receiptGasUsed = receiptGasUsed;
        receipt.receiptLogs = _toLogs(receiptLogs);
        receipt.receiptLogsBloom = receiptLogsBloom;
    }

    function _decodeCommonTxChunk(bytes memory chunk) internal pure returns (CommonTxFields memory common) {
        (, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(chunks.length >= 1, "EvmV1Decoder: Invalid chunk count");
        (common.nonce, common.gasLimit, common.from, common.toIsNull, common.to, common.value, common.data) = abi.decode(chunks[0], (
            uint64, uint64, address, bool, address, uint256, bytes
        ));
    }
}
