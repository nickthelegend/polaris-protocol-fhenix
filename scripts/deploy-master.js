const hre = require("hardhat");

// Spoke chain addresses from previous deployments
const SPOKE_ADDRESSES = {
    sepolia: {
        chainId: 11155111,
        vault: "0x8C213a3Db9187966Ebf8DfD0488A225044265AeF",
        usdc: "0xbCFCF4D1B880Ea38b71E45394FaCC5b71678C44A",
        usdt: "0xf75C8eE5b4a005120bCF0D6d457A8000dddDea8f"
    },
    hedera: {
        chainId: 296,
        vault: "0x214730188780a3A64fD24ede85f2724535772Ff0",
        usdc: "0x84373D817230268b2dE1d7727ca3c930293CCE51",
        usdt: "0xB159E0c8093081712c92e274DbFEa5A97A80cA30"
    }
};

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Deploying MASTER contracts to:", hre.network.name);
    console.log("📍 Deployer:", deployer.address);
    console.log("💰 Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

    // Deploy EvmV1Decoder Library
    console.log("\n📚 Deploying EvmV1Decoder library...");
    const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
    const decoder = await EvmV1Decoder.deploy();
    await decoder.waitForDeployment();
    const decoderAddress = await decoder.getAddress();
    console.log(`✅ EvmV1Decoder: ${decoderAddress}`);

    // Deploy PoolManager (with library linking)
    console.log("\n📝 Deploying PoolManager...");
    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: { EvmV1Decoder: decoderAddress }
    });
    // Use zero address to auto-detect native verifier precompile at 0x...FD2
    const poolManager = await PoolManager.deploy(hre.ethers.ZeroAddress);
    await poolManager.waitForDeployment();
    const poolManagerAddress = await poolManager.getAddress();
    console.log(`✅ PoolManager: ${poolManagerAddress}`);

    // Deploy ScoreManager
    console.log("\n📝 Deploying ScoreManager...");
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(poolManagerAddress);
    await scoreManager.waitForDeployment();
    const scoreManagerAddress = await scoreManager.getAddress();
    console.log(`✅ ScoreManager: ${scoreManagerAddress}`);

    // Deploy ProtocolFunds
    console.log("\n📝 Deploying ProtocolFunds...");
    const ProtocolFunds = await hre.ethers.getContractFactory("ProtocolFunds");
    // Admin: 0xcCED528A5b70e16c8131Cb2de424564dD938fD3B
    const protocolFunds = await ProtocolFunds.deploy("0xcCED528A5b70e16c8131Cb2de424564dD938fD3B");
    await protocolFunds.waitForDeployment();
    const protocolFundsAddress = await protocolFunds.getAddress();
    console.log(`✅ ProtocolFunds: ${protocolFundsAddress}`);

    // Deploy LoanEngine (with library linking)
    console.log("\n📝 Deploying LoanEngine...");
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: { EvmV1Decoder: decoderAddress }
    });
    const loanEngine = await LoanEngine.deploy(
        scoreManagerAddress,
        poolManagerAddress,
        hre.ethers.ZeroAddress, // Use native verifier
        protocolFundsAddress
    );
    await loanEngine.waitForDeployment();
    const loanEngineAddress = await loanEngine.getAddress();
    console.log(`✅ LoanEngine: ${loanEngineAddress}`);

    // Configure contracts
    console.log("\n🔧 Configuring Master Chain contracts...");

    // Transfer ScoreManager ownership to LoanEngine
    await (await scoreManager.transferOwnership(loanEngineAddress)).wait();
    console.log("✅ ScoreManager ownership transferred to LoanEngine");

    // Set LoanEngine in PoolManager
    await (await poolManager.setLoanEngine(loanEngineAddress)).wait();
    console.log("✅ LoanEngine set in PoolManager");

    // Whitelist Sepolia vaults and tokens
    console.log("\n🔧 Whitelisting Sepolia spoke...");

    // Register Source Params (Chain ID + Prover Key 1)
    const SEPOLIA_ID = SPOKE_ADDRESSES.sepolia.chainId;
    const PROVER_KEY = 1;

    // USDC
    await (await poolManager.setSourceParams(SEPOLIA_ID, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdc, true)).wait();
    await (await poolManager.setSourceParams(PROVER_KEY, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdc, true)).wait();

    // USDT
    await (await poolManager.setSourceParams(SEPOLIA_ID, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdt, true)).wait();
    await (await poolManager.setSourceParams(PROVER_KEY, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdt, true)).wait();

    // Global Whitelist
    await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdc, true)).wait();
    await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdt, true)).wait();
    console.log("✅ Sepolia vaults and tokens whitelisted");

    // Whitelist Hedera vaults and tokens
    console.log("\n🔧 Whitelisting Hedera spoke...");
    const HEDERA_ID = SPOKE_ADDRESSES.hedera.chainId;

    await (await poolManager.setSourceParams(HEDERA_ID, SPOKE_ADDRESSES.hedera.vault, SPOKE_ADDRESSES.hedera.usdc, true)).wait();
    await (await poolManager.setSourceParams(HEDERA_ID, SPOKE_ADDRESSES.hedera.vault, SPOKE_ADDRESSES.hedera.usdt, true)).wait();

    await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdc, true)).wait();
    await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdt, true)).wait();
    console.log("✅ Hedera vaults and tokens whitelisted");

    console.log("\n" + "=".repeat(60));
    console.log("MASTER DEPLOYMENT COMPLETE - CREDITCOIN V2");
    console.log("=".repeat(60));
    console.log(`PoolManager:     ${poolManagerAddress}`);
    console.log(`LoanEngine:      ${loanEngineAddress}`);
    console.log(`ScoreManager:    ${scoreManagerAddress}`);
    console.log(`ProtocolFunds:   ${protocolFundsAddress}`);
    console.log(`EvmV1Decoder:    ${decoderAddress}`);
    console.log("=".repeat(60));

    // Save all addresses
    const fs = require("fs");
    const deploymentData = {
        master: {
            network: hre.network.name,
            chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
            poolManager: poolManagerAddress,
            loanEngine: loanEngineAddress,
            scoreManager: scoreManagerAddress,
            protocolFunds: protocolFundsAddress,
            evmV1Decoder: decoderAddress
        },
        spokes: SPOKE_ADDRESSES
    };

    fs.writeFileSync("deployments.json", JSON.stringify(deploymentData, null, 2));
    console.log("\n✅ Deployment addresses saved to deployments.json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
