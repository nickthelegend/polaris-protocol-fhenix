const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Multi-Chain Deployment Script for Polaris Protocol V2
 * 
 * Architecture:
 * - Master Chain (Creditcoin V2 Testnet): PoolManager, LoanEngine, ScoreManager
 * - Spoke Chains (Sepolia, Hedera): LiquidityVault, MockERC20 tokens
 */

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Deploying with account:", deployer.address);
    console.log("💰 Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

    const deploymentAddresses = {
        master: {},
        spokes: {
            sepolia: {},
            hedera: {}
        }
    };

    // ========================================
    // STEP 1: Deploy Spoke Chain Infrastructure
    // ========================================
    console.log("\n📍 DEPLOYING SPOKE CHAINS (Liquidity Sources)...\n");

    for (const spoke of ["sepolia", "hederaTestnet"]) {
        console.log(`\n🔗 Deploying to ${spoke}...`);

        try {
            // Switch network
            hre.changeNetwork(spoke);

            const spokeName = spoke === "hederaTestnet" ? "hedera" : spoke;

            // Deploy Mock USDC
            console.log("  📝 Deploying Mock USDC...");
            const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
            const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
            await usdc.waitForDeployment();
            const usdcAddress = await usdc.getAddress();
            console.log(`  ✅ Mock USDC deployed at: ${usdcAddress}`);

            // Deploy Mock USDT
            console.log("  📝 Deploying Mock USDT...");
            const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
            await usdt.waitForDeployment();
            const usdtAddress = await usdt.getAddress();
            console.log(`  ✅ Mock USDT deployed at: ${usdtAddress}`);

            // Deploy LiquidityVault
            console.log("  📝 Deploying LiquidityVault...");
            const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
            const vault = await LiquidityVault.deploy(deployer.address); // Deployer as initial validator
            await vault.waitForDeployment();
            const vaultAddress = await vault.getAddress();
            console.log(`  ✅ LiquidityVault deployed at: ${vaultAddress}`);

            // Whitelist tokens in vault
            console.log("  🔧 Whitelisting tokens...");
            await vault.setTokenWhitelist(usdcAddress, true);
            await vault.setTokenWhitelist(usdtAddress, true);
            console.log("  ✅ Tokens whitelisted");

            // Mint initial supply for testing
            console.log("  💵 Minting test tokens...");
            await usdc.mint(deployer.address, hre.ethers.parseUnits("1000000", 6));
            await usdt.mint(deployer.address, hre.ethers.parseUnits("1000000", 6));
            console.log("  ✅ Test tokens minted");

            deploymentAddresses.spokes[spokeName] = {
                USDC: usdcAddress,
                USDT: usdtAddress,
                VAULT: vaultAddress
            };

        } catch (error) {
            console.error(`  ❌ Error deploying to ${spoke}:`, error.message);
        }
    }

    // ========================================
    // STEP 2: Deploy Master Chain (Creditcoin V2)
    // ========================================
    console.log("\n\n📍 DEPLOYING MASTER CHAIN (Creditcoin V2 Testnet)...\n");

    try {
        hre.changeNetwork("uscTestnetV2");

        // Deploy EvmV1Decoder Library
        console.log("  📚 Deploying EvmV1Decoder library...");
        const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
        const decoder = await EvmV1Decoder.deploy();
        await decoder.waitForDeployment();
        const decoderAddress = await decoder.getAddress();
        console.log(`  ✅ EvmV1Decoder deployed at: ${decoderAddress}`);

        // Deploy PoolManager (with library linking)
        console.log("  📝 Deploying PoolManager...");
        const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
            libraries: { EvmV1Decoder: decoderAddress }
        });
        // Use zero address to auto-detect native verifier precompile
        const poolManager = await PoolManager.deploy(hre.ethers.ZeroAddress);
        await poolManager.waitForDeployment();
        const poolManagerAddress = await poolManager.getAddress();
        console.log(`  ✅ PoolManager deployed at: ${poolManagerAddress}`);

        // Deploy ScoreManager
        console.log("  📝 Deploying ScoreManager...");
        const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
        const scoreManager = await ScoreManager.deploy(poolManagerAddress);
        await scoreManager.waitForDeployment();
        const scoreManagerAddress = await scoreManager.getAddress();
        console.log(`  ✅ ScoreManager deployed at: ${scoreManagerAddress}`);

        // Deploy LoanEngine (with library linking)
        console.log("  📝 Deploying LoanEngine...");
        const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
            libraries: { EvmV1Decoder: decoderAddress }
        });
        const loanEngine = await LoanEngine.deploy(
            scoreManagerAddress,
            poolManagerAddress,
            hre.ethers.ZeroAddress // Use native verifier
        );
        await loanEngine.waitForDeployment();
        const loanEngineAddress = await loanEngine.getAddress();
        console.log(`  ✅ LoanEngine deployed at: ${loanEngineAddress}`);

        // Configure contracts
        console.log("\n  🔧 Configuring Master Chain contracts...");

        // Transfer ScoreManager ownership to LoanEngine
        await scoreManager.transferOwnership(loanEngineAddress);
        console.log("  ✅ ScoreManager ownership transferred to LoanEngine");

        // Set LoanEngine in PoolManager
        await poolManager.setLoanEngine(loanEngineAddress);
        console.log("  ✅ LoanEngine set in PoolManager");

        // Whitelist spoke vaults in PoolManager
        console.log("  🔧 Whitelisting spoke vaults...");

        const PROVER_SEPOLIA_KEY = 1;

        // Sepolia (chainKey = 11155111 AND Prover Key = 1)
        if (deploymentAddresses.spokes.sepolia.VAULT) {
            console.log("  🔗 Configuring Sepolia (11155111 & 1)...");

            // Standard ID
            await (await poolManager.setSourceParams(11155111, deploymentAddresses.spokes.sepolia.VAULT, deploymentAddresses.spokes.sepolia.USDC, true)).wait();
            await (await poolManager.setSourceParams(11155111, deploymentAddresses.spokes.sepolia.VAULT, deploymentAddresses.spokes.sepolia.USDT, true)).wait();

            // Prover Key
            await (await poolManager.setSourceParams(PROVER_SEPOLIA_KEY, deploymentAddresses.spokes.sepolia.VAULT, deploymentAddresses.spokes.sepolia.USDC, true)).wait();
            await (await poolManager.setSourceParams(PROVER_SEPOLIA_KEY, deploymentAddresses.spokes.sepolia.VAULT, deploymentAddresses.spokes.sepolia.USDT, true)).wait();

            await (await poolManager.setWhitelistedToken(deploymentAddresses.spokes.sepolia.USDC, true)).wait();
            await (await poolManager.setWhitelistedToken(deploymentAddresses.spokes.sepolia.USDT, true)).wait();
            console.log("  ✅ Sepolia vaults whitelisted");
        }

        // Hedera (chainKey = 296)
        if (deploymentAddresses.spokes.hedera.VAULT) {
            console.log("  🔗 Configuring Hedera (296)...");
            await (await poolManager.setSourceParams(296, deploymentAddresses.spokes.hedera.VAULT, deploymentAddresses.spokes.hedera.USDC, true)).wait();
            await (await poolManager.setSourceParams(296, deploymentAddresses.spokes.hedera.VAULT, deploymentAddresses.spokes.hedera.USDT, true)).wait();
            await (await poolManager.setWhitelistedToken(deploymentAddresses.spokes.hedera.USDC, true)).wait();
            await (await poolManager.setWhitelistedToken(deploymentAddresses.spokes.hedera.USDT, true)).wait();
            console.log("  ✅ Hedera vaults whitelisted");
        }

        deploymentAddresses.master = {
            POOL_MANAGER: poolManagerAddress,
            LOAN_ENGINE: loanEngineAddress,
            SCORE_MANAGER: scoreManagerAddress,
            EVM_V1_DECODER: decoderAddress
        };

    } catch (error) {
        console.error("  ❌ Error deploying to Creditcoin V2:", error.message);
        throw error;
    }

    // ========================================
    // STEP 3: Save Deployment Addresses
    // ========================================
    console.log("\n\n💾 Saving deployment addresses...");

    const outputPath = path.join(__dirname, "../deployments.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentAddresses, null, 2));
    console.log(`✅ Deployment addresses saved to: ${outputPath}`);

    // ========================================
    // STEP 4: Display Summary
    // ========================================
    console.log("\n\n🎉 DEPLOYMENT COMPLETE!\n");
    console.log("=".repeat(60));
    console.log("MASTER CHAIN (Creditcoin V2 Testnet - Chain ID: 102)");
    console.log("=".repeat(60));
    console.log(`PoolManager:     ${deploymentAddresses.master.POOL_MANAGER}`);
    console.log(`LoanEngine:      ${deploymentAddresses.master.LOAN_ENGINE}`);
    console.log(`ScoreManager:    ${deploymentAddresses.master.SCORE_MANAGER}`);
    console.log(`EvmV1Decoder:    ${deploymentAddresses.master.EVM_V1_DECODER}`);

    console.log("\n" + "=".repeat(60));
    console.log("SPOKE CHAIN: Sepolia (Chain ID: 11155111)");
    console.log("=".repeat(60));
    if (deploymentAddresses.spokes.sepolia.VAULT) {
        console.log(`LiquidityVault:  ${deploymentAddresses.spokes.sepolia.VAULT}`);
        console.log(`Mock USDC:       ${deploymentAddresses.spokes.sepolia.USDC}`);
        console.log(`Mock USDT:       ${deploymentAddresses.spokes.sepolia.USDT}`);
    } else {
        console.log("❌ Deployment failed");
    }

    console.log("\n" + "=".repeat(60));
    console.log("SPOKE CHAIN: Hedera Testnet (Chain ID: 296)");
    console.log("=".repeat(60));
    if (deploymentAddresses.spokes.hedera.VAULT) {
        console.log(`LiquidityVault:  ${deploymentAddresses.spokes.hedera.VAULT}`);
        console.log(`Mock USDC:       ${deploymentAddresses.spokes.hedera.USDC}`);
        console.log(`Mock USDT:       ${deploymentAddresses.spokes.hedera.USDT}`);
    } else {
        console.log("❌ Deployment failed");
    }

    console.log("\n" + "=".repeat(60));
    console.log("\n✨ Next Steps:");
    console.log("1. Update PayEase frontend with new contract addresses");
    console.log("2. Sync ABIs: node sync_abis.js");
    console.log("3. Test cross-chain liquidity flow");
    console.log("4. Fund test accounts on all chains\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
