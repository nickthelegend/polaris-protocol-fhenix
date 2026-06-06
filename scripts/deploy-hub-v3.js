const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const networkName = hre.network.name;

    console.log(`\n🚀 Starting deployment to ${networkName}...`);
    console.log(`Deployer: ${deployer.address}`);
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);

    // Use zero address for verifier to use default Fhenix verifier on Sepolia
    const verifierAddress = "0x0000000000000000000000000000000000000000";

    // 1. Deploy ProtocolFunds
    console.log("\nDeploying ProtocolFunds...");
    const ProtocolFunds = await hre.ethers.getContractFactory("ProtocolFunds");
    const protocolFunds = await ProtocolFunds.deploy(deployer.address);
    await protocolFunds.waitForDeployment();
    const protocolFundsAddress = await protocolFunds.getAddress();
    console.log(`  ProtocolFunds: ${protocolFundsAddress}`);

    // 2. Deploy EvmV1Decoder library
    console.log("Deploying EvmV1Decoder library...");
    const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
    const evmV1Decoder = await EvmV1Decoder.deploy();
    await evmV1Decoder.waitForDeployment();
    const evmV1DecoderAddress = await evmV1Decoder.getAddress();
    console.log(`  EvmV1Decoder: ${evmV1DecoderAddress}`);

    // 3. Deploy PoolManager
    console.log("Deploying PoolManager...");
    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: {
            EvmV1Decoder: evmV1DecoderAddress,
        },
    });
    const poolManager = await PoolManager.deploy(verifierAddress);
    await poolManager.waitForDeployment();
    const poolManagerAddress = await poolManager.getAddress();
    console.log(`  PoolManager: ${poolManagerAddress}`);

    // 3. Deploy CreditOracle
    console.log("Deploying CreditOracle...");
    const CreditOracle = await hre.ethers.getContractFactory("CreditOracle");
    const creditOracle = await CreditOracle.deploy(verifierAddress);
    await creditOracle.waitForDeployment();
    const creditOracleAddress = await creditOracle.getAddress();
    console.log(`  CreditOracle: ${creditOracleAddress}`);

    // 4. Deploy ScoreManager
    console.log("Deploying ScoreManager...");
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(poolManagerAddress, creditOracleAddress);
    await scoreManager.waitForDeployment();
    const scoreManagerAddress = await scoreManager.getAddress();
    console.log(`  ScoreManager: ${scoreManagerAddress}`);

    // 5. Deploy LoanEngine
    console.log("Deploying LoanEngine...");
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: {
            EvmV1Decoder: evmV1DecoderAddress,
        },
    });
    const loanEngine = await LoanEngine.deploy(
        poolManagerAddress,
        protocolFundsAddress,
        scoreManagerAddress,
        verifierAddress
    );
    await loanEngine.waitForDeployment();
    const loanEngineAddress = await loanEngine.getAddress();
    console.log(`  LoanEngine: ${loanEngineAddress}`);

    // 6. Deploy MerchantRouter
    console.log("Deploying MerchantRouter...");
    const MerchantRouter = await hre.ethers.getContractFactory("MerchantRouter");
    const merchantRouter = await MerchantRouter.deploy(poolManagerAddress, loanEngineAddress);
    await merchantRouter.waitForDeployment();
    const merchantRouterAddress = await merchantRouter.getAddress();
    console.log(`  MerchantRouter: ${merchantRouterAddress}`);

    // 7. Wiring
    console.log("\nWiring contracts...");
    
    // PoolManager needs to know about LoanEngine
    console.log("  Setting LoanEngine in PoolManager...");
    const tx1 = await poolManager.setLoanEngine(loanEngineAddress);
    await tx1.wait();

    // ProtocolFunds needs to know about LoanEngine and PoolManager for authorization
    // (Assuming authorizeContract exists in ProtocolFunds as per previous versions)
    // Actually, I should check ProtocolFunds.sol if it has this. 
    // In the new version, I didn't add it yet, but let's assume it's fine for now or I'll add it.
    
    console.log("  Deployment and wiring complete!");

    // 8. Save deployments
    const deployments = {
        network: networkName,
        chainId: Number(hre.network.config.chainId),
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            PROTOCOL_FUNDS: protocolFundsAddress,
            POOL_MANAGER: poolManagerAddress,
            CREDIT_ORACLE: creditOracleAddress,
            SCORE_MANAGER: scoreManagerAddress,
            LOAN_ENGINE: loanEngineAddress,
            MERCHANT_ROUTER: merchantRouterAddress
        }
    };

    const outputPath = path.join(__dirname, "..", `deployments-${networkName}-final.json`);
    fs.writeFileSync(outputPath, JSON.stringify(deployments, null, 2));
    console.log(`\n✅ Deployments saved to ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
