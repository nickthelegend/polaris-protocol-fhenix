import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbiItem,
    Log,
    PublicClient,
    WalletClient,
    Account,
} from 'viem';
import { Chain, sepolia, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { chainKeyConverter, computeQueryId } from './utils';
import { PROVER_ABI } from './constants/abi';
const {
    QueryBuilder,
    QueryableFields
} = require('@gluwa/cc-next-query-builder');

dotenv.config();

// Load Config
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const USC_RPC = process.env.USC_RPC || 'https://rpc.usc-testnet.creditcoin.network';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!PRIVATE_KEY) {
    console.error("Missing PRIVATE_KEY environment variable");
    process.exit(1);
}

// ABIs
const LiquidityVaultABI = require('../../artifacts/contracts/LiquidityVault.sol/LiquidityVault.json').abi;
const PoolManagerABI = require('../../artifacts/contracts/PoolManager.sol/PoolManager.json').abi;

// Addresses
const ADDRESSES = require('../../addresses.json');
const POOL_MANAGER_ADDRESS = ADDRESSES.usc.poolManager;
const PROVER_ADDRESS = '0xc43402c66e88f38a5aa6e35113b310e1c19571d4';

// Clients
const account: Account = privateKeyToAccount(PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const uscChain = {
    id: 102033,
    name: 'USC-Testnet',
    nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
    rpcUrls: {
        default: { http: [USC_RPC] },
    },
    testnet: true,
} as const;

// Spoke Chain Configs
const SPOKE_CONFIGS = [
    {
        name: 'Sepolia',
        chainId: 11155111,
        address: ADDRESSES.sepolia.liquidityVault,
        rpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
        chain: sepolia
    },
    {
        name: 'Base Sepolia',
        chainId: 84532,
        address: ADDRESSES.baseSepolia.liquidityVault,
        rpc: 'https://sepolia.base.org',
        chain: baseSepolia
    }
];

const uscPublic = createPublicClient({
    chain: uscChain,
    transport: http(USC_RPC),
});

const uscWallet = createWalletClient({
    chain: uscChain,
    transport: http(USC_RPC),
    account,
});

async function processDeposit(log: any, config: typeof SPOKE_CONFIGS[0], client: PublicClient) {
    const { lender, token, amount } = (log as any).args;
    const txHash = log.transactionHash;

    console.log(`\n[${config.name}] Detected Deposit: ${txHash}`);

    // 1. Initial Supabase Entry
    await supabase.from('bridge_transactions').upsert({
        user_address: lender,
        token_address: token,
        amount: amount.toString(),
        source_chain_id: config.chainId,
        source_tx_hash: txHash,
        status: 'DETECTED'
    });

    try {
        // 2. Wait for confirmations
        console.log(`[${config.name}] Processing...`);
        const receipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 2 });
        const tx = await client.getTransaction({ hash: txHash });

        // 3. Build Query
        const builder = QueryBuilder.createFromTransaction(tx, receipt);
        builder.setAbiProvider(async () => JSON.stringify(LiquidityVaultABI));

        builder
            .addStaticField(QueryableFields.RxStatus)
            .addStaticField(QueryableFields.TxFrom)
            .addStaticField(QueryableFields.TxTo);

        await builder.eventBuilder('LiquidityDeposited', () => true, (b: any) => b
            .addAddress().addSignature().addArgument('lender').addArgument('token').addArgument('amount').addArgument('depositId')
        );

        const fields = builder.build();
        const query = {
            chainId: chainKeyConverter(config.chainId),
            height: BigInt(tx.blockNumber!),
            index: BigInt(receipt.transactionIndex),
            layoutSegments: fields.map((f: any) => ({
                offset: BigInt(f.offset),
                size: BigInt(f.size),
            })),
        };

        const queryId = computeQueryId(query);
        console.log(`[${config.name}] QueryID: ${queryId}`);

        await supabase.from('bridge_transactions').update({ status: 'BUILDING_PROOF', usc_query_id: queryId }).eq('source_tx_hash', txHash);

        // 4. Submit to USC
        const cost = await uscPublic.readContract({
            address: PROVER_ADDRESS as `0x${string}`,
            abi: PROVER_ABI,
            functionName: 'computeQueryCost',
            args: [query],
        }) as bigint;

        const hash = await uscWallet.writeContract({
            address: PROVER_ADDRESS as `0x${string}`,
            abi: PROVER_ABI,
            functionName: 'submitQuery',
            args: [query, account.address],
            value: cost,
            account
        } as any);

        console.log(`[${config.name}] Submitted! Hub Tx: ${hash}`);
        await supabase.from('bridge_transactions').update({ status: 'SUBMITTED' }).eq('source_tx_hash', txHash);

    } catch (err) {
        console.error(`[${config.name}] Failed:`, err);
        await supabase.from('bridge_transactions').update({ status: 'FAILED' }).eq('source_tx_hash', txHash);
    }
}

async function main() {
    console.log("🚀 Bridge Multi-Chain Daemon Start");

    for (const config of SPOKE_CONFIGS) {
        const client = createPublicClient({ chain: config.chain, transport: http(config.rpc) });
        client.watchContractEvent({
            address: config.address as `0x${string}`,
            abi: LiquidityVaultABI,
            eventName: 'LiquidityDeposited',
            onLogs: (logs) => logs.forEach(log => processDeposit(log, config, client))
        });
    }

    uscPublic.watchContractEvent({
        address: PROVER_ADDRESS as `0x${string}`,
        abi: PROVER_ABI,
        eventName: 'QueryProofVerified',
        onLogs: async (logs) => {
            for (const log of logs) {
                const queryId = (log.args as any).queryId;
                const { data } = await supabase.from('bridge_transactions').select('*').eq('usc_query_id', queryId).single();

                if (data && data.status === 'SUBMITTED') {
                    console.log(`✅ Proof Verified: ${queryId}. Finalizing...`);
                    try {
                        const hash = await uscWallet.writeContract({
                            address: POOL_MANAGER_ADDRESS as `0x${string}`,
                            abi: PoolManagerABI,
                            functionName: 'addLiquidityFromProof',
                            args: [queryId],
                            account
                        } as any);
                        console.log(`✅ Credited! Tx: ${hash}`);
                        await supabase.from('bridge_transactions').update({ status: 'COMPLETED' }).eq('usc_query_id', queryId);
                    } catch (err) {
                        console.error("❌ Finalization failed:", err);
                    }
                }
            }
        }
    });

    await new Promise(() => { });
}

main().catch(console.error);
