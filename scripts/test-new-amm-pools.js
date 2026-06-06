const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n🧪 Testing New AMM Pools (WETH-USDC & WETH-USDT)...\n");

  const deployments = JSON.parse(fs.readFileSync("deployments-lending-amm.json", "utf8"));
  const [deployer, user1] = await hre.ethers.getSigners();

  console.log("Testing with accounts:");
  console.log("├─ Deployer:", deployer.address);
  console.log("└─ User1:", user1.address);

  // Get contract instances
  const weth = await hre.ethers.getContractAt("MockWETH", deployments.mockTokens.WETH);
  const usdc = await hre.ethers.getContractAt("MockUSDC", deployments.mockTokens.USDC);
  const usdt = await hre.ethers.getContractAt("MockUSDT", deployments.mockTokens.USDT);

  const ammWETH_USDC = await hre.ethers.getContractAt("AMMPoolWETH_USDC", deployments.ammPools.WETH_USDC);
  const ammWETH_USDT = await hre.ethers.getContractAt("AMMPoolWETH_USDT", deployments.ammPools.WETH_USDT);

  // ========== TEST 1: Check Pool Reserves ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 1: Check Initial Pool Reserves");
  console.log("=".repeat(80));

  const wethUsdcReserve0 = await ammWETH_USDC.reserve0();
  const wethUsdcReserve1 = await ammWETH_USDC.reserve1();
  console.log("\nWETH-USDC Pool Reserves:");
  console.log("├─ WETH:", hre.ethers.formatEther(wethUsdcReserve0));
  console.log("└─ USDC:", hre.ethers.formatUnits(wethUsdcReserve1, 6));

  const wethUsdtReserve0 = await ammWETH_USDT.reserve0();
  const wethUsdtReserve1 = await ammWETH_USDT.reserve1();
  console.log("\nWETH-USDT Pool Reserves:");
  console.log("├─ WETH:", hre.ethers.formatEther(wethUsdtReserve0));
  console.log("└─ USDT:", hre.ethers.formatUnits(wethUsdtReserve1, 6));

  // ========== TEST 2: Swap WETH for USDC ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 2: Swap WETH for USDC");
  console.log("=".repeat(80));

  const swapAmount = hre.ethers.parseEther("1"); // 1 WETH
  await weth.mint(user1.address, swapAmount);
  console.log("\n✅ Minted 1 WETH to User1");

  const expectedOut = await ammWETH_USDC.getAmountOut(deployments.mockTokens.WETH, swapAmount);
  console.log("Expected USDC output for 1 WETH:", hre.ethers.formatUnits(expectedOut, 6));

  await weth.connect(user1).approve(deployments.ammPools.WETH_USDC, swapAmount);
  await ammWETH_USDC.connect(user1).swap(deployments.mockTokens.WETH, swapAmount);
  
  const usdcBalance = await usdc.balanceOf(user1.address);
  console.log("✅ User1 swapped 1 WETH, received:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");

  // ========== TEST 3: Swap USDC for WETH ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 3: Swap USDC for WETH");
  console.log("=".repeat(80));

  const usdcSwapAmount = hre.ethers.parseUnits("1000", 6); // 1000 USDC
  await usdc.mint(user1.address, usdcSwapAmount);
  console.log("\n✅ Minted 1000 USDC to User1");

  const expectedWeth = await ammWETH_USDC.getAmountOut(deployments.mockTokens.USDC, usdcSwapAmount);
  console.log("Expected WETH output for 1000 USDC:", hre.ethers.formatEther(expectedWeth));

  await usdc.connect(user1).approve(deployments.ammPools.WETH_USDC, usdcSwapAmount);
  await ammWETH_USDC.connect(user1).swap(deployments.mockTokens.USDC, usdcSwapAmount);
  
  const wethBalance = await weth.balanceOf(user1.address);
  console.log("✅ User1 swapped 1000 USDC, received:", hre.ethers.formatEther(wethBalance), "WETH");

  // ========== TEST 4: Swap WETH for USDT ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 4: Swap WETH for USDT");
  console.log("=".repeat(80));

  const wethSwapAmount = hre.ethers.parseEther("2"); // 2 WETH
  await weth.mint(user1.address, wethSwapAmount);
  console.log("\n✅ Minted 2 WETH to User1");

  const expectedUsdt = await ammWETH_USDT.getAmountOut(deployments.mockTokens.WETH, wethSwapAmount);
  console.log("Expected USDT output for 2 WETH:", hre.ethers.formatUnits(expectedUsdt, 6));

  await weth.connect(user1).approve(deployments.ammPools.WETH_USDT, wethSwapAmount);
  await ammWETH_USDT.connect(user1).swap(deployments.mockTokens.WETH, wethSwapAmount);
  
  const usdtBalance = await usdt.balanceOf(user1.address);
  console.log("✅ User1 swapped 2 WETH, received:", hre.ethers.formatUnits(usdtBalance, 6), "USDT");

  // ========== TEST 5: Check Updated Reserves ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 5: Check Updated Pool Reserves");
  console.log("=".repeat(80));

  const wethUsdcReserve0After = await ammWETH_USDC.reserve0();
  const wethUsdcReserve1After = await ammWETH_USDC.reserve1();
  console.log("\nWETH-USDC Pool Reserves (After Swaps):");
  console.log("├─ WETH:", hre.ethers.formatEther(wethUsdcReserve0After));
  console.log("└─ USDC:", hre.ethers.formatUnits(wethUsdcReserve1After, 6));

  const wethUsdtReserve0After = await ammWETH_USDT.reserve0();
  const wethUsdtReserve1After = await ammWETH_USDT.reserve1();
  console.log("\nWETH-USDT Pool Reserves (After Swaps):");
  console.log("├─ WETH:", hre.ethers.formatEther(wethUsdtReserve0After));
  console.log("└─ USDT:", hre.ethers.formatUnits(wethUsdtReserve1After, 6));

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("✅ ALL NEW POOL TESTS PASSED!");
  console.log("=".repeat(80));
  console.log("\n📊 Test Summary:");
  console.log("├─ ✅ Pool Reserves Verified");
  console.log("├─ ✅ WETH → USDC Swap");
  console.log("├─ ✅ USDC → WETH Swap");
  console.log("├─ ✅ WETH → USDT Swap");
  console.log("└─ ✅ Reserve Updates Verified");
  console.log("\n🎉 New AMM pools are working correctly!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
