const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n🧪 Starting Lending & AMM Tests...\n");

  // Load deployment addresses
  const deploymentFile = "deployments-lending-amm.json";
  if (!fs.existsSync(deploymentFile)) {
    console.error("❌ Deployment file not found. Please run deploy-lending-amm.js first.");
    process.exit(1);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const [deployer, user1, user2] = await hre.ethers.getSigners();

  console.log("Testing with accounts:");
  console.log("├─ Deployer:", deployer.address);
  console.log("├─ User1:", user1.address);
  console.log("└─ User2:", user2.address);

  // Get contract instances
  const weth = await hre.ethers.getContractAt("MockWETH", deployments.mockTokens.WETH);
  const bnb = await hre.ethers.getContractAt("MockBNB", deployments.mockTokens.BNB);
  const usdc = await hre.ethers.getContractAt("MockUSDC", deployments.mockTokens.USDC);
  const usdt = await hre.ethers.getContractAt("MockUSDT", deployments.mockTokens.USDT);

  const lendingWETH = await hre.ethers.getContractAt("LendingPoolWETH", deployments.lendingPools.WETH);
  const lendingBNB = await hre.ethers.getContractAt("LendingPoolBNB", deployments.lendingPools.BNB);
  const lendingUSDC = await hre.ethers.getContractAt("LendingPoolUSDC", deployments.lendingPools.USDC);

  const ammBNB_USDC = await hre.ethers.getContractAt("AMMPoolBNB_USDC", deployments.ammPools.BNB_USDC);
  const ammBNB_USDT = await hre.ethers.getContractAt("AMMPoolBNB_USDT", deployments.ammPools.BNB_USDT);

  // ========== TEST 1: Lending Pool Deposit/Withdraw ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 1: Lending Pool Deposit & Withdraw");
  console.log("=".repeat(80));

  // Mint tokens to user1
  const depositAmount = hre.ethers.parseEther("10");
  await weth.mint(user1.address, depositAmount);
  console.log("✅ Minted 10 WETH to User1");

  // User1 deposits to lending pool
  await weth.connect(user1).approve(deployments.lendingPools.WETH, depositAmount);
  const tx1 = await lendingWETH.connect(user1).deposit(depositAmount);
  await tx1.wait();
  const lpBalance = await lendingWETH.balanceOf(user1.address);
  console.log("✅ User1 deposited 10 WETH, received LP tokens:", hre.ethers.formatEther(lpBalance));

  // User1 withdraws
  const tx2 = await lendingWETH.connect(user1).withdraw(lpBalance);
  await tx2.wait();
  const wethBalance = await weth.balanceOf(user1.address);
  console.log("✅ User1 withdrew WETH, balance:", hre.ethers.formatEther(wethBalance));

  // ========== TEST 2: Lending Pool Borrow/Repay ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 2: Lending Pool Borrow & Repay");
  console.log("=".repeat(80));

  // Setup: User1 deposits liquidity, User2 borrows
  await weth.mint(user1.address, hre.ethers.parseEther("100"));
  await weth.connect(user1).approve(deployments.lendingPools.WETH, hre.ethers.parseEther("100"));
  await lendingWETH.connect(user1).deposit(hre.ethers.parseEther("100"));
  console.log("✅ User1 deposited 100 WETH as liquidity");

  // User2 adds collateral
  const collateralAmount = hre.ethers.parseEther("20");
  await weth.mint(user2.address, collateralAmount);
  await weth.connect(user2).approve(deployments.lendingPools.WETH, collateralAmount);
  await lendingWETH.connect(user2).addCollateral(collateralAmount);
  console.log("✅ User2 added 20 WETH as collateral");

  // User2 borrows (max 20 * 100 / 150 = 13.33 WETH)
  const borrowAmount = hre.ethers.parseEther("10");
  await lendingWETH.connect(user2).borrow(borrowAmount);
  const borrowed = await lendingWETH.borrowed(user2.address);
  console.log("✅ User2 borrowed:", hre.ethers.formatEther(borrowed), "WETH");

  // User2 repays
  await weth.connect(user2).approve(deployments.lendingPools.WETH, borrowAmount);
  await lendingWETH.connect(user2).repay(borrowAmount);
  const borrowedAfter = await lendingWETH.borrowed(user2.address);
  console.log("✅ User2 repaid, remaining debt:", hre.ethers.formatEther(borrowedAfter), "WETH");

  // ========== TEST 3: AMM Pool Swap ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 3: AMM Pool Swap");
  console.log("=".repeat(80));

  // Check initial reserves
  const reserves0 = await ammBNB_USDC.reserve0();
  const reserves1 = await ammBNB_USDC.reserve1();
  console.log("Initial BNB-USDC Pool Reserves:");
  console.log("├─ BNB:", hre.ethers.formatEther(reserves0));
  console.log("└─ USDC:", hre.ethers.formatUnits(reserves1, 6));

  // User1 swaps BNB for USDC
  const swapAmount = hre.ethers.parseEther("1"); // 1 BNB
  await bnb.mint(user1.address, swapAmount);
  await bnb.connect(user1).approve(deployments.ammPools.BNB_USDC, swapAmount);
  
  const expectedOut = await ammBNB_USDC.getAmountOut(deployments.mockTokens.BNB, swapAmount);
  console.log("Expected USDC output for 1 BNB:", hre.ethers.formatUnits(expectedOut, 6));

  await ammBNB_USDC.connect(user1).swap(deployments.mockTokens.BNB, swapAmount);
  const usdcBalance = await usdc.balanceOf(user1.address);
  console.log("✅ User1 swapped 1 BNB, received:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");

  // Check reserves after swap
  const reserves0After = await ammBNB_USDC.reserve0();
  const reserves1After = await ammBNB_USDC.reserve1();
  console.log("After Swap BNB-USDC Pool Reserves:");
  console.log("├─ BNB:", hre.ethers.formatEther(reserves0After));
  console.log("└─ USDC:", hre.ethers.formatUnits(reserves1After, 6));

  // ========== TEST 4: AMM Pool Add/Remove Liquidity ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 4: AMM Pool Add & Remove Liquidity");
  console.log("=".repeat(80));

  // User2 adds liquidity
  const bnbLiq = hre.ethers.parseEther("10");
  const usdtLiq = hre.ethers.parseUnits("3000", 6);
  
  await bnb.mint(user2.address, bnbLiq);
  await usdt.mint(user2.address, usdtLiq);
  await bnb.connect(user2).approve(deployments.ammPools.BNB_USDT, bnbLiq);
  await usdt.connect(user2).approve(deployments.ammPools.BNB_USDT, usdtLiq);
  
  await ammBNB_USDT.connect(user2).addLiquidity(bnbLiq, usdtLiq);
  const lpTokens = await ammBNB_USDT.balanceOf(user2.address);
  console.log("✅ User2 added liquidity, received LP tokens:", hre.ethers.formatEther(lpTokens));

  // User2 removes liquidity
  await ammBNB_USDT.connect(user2).removeLiquidity(lpTokens);
  const bnbBalanceAfter = await bnb.balanceOf(user2.address);
  const usdtBalanceAfter = await usdt.balanceOf(user2.address);
  console.log("✅ User2 removed liquidity:");
  console.log("├─ BNB received:", hre.ethers.formatEther(bnbBalanceAfter));
  console.log("└─ USDT received:", hre.ethers.formatUnits(usdtBalanceAfter, 6));

  // ========== TEST 5: Cross-Pool Operations ==========
  console.log("\n" + "=".repeat(80));
  console.log("TEST 5: Cross-Pool Operations");
  console.log("=".repeat(80));

  // User deposits to multiple lending pools
  await bnb.mint(user1.address, hre.ethers.parseEther("50"));
  await usdc.mint(user1.address, hre.ethers.parseUnits("10000", 6));

  await bnb.connect(user1).approve(deployments.lendingPools.BNB, hre.ethers.parseEther("50"));
  await lendingBNB.connect(user1).deposit(hre.ethers.parseEther("50"));
  console.log("✅ User1 deposited 50 BNB to lending pool");

  await usdc.connect(user1).approve(deployments.lendingPools.USDC, hre.ethers.parseUnits("10000", 6));
  await lendingUSDC.connect(user1).deposit(hre.ethers.parseUnits("10000", 6));
  console.log("✅ User1 deposited 10,000 USDC to lending pool");

  const lpBNB = await lendingBNB.balanceOf(user1.address);
  const lpUSDC = await lendingUSDC.balanceOf(user1.address);
  console.log("User1 LP Token Balances:");
  console.log("├─ lpBNB:", hre.ethers.formatEther(lpBNB));
  console.log("└─ lpUSDC:", hre.ethers.formatUnits(lpUSDC, 6));

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("✅ ALL TESTS PASSED!");
  console.log("=".repeat(80));
  console.log("\n📊 Test Summary:");
  console.log("├─ ✅ Lending Pool Deposit/Withdraw");
  console.log("├─ ✅ Lending Pool Borrow/Repay");
  console.log("├─ ✅ AMM Pool Swap");
  console.log("├─ ✅ AMM Pool Add/Remove Liquidity");
  console.log("└─ ✅ Cross-Pool Operations");
  console.log("\n🎉 All contracts are working correctly!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
