const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n🚀 Starting Lending & AMM Deployment...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const deployments = {
    mockTokens: {},
    lendingPools: {},
    privateSwaps: {},
    ammPools: {}
  };

  // ========== PHASE 1: Deploy Mock Tokens ==========
  console.log("\n📦 Phase 1: Deploying Mock Tokens...");
  
  const MockWETH = await hre.ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  deployments.mockTokens.WETH = await weth.getAddress();
  console.log("✅ MockWETH deployed to:", deployments.mockTokens.WETH);

  const MockBNB = await hre.ethers.getContractFactory("MockBNB");
  const bnb = await MockBNB.deploy();
  await bnb.waitForDeployment();
  deployments.mockTokens.BNB = await bnb.getAddress();
  console.log("✅ MockBNB deployed to:", deployments.mockTokens.BNB);

  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  deployments.mockTokens.USDC = await usdc.getAddress();
  console.log("✅ MockUSDC deployed to:", deployments.mockTokens.USDC);

  const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
  const usdt = await MockUSDT.deploy();
  await usdt.waitForDeployment();
  deployments.mockTokens.USDT = await usdt.getAddress();
  console.log("✅ MockUSDT deployed to:", deployments.mockTokens.USDT);

  // ========== PHASE 2: Deploy Lending Pools ==========
  console.log("\n💰 Phase 2: Deploying Lending Pools...");

  const LendingPoolWETH = await hre.ethers.getContractFactory("LendingPoolWETH");
  const lendingWETH = await LendingPoolWETH.deploy(deployments.mockTokens.WETH);
  await lendingWETH.waitForDeployment();
  deployments.lendingPools.WETH = await lendingWETH.getAddress();
  console.log("✅ LendingPoolWETH deployed to:", deployments.lendingPools.WETH);

  const LendingPoolBNB = await hre.ethers.getContractFactory("LendingPoolBNB");
  const lendingBNB = await LendingPoolBNB.deploy(deployments.mockTokens.BNB);
  await lendingBNB.waitForDeployment();
  deployments.lendingPools.BNB = await lendingBNB.getAddress();
  console.log("✅ LendingPoolBNB deployed to:", deployments.lendingPools.BNB);

  const LendingPoolUSDC = await hre.ethers.getContractFactory("LendingPoolUSDC");
  const lendingUSDC = await LendingPoolUSDC.deploy(deployments.mockTokens.USDC);
  await lendingUSDC.waitForDeployment();
  deployments.lendingPools.USDC = await lendingUSDC.getAddress();
  console.log("✅ LendingPoolUSDC deployed to:", deployments.lendingPools.USDC);

  const LendingPoolUSDT = await hre.ethers.getContractFactory("LendingPoolUSDT");
  const lendingUSDT = await LendingPoolUSDT.deploy(deployments.mockTokens.USDT);
  await lendingUSDT.waitForDeployment();
  deployments.lendingPools.USDT = await lendingUSDT.getAddress();
  console.log("✅ LendingPoolUSDT deployed to:", deployments.lendingPools.USDT);

  // ========== PHASE 3: Deploy Private Swap Contracts ==========
  console.log("\n🔐 Phase 3: Deploying Private Swap Contracts...");

  const PrivateSwapWETH = await hre.ethers.getContractFactory("PrivateSwapWETH");
  const swapWETH = await PrivateSwapWETH.deploy(deployments.mockTokens.WETH);
  await swapWETH.waitForDeployment();
  deployments.privateSwaps.WETH = await swapWETH.getAddress();
  console.log("✅ PrivateSwapWETH deployed to:", deployments.privateSwaps.WETH);

  const PrivateSwapBNB = await hre.ethers.getContractFactory("PrivateSwapBNB");
  const swapBNB = await PrivateSwapBNB.deploy(deployments.mockTokens.BNB);
  await swapBNB.waitForDeployment();
  deployments.privateSwaps.BNB = await swapBNB.getAddress();
  console.log("✅ PrivateSwapBNB deployed to:", deployments.privateSwaps.BNB);

  const PrivateSwapUSDC = await hre.ethers.getContractFactory("PrivateSwapUSDC");
  const swapUSDC = await PrivateSwapUSDC.deploy(deployments.mockTokens.USDC);
  await swapUSDC.waitForDeployment();
  deployments.privateSwaps.USDC = await swapUSDC.getAddress();
  console.log("✅ PrivateSwapUSDC deployed to:", deployments.privateSwaps.USDC);

  const PrivateSwapUSDT = await hre.ethers.getContractFactory("PrivateSwapUSDT");
  const swapUSDT = await PrivateSwapUSDT.deploy(deployments.mockTokens.USDT);
  await swapUSDT.waitForDeployment();
  deployments.privateSwaps.USDT = await swapUSDT.getAddress();
  console.log("✅ PrivateSwapUSDT deployed to:", deployments.privateSwaps.USDT);

  // ========== PHASE 4: Deploy AMM Pools ==========
  console.log("\n🔄 Phase 4: Deploying AMM Pools...");

  const AMMPoolBNB_USDC = await hre.ethers.getContractFactory("AMMPoolBNB_USDC");
  const ammBNB_USDC = await AMMPoolBNB_USDC.deploy(deployments.mockTokens.BNB, deployments.mockTokens.USDC);
  await ammBNB_USDC.waitForDeployment();
  deployments.ammPools.BNB_USDC = await ammBNB_USDC.getAddress();
  console.log("✅ AMMPoolBNB_USDC deployed to:", deployments.ammPools.BNB_USDC);

  const AMMPoolBNB_USDT = await hre.ethers.getContractFactory("AMMPoolBNB_USDT");
  const ammBNB_USDT = await AMMPoolBNB_USDT.deploy(deployments.mockTokens.BNB, deployments.mockTokens.USDT);
  await ammBNB_USDT.waitForDeployment();
  deployments.ammPools.BNB_USDT = await ammBNB_USDT.getAddress();
  console.log("✅ AMMPoolBNB_USDT deployed to:", deployments.ammPools.BNB_USDT);

  // ========== PHASE 5: Add Initial Liquidity ==========
  console.log("\n💧 Phase 5: Adding Initial Liquidity to AMM Pools...");

  // Approve tokens for AMM pools
  const bnbAmount = hre.ethers.parseEther("100"); // 100 BNB
  const usdcAmount = hre.ethers.parseUnits("30000", 6); // 30,000 USDC (assuming 1 BNB = $300)
  const usdtAmount = hre.ethers.parseUnits("30000", 6); // 30,000 USDT

  // Add liquidity to BNB-USDC pool
  await bnb.approve(deployments.ammPools.BNB_USDC, bnbAmount);
  await usdc.approve(deployments.ammPools.BNB_USDC, usdcAmount);
  await ammBNB_USDC.addLiquidity(bnbAmount, usdcAmount);
  console.log("✅ Added liquidity to BNB-USDC pool: 100 BNB + 30,000 USDC");

  // Add liquidity to BNB-USDT pool
  await bnb.approve(deployments.ammPools.BNB_USDT, bnbAmount);
  await usdt.approve(deployments.ammPools.BNB_USDT, usdtAmount);
  await ammBNB_USDT.addLiquidity(bnbAmount, usdtAmount);
  console.log("✅ Added liquidity to BNB-USDT pool: 100 BNB + 30,000 USDT");

  // ========== Save Deployment Info ==========
  const deploymentFile = "deployments-lending-amm.json";
  fs.writeFileSync(deploymentFile, JSON.stringify(deployments, null, 2));
  console.log(`\n📄 Deployment info saved to ${deploymentFile}`);

  // ========== Print Summary Table ==========
  console.log("\n" + "=".repeat(80));
  console.log("📊 DEPLOYMENT SUMMARY");
  console.log("=".repeat(80));
  console.log("\n🪙 Mock Tokens:");
  console.log("├─ WETH:", deployments.mockTokens.WETH);
  console.log("├─ BNB:", deployments.mockTokens.BNB);
  console.log("├─ USDC:", deployments.mockTokens.USDC);
  console.log("└─ USDT:", deployments.mockTokens.USDT);
  
  console.log("\n💰 Lending Pools:");
  console.log("├─ WETH:", deployments.lendingPools.WETH);
  console.log("├─ BNB:", deployments.lendingPools.BNB);
  console.log("├─ USDC:", deployments.lendingPools.USDC);
  console.log("└─ USDT:", deployments.lendingPools.USDT);
  
  console.log("\n🔐 Private Swaps:");
  console.log("├─ WETH:", deployments.privateSwaps.WETH);
  console.log("├─ BNB:", deployments.privateSwaps.BNB);
  console.log("├─ USDC:", deployments.privateSwaps.USDC);
  console.log("└─ USDT:", deployments.privateSwaps.USDT);
  
  console.log("\n🔄 AMM Pools:");
  console.log("├─ BNB-USDC:", deployments.ammPools.BNB_USDC);
  console.log("└─ BNB-USDT:", deployments.ammPools.BNB_USDT);
  
  console.log("\n" + "=".repeat(80));
  console.log("✅ All contracts deployed and initialized successfully!");
  console.log("=".repeat(80) + "\n");

  return deployments;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
