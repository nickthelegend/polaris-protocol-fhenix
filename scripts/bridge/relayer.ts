import {
    createPublicClient,
    createWalletClient,
    http,
} from 'viem';
import { Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ethers } from 'ethers';
import { chainKeyConverter, computeQueryId } from './utils';
import { PROVER_ABI } from './constants/abi';
const {
    QueryBuilder,
    QueryableFields
} = require('@gluwa/cc-next-query-builder');
type ChainQuery = any;

const LiquidityVaultABI = require('../../artifacts/contracts/LiquidityVault.sol/LiquidityVault.json').abi;
const BLOCK_LAG: bigint = 3n;

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 3) {
        console.error("Usage: npx ts-node relayer.ts <RPC> <HASH> <KEY>");
        process.exit(1);
    }

    var [rpcUrl, transactionHash, ccNextPrivateKey] = args;
    if (!transactionHash.startsWith('0x')) transactionHash = '0x' + transactionHash;
    if (!ccNextPrivateKey.startsWith('0x')) ccNextPrivateKey = '0x' + ccNextPrivateKey;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const cc_next_testnet = {
        id: 102033,
        name: 'CCNext-Testnet',
        nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
        rpcUrls: { default: { http: ['https://rpc.usc-testnet.creditcoin.network'] } },
        testnet: true,
    } as const satisfies Chain;

    const account = privateKeyToAccount(ccNextPrivateKey as `0x${string}`);
    const ccNextPublicClient = createPublicClient({ chain: cc_next_testnet, transport: http() });
    const ccNextWalletClient = createWalletClient({ chain: cc_next_testnet, transport: http(), account });

    const tx = await provider.getTransaction(transactionHash);
    const receipt = await provider.getTransactionReceipt(transactionHash);

    if (!tx || !receipt) throw new Error("Missing tx/receipt");

    console.log('Building query...');
    const builder = QueryBuilder.createFromTransaction(tx, receipt);
    builder.setAbiProvider(async () => JSON.stringify(LiquidityVaultABI));

    builder.addStaticField(QueryableFields.RxStatus).addStaticField(QueryableFields.TxFrom).addStaticField(QueryableFields.TxTo);
    await builder.eventBuilder('LiquidityDeposited', () => true, (b: any) =>
        b.addAddress().addSignature().addArgument('lender').addArgument('token').addArgument('amount').addArgument('depositId')
    );

    const fields = builder.build();
    const query: ChainQuery = {
        chainId: chainKeyConverter(Number(tx.chainId)),
        height: BigInt(tx.blockNumber!),
        index: BigInt(receipt.index),
        layoutSegments: fields.map((f: any) => ({ offset: BigInt(f.offset), size: BigInt(f.size) })),
    };

    const proverContractAddress = '0xc43402c66e88f38a5aa6e35113b310e1c19571d4';
    const computedQueryCost = await ccNextPublicClient.readContract({
        address: proverContractAddress as `0x${string}`,
        abi: PROVER_ABI,
        functionName: 'computeQueryCost',
        args: [query],
    }) as bigint;

    console.log("Submitting...");
    const txHashSubmit = await ccNextWalletClient.writeContract({
        address: proverContractAddress as `0x${string}`,
        abi: PROVER_ABI,
        functionName: 'submitQuery',
        args: [query, account.address],
        value: computedQueryCost,
        account
    } as any);

    console.log(`Oracle Query Submitted: ${txHashSubmit}`);
    const computedQueryId = computeQueryId(query);
    console.log(`** QUERY ID **: ${computedQueryId}`);

    let startBlock = await ccNextPublicClient.getBlockNumber();
    while (true) {
        const currentBlock = await ccNextPublicClient.getBlockNumber();
        const logs = await ccNextPublicClient.getContractEvents({
            address: proverContractAddress as `0x${string}`,
            abi: PROVER_ABI,
            eventName: 'QueryProofVerified',
            fromBlock: startBlock - BLOCK_LAG,
            toBlock: currentBlock
        });

        for (const log of logs) {
            if ((log.args as any).queryId === computedQueryId) {
                console.log("\n✅ VERIFIED!");
                process.exit(0);
            }
        }
        startBlock = currentBlock + 1n;
        await new Promise(r => setTimeout(r, 10000));
    }
}

main().catch(console.error);
