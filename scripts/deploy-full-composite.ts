import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("🚀 Starting Full Polaris Protocol Deployment on Sepolia");
    console.log("📍 Account:", deployer.address);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

    if (balance < ethers.parseEther("0.1")) {
        console.warn("⚠️ Warning: Low balance. Deployment might fail due to gas.");
    }

    // --- 1. DEPLOY TOKENS ---
    console.log("\n--- 1. Deploying Mock Tokens ---");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const mockBNB = await MockERC20.deploy("Mock BNB", "BNB", 18);
    await mockBNB.waitForDeployment();
    const bnbAddr = await mockBNB.getAddress();
    console.log("✅ MockBNB:", bnbAddr);

    const mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    const usdcAddr = await mockUSDC.getAddress();
    console.log("✅ MockUSDC:", usdcAddr);

    const mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", 6);
    await mockUSDT.waitForDeployment();
    const usdtAddr = await mockUSDT.getAddress();
    console.log("✅ MockUSDT:", usdtAddr);

    const mockWETH = await MockERC20.deploy("Mock WETH", "WETH", 18);
    await mockWETH.waitForDeployment();
    const wethAddr = await mockWETH.getAddress();
    console.log("✅ MockWETH:", wethAddr);

    // --- 2. DEPLOY FOUNDATIONS ---
    console.log("\n--- 2. Deploying Base Infrastructure ---");
    const EvmV1Decoder = await ethers.getContractFactory("EvmV1Decoder");
    const decoder = await EvmV1Decoder.deploy();
    await decoder.waitForDeployment();
    const decoderAddr = await decoder.getAddress();
    console.log("✅ EvmV1Decoder:", decoderAddr);

    const CreditOracle = await ethers.getContractFactory("CreditOracle");
    const oracle = await CreditOracle.deploy(deployer.address);
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();
    console.log("✅ CreditOracle:", oracleAddr);

    const ProtocolFunds = await ethers.getContractFactory("ProtocolFunds");
    const funds = await ProtocolFunds.deploy(deployer.address);
    await funds.waitForDeployment();
    const fundsAddr = await funds.getAddress();
    console.log("✅ ProtocolFunds:", fundsAddr);

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
    const insurance = await InsurancePool.deploy();
    await insurance.waitForDeployment();
    const insuranceAddr = await insurance.getAddress();
    console.log("✅ InsurancePool:", insuranceAddr);

    // --- 3. DEPLOY MANAGEMENT ---
    console.log("\n--- 3. Deploying Pool & Score Managers ---");
    const PoolManager = await ethers.getContractFactory("PoolManager", {
        libraries: { EvmV1Decoder: decoderAddr }
    });
    const poolManager = await PoolManager.deploy(ethers.ZeroAddress);
    await poolManager.waitForDeployment();
    const poolManagerAddr = await poolManager.getAddress();
    console.log("✅ PoolManager:", poolManagerAddr);

    const ScoreManager = await ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(poolManagerAddr, oracleAddr);
    await scoreManager.waitForDeployment();
    const scoreManagerAddr = await scoreManager.getAddress();
    console.log("✅ ScoreManager:", scoreManagerAddr);

    const LoanEngine = await ethers.getContractFactory("LoanEngine", {
        libraries: { EvmV1Decoder: decoderAddr }
    });
    const loanEngine = await LoanEngine.deploy(scoreManagerAddr, poolManagerAddr, ethers.ZeroAddress, fundsAddr);
    await loanEngine.waitForDeployment();
    const loanEngineAddr = await loanEngine.getAddress();
    console.log("✅ LoanEngine:", loanEngineAddr);

    // --- 4. DEPLOY PUBLIC MARKETS ---
    console.log("\n--- 4. Deploying Lending & AMM Pools ---");
    
    // Lending Pools
    const LP_BNB = await (await ethers.getContractFactory("LendingPoolBNB")).deploy(bnbAddr);
    const LP_USDC = await (await ethers.getContractFactory("LendingPoolUSDC")).deploy(usdcAddr);
    const LP_USDT = await (await ethers.getContractFactory("LendingPoolUSDT")).deploy(usdtAddr);
    const LP_WETH = await (await ethers.getContractFactory("LendingPoolWETH")).deploy(wethAddr);
    await Promise.all([LP_BNB, LP_USDC, LP_USDT, LP_WETH].map(p => p.waitForDeployment()));
    console.log("✅ Public Lending Pools Deployed");

    // AMM Pools
    const AMM_BNB_USDC = await (await ethers.getContractFactory("AMMPoolBNB_USDC")).deploy(bnbAddr, usdcAddr);
    const AMM_BNB_USDT = await (await ethers.getContractFactory("AMMPoolBNB_USDT")).deploy(bnbAddr, usdtAddr);
    const AMM_WETH_USDC = await (await ethers.getContractFactory("AMMPoolWETH_USDC")).deploy(wethAddr, usdcAddr);
    const AMM_WETH_USDT = await (await ethers.getContractFactory("AMMPoolWETH_USDT")).deploy(wethAddr, usdtAddr);
    await Promise.all([AMM_BNB_USDC, AMM_BNB_USDT, AMM_WETH_USDC, AMM_WETH_USDT].map(p => p.waitForDeployment()));
    console.log("✅ AMM Pools Deployed");

    // --- 5. DEPLOY PRIVATE FHE LAYER ---
    console.log("\n--- 5. Deploying Private FHE Layer ---");
    
    const PrivateCollateralVault = await (await ethers.getContractFactory("PrivateCollateralVault")).deploy();
    const PrivateLendingPool = await (await ethers.getContractFactory("PrivateLendingPool")).deploy();
    await Promise.all([PrivateCollateralVault, PrivateLendingPool].map(p => p.waitForDeployment()));
    const pVaultAddr = await PrivateCollateralVault.getAddress();
    const pPoolAddr = await PrivateLendingPool.getAddress();

    const PrivateBorrowManager = await (await ethers.getContractFactory("PrivateBorrowManager")).deploy(pVaultAddr);
    await PrivateBorrowManager.waitForDeployment();
    const pBorrowAddr = await PrivateBorrowManager.getAddress();

    const PrivateLiquidationEngine = await (await ethers.getContractFactory("PrivateLiquidationEngine")).deploy(pVaultAddr, pBorrowAddr);
    await PrivateLiquidationEngine.waitForDeployment();
    const pLiqAddr = await PrivateLiquidationEngine.getAddress();

    // Private Swaps
    const PS_BNB = await (await ethers.getContractFactory("PrivateSwapBNB")).deploy(bnbAddr);
    const PS_USDC = await (await ethers.getContractFactory("PrivateSwapUSDC")).deploy(usdcAddr);
    const PS_USDT = await (await ethers.getContractFactory("PrivateSwapUSDT")).deploy(usdtAddr);
    const PS_WETH = await (await ethers.getContractFactory("PrivateSwapWETH")).deploy(wethAddr);
    await Promise.all([PS_BNB, PS_USDC, PS_USDT, PS_WETH].map(p => p.waitForDeployment()));
    console.log("✅ Private FHE Layer Deployed");

    // --- 6. WIRING & CONFIGURATION ---
    console.log("\n--- 6. Wiring & Configuration ---");
    
    await (await scoreManager.transferOwnership(loanEngineAddr)).wait();
    await (await poolManager.setLoanEngine(loanEngineAddr)).wait();
    
    const SEPOLIA_ID = 11155111;
    await (await poolManager.setWhitelistedToken(usdcAddr, true)).wait();
    await (await poolManager.setWhitelistedToken(usdtAddr, true)).wait();
    // Simplified wiring for tokens (self-vaulting or similar logic if needed)

    // Private Suite Wiring
    await (await PrivateCollateralVault.authorizeContract(pBorrowAddr)).wait();
    await (await PrivateCollateralVault.authorizeContract(pLiqAddr)).wait();
    await (await PrivateBorrowManager.setLendingPool(pPoolAddr)).wait();
    await (await PrivateBorrowManager.authorizeContract(pLiqAddr)).wait();
    await (await PrivateLendingPool.setBorrowManager(pBorrowAddr)).wait();
    console.log("✅ Wiring Complete");

    const deployments = {
        network: "sepolia",
        contracts: {
            MockBNB: bnbAddr,
            MockUSDC: usdcAddr,
            MockUSDT: usdtAddr,
            MockWETH: wethAddr,
            CreditOracle: oracleAddr,
            ProtocolFunds: fundsAddr,
            EvmV1Decoder: decoderAddr,
            PoolManager: poolManagerAddr,
            ScoreManager: scoreManagerAddr,
            LoanEngine: loanEngineAddr,
            InsurancePool: insuranceAddr,
            LendingPoolBNB: await LP_BNB.getAddress(),
            LendingPoolUSDC: await LP_USDC.getAddress(),
            LendingPoolUSDT: await LP_USDT.getAddress(),
            LendingPoolWETH: await LP_WETH.getAddress(),
            AMMPoolBNB_USDC: await AMM_BNB_USDC.getAddress(),
            AMMPoolBNB_USDT: await AMM_BNB_USDT.getAddress(),
            AMMPoolWETH_USDC: await AMM_WETH_USDC.getAddress(),
            AMMPoolWETH_USDT: await AMM_WETH_USDT.getAddress(),
            PrivateCollateralVault: pVaultAddr,
            PrivateLendingPool: pPoolAddr,
            PrivateBorrowManager: pBorrowAddr,
            PrivateLiquidationEngine: pLiqAddr,
            PrivateSwapBNB: await PS_BNB.getAddress(),
            PrivateSwapUSDC: await PS_USDC.getAddress(),
            PrivateSwapUSDT: await PS_USDT.getAddress(),
            PrivateSwapWETH: await PS_WETH.getAddress(),
        }
    };

    const outPath = path.join(__dirname, "..", "deployments-sepolia-final.json");
    fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
    console.log("\n✅ Global Deployment Data saved to deployments-sepolia-final.json");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
