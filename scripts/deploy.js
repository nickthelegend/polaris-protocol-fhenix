const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // 1. Deploy Mock Tokens
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 18);
    await usdc.waitForDeployment();
    console.log("USDC deployed to:", await usdc.getAddress());

    const usdt = await MockERC20.deploy("Tether", "USDT", 18);
    await usdt.waitForDeployment();
    console.log("USDT deployed to:", await usdt.getAddress());

    // Mint some tokens to deployer
    await usdc.mint(deployer.address, hre.ethers.parseEther("1000000"));
    await usdt.mint(deployer.address, hre.ethers.parseEther("1000000"));

    // 2. Deploy LiquidityVault
    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    const vault = await LiquidityVault.deploy();
    await vault.waitForDeployment();
    console.log("LiquidityVault deployed to:", await vault.getAddress());

    // Whitelist tokens
    await vault.setTokenWhitelist(await usdc.getAddress(), true);
    await vault.setTokenWhitelist(await usdt.getAddress(), true);

    // 3. Deploy Oracle (Mock for local)
    const MockUSCOracle = await hre.ethers.getContractFactory("MockUSCOracle");
    const oracle = await MockUSCOracle.deploy();
    await oracle.waitForDeployment();
    console.log("MockUSCOracle deployed to:", await oracle.getAddress());

    // 4. Deploy PoolManager
    const PoolManager = await hre.ethers.getContractFactory("PoolManager");
    const poolManager = await PoolManager.deploy(await oracle.getAddress());
    await poolManager.waitForDeployment();
    console.log("PoolManager deployed to:", await poolManager.getAddress());

    // 5. Deploy CreditVault
    const CreditVault = await hre.ethers.getContractFactory("CreditVault");
    const creditVault = await CreditVault.deploy();
    await creditVault.waitForDeployment();
    console.log("CreditVault deployed to:", await creditVault.getAddress());

    // 6. Deploy LoanEngine
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine");
    const loanEngine = await LoanEngine.deploy(await creditVault.getAddress(), await poolManager.getAddress());
    await loanEngine.waitForDeployment();
    console.log("LoanEngine deployed to:", await loanEngine.getAddress());

    // 7. Deploy MerchantRouter
    const MerchantRouter = await hre.ethers.getContractFactory("MerchantRouter");
    const merchantRouter = await MerchantRouter.deploy(await poolManager.getAddress());
    await merchantRouter.waitForDeployment();
    console.log("MerchantRouter deployed to:", await merchantRouter.getAddress());

    // 8. Deploy InsurancePool
    const InsurancePool = await hre.ethers.getContractFactory("InsurancePool");
    const insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
    console.log("InsurancePool deployed to:", await insurancePool.getAddress());

    console.log("Deployment complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
