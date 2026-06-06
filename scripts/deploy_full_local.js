const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // 1. Deploy Tokens (fresh deployment)
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USDC", "USDC", 18);
    await usdc.waitForDeployment();
    console.log("USDC deployed to:", usdc.target);

    const usdt = await MockERC20.deploy("USDT", "USDT", 18);
    await usdt.waitForDeployment();
    console.log("USDT deployed to:", usdt.target);

    const ctc = await MockERC20.deploy("Creditcoin", "CTC", 18);
    await ctc.waitForDeployment();
    console.log("CTC deployed to:", ctc.target);

    // 0. Deploy Mock Oracle Infrastructure (Needed for both Hub and Spoke)
    const MockOracleRelayer = await hre.ethers.getContractFactory("MockOracleRelayer");
    const oracle = await MockOracleRelayer.deploy();
    await oracle.waitForDeployment();
    console.log("MockOracleRelayer deployed to:", oracle.target);

    // 2. Deploy Localnet Infrastructure (Source)
    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    const liquidityVault = await LiquidityVault.deploy(oracle.target);
    await liquidityVault.waitForDeployment();
    console.log("LiquidityVault deployed to:", liquidityVault.target);

    // Whitelist tokens in Vault
    await liquidityVault.setTokenWhitelist(usdc.target, true);
    await liquidityVault.setTokenWhitelist(usdt.target, true);
    console.log("Tokens whitelisted in LiquidityVault");

    // 3. Deploy Hub Infrastructure (Master)
    const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
    const evmV1Decoder = await EvmV1Decoder.deploy();
    await evmV1Decoder.waitForDeployment();
    console.log("EvmV1Decoder deployed to:", evmV1Decoder.target);

    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: {
            EvmV1Decoder: evmV1Decoder.target,
        },
    });
    const poolManager = await PoolManager.deploy(oracle.target);
    await poolManager.waitForDeployment();
    console.log("PoolManager deployed to:", poolManager.target);

    const CreditOracle = await hre.ethers.getContractFactory("CreditOracle");
    const creditOracle = await CreditOracle.deploy(deployer.address);
    await creditOracle.waitForDeployment();
    console.log("CreditOracle deployed to:", creditOracle.target);

    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(poolManager.target, creditOracle.target);
    await scoreManager.waitForDeployment();
    console.log("ScoreManager deployed to:", scoreManager.target);

    const InsurancePool = await hre.ethers.getContractFactory("InsurancePool");
    const insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
    console.log("InsurancePool deployed to:", insurancePool.target);

    const CreditVault = await hre.ethers.getContractFactory("CreditVault");
    const creditVault = await CreditVault.deploy();
    await creditVault.waitForDeployment();
    console.log("CreditVault deployed to:", creditVault.target);

    const ProtocolFunds = await hre.ethers.getContractFactory("ProtocolFunds");
    const protocolFunds = await ProtocolFunds.deploy(deployer.address);
    await protocolFunds.waitForDeployment();
    console.log("ProtocolFunds deployed to:", protocolFunds.target);

    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: {
            EvmV1Decoder: evmV1Decoder.target,
        },
    });
    const loanEngine = await LoanEngine.deploy(scoreManager.target, poolManager.target, oracle.target, protocolFunds.target);
    await loanEngine.waitForDeployment();
    console.log("LoanEngine deployed to:", loanEngine.target);

    const MerchantRouter = await hre.ethers.getContractFactory("MerchantRouter");
    const merchantRouter = await MerchantRouter.deploy(poolManager.target, loanEngine.target);
    await merchantRouter.waitForDeployment();
    console.log("MerchantRouter deployed to:", merchantRouter.target);

    // 4. Setup Permissions/Wiring
    await poolManager.setLoanEngine(loanEngine.target);
    console.log("LoanEngine authorized in PoolManager");

    // In production, ScoreManager would also restrict access to LoanEngine
    await scoreManager.transferOwnership(loanEngine.target);
    console.log("ScoreManager ownership transferred to LoanEngine");

    console.log("\n--- DEPLOYMENT COMPLETE ---");

    // Write addresses to JSON
    const addresses = {
        usdc: usdc.target,
        usdt: usdt.target,
        ctc: ctc.target,
        liquidityVault: liquidityVault.target,
        oracle: oracle.target,
        evmV1Decoder: evmV1Decoder.target,
        poolManager: poolManager.target,
        creditOracle: creditOracle.target,
        scoreManager: scoreManager.target,
        protocolFunds: protocolFunds.target,
        insurancePool: insurancePool.target,
        creditVault: creditVault.target,
        loanEngine: loanEngine.target,
        merchantRouter: merchantRouter.target
    };
    fs.writeFileSync("addresses.json", JSON.stringify(addresses, null, 2));
    console.log("Addresses written to addresses.json");

    // Fund the user for testing
    const USER = "0x0C679b59c792BE94BE6cfE5f5ED78C9ff3E9b38f";
    // Mint tokens to user
    await usdc.mint(USER, hre.ethers.parseUnits("100000", 18));
    await usdt.mint(USER, hre.ethers.parseUnits("100000", 18));
    await ctc.mint(USER, hre.ethers.parseUnits("50000", 18));

    // Send ETH to user
    await deployer.sendTransaction({ to: USER, value: hre.ethers.parseEther("10") });
    console.log(`Funded user ${USER} with tokens and ETH`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
