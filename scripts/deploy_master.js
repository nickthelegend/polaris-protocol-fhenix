const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const networkName = hre.network.name;
    console.log(`Deploying Polaris Protocol to ${networkName} with account: ${deployer.address}`);

    const isMasterChain = networkName === "ctcTestnet" || networkName === "uscTestnet";

    if (isMasterChain) {
        console.log("--- MASTER CHAIN DEPLOYMENT (Creditcoin) ---");

        // 1. Prover Address (Official CCNext on USC Testnet)
        let proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";

        if (networkName === "ctcTestnet") {
            // Deploy a mock if using legacy CTC testnet
            const MockProver = await hre.ethers.getContractFactory("MockUSCOracle");
            const mockProver = await MockProver.deploy();
            await mockProver.waitForDeployment();
            proverAddress = await mockProver.getAddress();
            console.log("Mock Prover deployed to:", proverAddress);
        } else {
            console.log("Using Real Prover at:", proverAddress);
        }

        // 2. Deploy PoolManager
        const PoolManager = await hre.ethers.getContractFactory("PoolManager");
        const poolManager = await PoolManager.deploy(proverAddress);
        await poolManager.waitForDeployment();
        const poolManagerAddress = await poolManager.getAddress();
        console.log("PoolManager deployed to:", poolManagerAddress);

        // 2.5. Deploy CreditOracle
        const CreditOracle = await hre.ethers.getContractFactory("CreditOracle");
        const creditOracle = await CreditOracle.deploy(deployer.address); // Initial attester is deployer
        await creditOracle.waitForDeployment();
        const creditOracleAddress = await creditOracle.getAddress();
        console.log("CreditOracle deployed to:", creditOracleAddress);

        // 3. Deploy ScoreManager
        const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
        const scoreManager = await ScoreManager.deploy(poolManagerAddress, creditOracleAddress);
        await scoreManager.waitForDeployment();
        const scoreManagerAddress = await scoreManager.getAddress();
        console.log("ScoreManager deployed to:", scoreManagerAddress);

        // 4. Deploy LoanEngine
        const LoanEngine = await hre.ethers.getContractFactory("LoanEngine");
        const loanEngine = await LoanEngine.deploy(scoreManagerAddress, poolManagerAddress);
        await loanEngine.waitForDeployment();
        const loanEngineAddress = await loanEngine.getAddress();
        console.log("LoanEngine deployed to:", loanEngineAddress);

        // 5. Deploy MerchantRouter
        const MerchantRouter = await hre.ethers.getContractFactory("MerchantRouter");
        const merchantRouter = await MerchantRouter.deploy(poolManagerAddress);
        await merchantRouter.waitForDeployment();
        const merchantRouterAddress = await merchantRouter.getAddress();
        console.log("MerchantRouter deployed to:", merchantRouterAddress);

        // --- SETUP RELATIONSHIPS ---
        console.log("Setting up relationships...");
        await poolManager.setLoanEngine(loanEngineAddress);
        await scoreManager.transferOwnership(loanEngineAddress);
        console.log("Relationships configured.");

        console.log("\n--- Master Contracts Summary ---");
        console.log(`Prover: ${proverAddress}`);
        console.log(`PoolManager: ${poolManagerAddress}`);
        console.log(`ScoreManager: ${scoreManagerAddress}`);
        console.log(`LoanEngine: ${loanEngineAddress}`);
        console.log(`MerchantRouter: ${merchantRouterAddress}`);

    } else {
        // Localnet or Other Source Chains (Gananche, Sepolia, etc.)
        console.log("--- SOURCE CHAIN DEPLOYMENT (Liquidity Hub) ---");

        const gasSettings = networkName === "sepolia" ? {
            gasLimit: 3000000,
            maxPriorityFeePerGas: hre.ethers.parseUnits("2", "gwei"),
            maxFeePerGas: hre.ethers.parseUnits("50", "gwei")
        } : {};

        // 1. Deploy Mock Tokens
        const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20.deploy("USD Coin", "USDC", 18, gasSettings);
        await usdc.waitForDeployment();
        const usdcAddress = await usdc.getAddress();
        console.log("USDC (Mock) deployed to:", usdcAddress);

        const usdt = await MockERC20.deploy("Tether", "USDT", 18, gasSettings);
        await usdt.waitForDeployment();
        const usdtAddress = await usdt.getAddress();
        console.log("USDT (Mock) deployed to:", usdtAddress);

        // 2. Deploy Mock Prover (for source chain verification)
        const MockUSCOracle = await hre.ethers.getContractFactory("MockUSCOracle");
        const oracle = await MockUSCOracle.deploy(gasSettings);
        await oracle.waitForDeployment();
        const oracleAddress = await oracle.getAddress();
        console.log("Mock Oracle deployed to:", oracleAddress);

        // 3. Deploy LiquidityVault
        const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
        const vault = await LiquidityVault.deploy(oracleAddress, gasSettings);
        await vault.waitForDeployment();
        const vaultAddress = await vault.getAddress();
        console.log("LiquidityVault deployed to:", vaultAddress);

        // Whitelist tokens
        console.log("Whitelisting tokens...");
        const tx1 = await vault.setTokenWhitelist(usdcAddress, true, gasSettings);
        await tx1.wait();
        const tx2 = await vault.setTokenWhitelist(usdtAddress, true, gasSettings);
        await tx2.wait();

        // Initial fund for testing
        console.log("Minting tokens...");
        const tx3 = await usdc.mint(deployer.address, hre.ethers.parseEther("1000000"), gasSettings);
        await tx3.wait();
        const tx4 = await usdt.mint(deployer.address, hre.ethers.parseEther("1000000"), gasSettings);
        await tx4.wait();
        console.log("Minted 1M USDC/USDT to deployer for testing.");

        console.log("\n--- Source Contracts Summary ---");
        console.log(`USDC: ${usdcAddress}`);
        console.log(`USDT: ${usdtAddress}`);
        console.log(`Oracle: ${oracleAddress}`);
        console.log(`LiquidityVault: ${vaultAddress}`);
    }

    console.log("\nDeployment complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
