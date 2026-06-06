import { createPublicClient, createWalletClient, http, PublicClient, WalletClient, Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

const cc_next_testnet = {
    id: 102033,
    name: 'CCNext-Testnet',
    nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.usc-testnet.creditcoin.network'] } },
    testnet: true,
} as const;

const PoolManagerABI = require('../../artifacts/contracts/PoolManager.sol/PoolManager.json').abi;
const LiquidityVaultABI = require('../../artifacts/contracts/LiquidityVault.sol/LiquidityVault.json').abi;

const ADDRESSES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../addresses.json'), 'utf8'));
const POOL_MANAGER_ADDRESS = ADDRESSES.usc.poolManager;

const TYPES = {
    Withdrawal: [
        { name: 'user', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
    ],
};

async function main() {
    console.log("🚀 Starting Multi-Chain Validator Service...");

    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    if (!privateKey) throw new Error("PRIVATE_KEY missing");
    const account: Account = privateKeyToAccount(privateKey);

    const uscClient = createPublicClient({ chain: cc_next_testnet, transport: http() });

    // Map chainIds to clients and config
    const spokeClients: Record<number, { wallet: WalletClient, public: PublicClient, vault: string }> = {
        11155111: {
            public: createPublicClient({ chain: sepolia, transport: http() }),
            wallet: createWalletClient({ chain: sepolia, transport: http(), account }),
            vault: ADDRESSES.sepolia.liquidityVault
        },
        84532: {
            public: createPublicClient({ chain: baseSepolia, transport: http() }),
            wallet: createWalletClient({ chain: baseSepolia, transport: http(), account }),
            vault: ADDRESSES.baseSepolia.liquidityVault
        }
    };

    console.log("Listening for WithdrawalAuthorized events on Hub...");

    uscClient.watchContractEvent({
        address: POOL_MANAGER_ADDRESS as `0x${string}`,
        abi: PoolManagerABI,
        eventName: 'WithdrawalAuthorized',
        onLogs: async (logs) => {
            for (const log of logs) {
                const { user, tokenOnSource, amount, nonce, destChainId } = log.args as any;
                const chainId = Number(destChainId);

                console.log(`\n💸 Withdrawal Request for Chain ${chainId}`);
                const config = spokeClients[chainId];
                if (!config) {
                    console.error(`Unsupported destination chain: ${chainId}`);
                    continue;
                }

                try {
                    const domain = {
                        name: 'Polaris_LiquidityVault',
                        version: '1.0.0',
                        chainId,
                        verifyingContract: config.vault as `0x${string}`,
                    };

                    console.log(`Signing for ${config.vault}...`);
                    const signature = await config.wallet.signTypedData({
                        domain, types: TYPES, primaryType: 'Withdrawal',
                        message: { user, token: tokenOnSource, amount, nonce },
                    });

                    console.log(`Releasing funds on chain ${chainId}...`);
                    const hash = await config.wallet.writeContract({
                        address: config.vault as `0x${string}`,
                        abi: LiquidityVaultABI,
                        functionName: 'completeWithdrawal',
                        args: [user, tokenOnSource, amount, nonce, signature],
                        account
                    } as any);

                    console.log(`✅ Withdrawal Released! Tx: ${hash}`);
                } catch (error) {
                    console.error("❌ Process failed:", error);
                }
            }
        },
    });

    await new Promise(() => { });
}

main().catch(console.error);
