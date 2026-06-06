type ChainQuery = any;
import { PROVER_ABI } from './constants/abi';
import { encodeAbiParameters, keccak256 } from 'viem';

export const chainKeyConverter = (chainId: number): bigint => {
    switch (chainId) {
        case 11155111:
            return 1n; // Sepolia
        case 1337:
        case 31337:
            return 1n; // Treat Localnet as Sepolia for testing flow
        default:
            console.warn("Unknown chainId: " + chainId + ", defaulting to Sepolia (1n)");
            return 1n;
    }
};

export const computeQueryId = (queryObject: ChainQuery): `0x${string}` => {
    const queryAbi = PROVER_ABI.find(
        (abiElement) =>
            abiElement.type === 'function' && abiElement.name === 'computeQueryCost'
    )!.inputs;

    // Create object matching the struct expectation
    const args = {
        chainId: queryObject.chainId,
        height: queryObject.height,
        index: queryObject.index,
        layoutSegments: queryObject.layoutSegments.map((segment: any) => ({
            offset: segment.offset,
            size: segment.size,
        })),
    };

    const queryAbiEncoded = encodeAbiParameters(queryAbi, [args]);
    return keccak256(queryAbiEncoded);
};
