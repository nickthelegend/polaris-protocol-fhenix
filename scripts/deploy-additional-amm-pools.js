const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n🚀 Deploying Additional AMM Pools (WETH-USDC & WETH-USDT)...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Load existing deployments
  const existingDeployments = JSON.parse(fs.readFileSync("deployments-lending-amm.json", "utf8"));
  
  const wethAddress = existingDeployments.mockTokens.WETH;
  const usdcAddress = existingDeployments.mockTokens.USDC;
  const usdtAddress = existingDeployments.mockTokens.USDT;

  console.log("\n📦 Using existing token addresses:");
  console.log("├─ WETH:", wethAddress);
  console.log("├─ USDC:", usdcAddress);
  console.log("└─ USDT:", usdtAddress);

  // ========== Deploy WETH-USDC Pool ==========
  console.log("\n🔄 Deploying WETH-USDC AMM Pool...");
  const AMMPoolWETH_USDC = await hre.ethers.getContractFactory("AMMPoolWETH_USDC");
  const ammWETH_USDC = await AMMPoolWETH_USDC.deploy(wethAddress, usdcAddress);
  await ammWETH_USDC.waitForDeployment();
  const wethUsdcAddress = await ammWETH_USDC.getAddress();
  console.log("✅ AMMPoolWETH_USDC deployed to:", wethUsdcAddress);

  // ========== Deploy WETH-USDT Pool ==========
  console.log("\n🔄 Deploying WETH-USDT AMM Pool...");
  const AMMPoolWETH_USDT = await hre.ethers.getContractFactory("AMMPoolWETH_USDT");
  const ammWETH_USDT = await AMMPoolWETH_USDT.deploy(wethAddress, usdtAddress);
  await ammWETH_USDT.waitForDeployment();
  const wethUsdtAddress = await ammWETH_USDT.getAddress();
  console.log("✅ AMMPoolWETH_USDT deployed to:", wethUsdtAddress);

  // ========== Add Initial Liquidity ==========
  console.log("\n💧 Adding Initial Liquidity to New AMM Pools...");

  // Get token contracts
  const weth = await hre.ethers.getContractAt("MockWETH", wethAddress);
  const usdc = await hre.ethers.getContractAt("MockUSDC", usdcAddress);
  const usdt = await hre.ethers.getContractAt("MockUSDT", usdtAddress);

  // Amounts for liquidity (assuming 1 WETH = $2000)
  const wethAmount = hre.ethers.parseEther("50"); // 50 WETH
  const usdcAmount = hre.ethers.parseUnits("100000", 6); // 100,000 USDC
  const usdtAmount = hre.ethers.parseUnits("100000", 6); // 100,000 USDT

  // Add liquidity to WETH-USDC pool
  console.log("\n💰 Adding liquidity to WETH-USDC pool...");
  await weth.approve(wethUsdcAddress, wethAmount);
  await usdc.approve(wethUsdcAddress, usdcAmount);
  await ammWETH_USDC.addLiquidity(wethAmount, usdcAmount);
  console.log("✅ Added liquidity to WETH-USDC pool: 50 WETH + 100,000 USDC");

  // Add liquidity to WETH-USDT pool
  console.log("\n💰 Adding liquidity to WETH-USDT pool...");
  await weth.approve(wethUsdtAddress, wethAmount);
  await usdt.approve(wethUsdtAddress, usdtAmount);
  await ammWETH_USDT.addLiquidity(wethAmount, usdtAmount);
  console.log("✅ Added liquidity to WETH-USDT pool: 50 WETH + 100,000 USDT");

  // ========== Update Deployment File ==========
  existingDeployments.ammPools.WETH_USDC = wethUsdcAddress;
  existingDeployments.ammPools.WETH_USDT = wethUsdtAddress;

  fs.writeFileSync("deployments-lending-amm.json", JSON.stringify(existingDeployments, null, 2));
  console.log("\n📄 Updated deployments-lending-amm.json");

  // ========== Print Summary ==========
  console.log("\n" + "=".repeat(80));
  console.log("📊 NEW AMM POOLS DEPLOYMENT SUMMARY");
  console.log("=".repeat(80));
  console.log("\n🔄 New AMM Pools:");
  console.log("├─ WETH-USDC:", wethUsdcAddress);
  console.log("└─ WETH-USDT:", wethUsdtAddress);
  
  console.log("\n💧 Initial Liquidity:");
  console.log("├─ WETH-USDC: 50 WETH + 100,000 USDC");
  console.log("└─ WETH-USDT: 50 WETH + 100,000 USDT");

  console.log("\n🎯 All AMM Pools:");
  console.log("├─ BNB-USDC:", existingDeployments.ammPools.BNB_USDC);
  console.log("├─ BNB-USDT:", existingDeployments.ammPools.BNB_USDT);
  console.log("├─ WETH-USDC:", wethUsdcAddress);
  console.log("└─ WETH-USDT:", wethUsdtAddress);
  
  console.log("\n" + "=".repeat(80));
  console.log("✅ Additional AMM pools deployed and initialized successfully!");
  console.log("=".repeat(80) + "\n");

  return {
    WETH_USDC: wethUsdcAddress,
    WETH_USDT: wethUsdtAddress
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
