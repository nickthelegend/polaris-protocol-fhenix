const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const networkName = hre.network.name;

    console.log(`Starting Core Deployment to ${networkName}`);
    console.log(`Deployer: ${deployer.address}`);

    // Verification check - only run on Creditcoin chains or local
    if (!networkName.includes("Testnet") && !networkName.includes("ganache") && !networkName.includes("hardhat")) {
        console.warn("Warning: You are deploying core protocol contracts to a network that might not be Creditcoin.");
    }

    // 0. Deploy Libraries
    console.log("Deploying Libraries...");
    const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
    const evmV1Decoder = await EvmV1Decoder.deploy();
    await evmV1Decoder.waitForDeployment();
    const evmV1DecoderAddress = await evmV1Decoder.getAddress();
    console.log(`EvmV1Decoder: ${evmV1DecoderAddress}`);

    // 1. Deploy PoolManager
    // Pass ZeroAddress to use the default precompile (0x...FD2)
    console.log("Deploying PoolManager...");
    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: {
            EvmV1Decoder: evmV1DecoderAddress,
        },
    });
    const poolManager = await PoolManager.deploy(hre.ethers.ZeroAddress);
    await poolManager.waitForDeployment();
    const poolManagerAddress = await poolManager.getAddress();
    console.log(`PoolManager: ${poolManagerAddress}`);

    // 2. Deploy ScoreManager
    console.log("Deploying ScoreManager...");
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(poolManagerAddress);
    await scoreManager.waitForDeployment();
    const scoreManagerAddress = await scoreManager.getAddress();
    console.log(`ScoreManager: ${scoreManagerAddress}`);

    // 3. Deploy LoanEngine
    console.log("Deploying LoanEngine...");
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: {
            EvmV1Decoder: evmV1DecoderAddress,
        },
    });
    const loanEngine = await LoanEngine.deploy(
        scoreManagerAddress,
        poolManagerAddress,
        hre.ethers.ZeroAddress // Use default verified
    );
    await loanEngine.waitForDeployment();
    const loanEngineAddress = await loanEngine.getAddress();
    console.log(`LoanEngine: ${loanEngineAddress}`);

    // 4. Deploy MerchantRouter
    console.log("Deploying MerchantRouter...");
    const MerchantRouter = await hre.ethers.getContractFactory("MerchantRouter");
    const merchantRouter = await MerchantRouter.deploy(poolManagerAddress, loanEngineAddress);
    await merchantRouter.waitForDeployment();
    const merchantRouterAddress = await merchantRouter.getAddress();
    console.log(`MerchantRouter: ${merchantRouterAddress}`);

    // 5. Setup Relationships
    console.log("Configuring relationships...");

    // PoolManager needs to know LoanEngine
    const tx1 = await poolManager.setLoanEngine(loanEngineAddress);
    await tx1.wait();
    console.log("- PoolManager.setLoanEngine OK");

    // LoanEngine needs to own ScoreManager to update scores
    const tx2 = await scoreManager.transferOwnership(loanEngineAddress);
    await tx2.wait();
    console.log("- ScoreManager.transferOwnership OK");

    // 6. Save Deployment
    const deployment = {
        network: networkName,
        timestamp: new Date().toISOString(),
        contracts: {
            EvmV1Decoder: evmV1DecoderAddress,
            PoolManager: poolManagerAddress,
            ScoreManager: scoreManagerAddress,
            LoanEngine: loanEngineAddress,
            MerchantRouter: merchantRouterAddress
        }
    };

    fs.writeFileSync("deployments-core.json", JSON.stringify(deployment, null, 2));
    console.log("\nDeployment saved to deployments-core.json");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
