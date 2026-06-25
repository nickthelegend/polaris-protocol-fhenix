/**
 * Bootstraps a DEPLOYED confidential suite so the apps are immediately usable:
 *   - mints cUSDC + cWETH to the deployer (and any addresses in BOOTSTRAP_USERS)
 *   - seeds the lending pool with cUSDC liquidity
 *   - seeds the swap pool with cWETH + cUSDC liquidity
 *   - initializes a credit score + sets a credit limit for the deployer/test users
 *   - registers the deployer as a demo merchant in the escrow
 *
 * Reads addresses from deployments-confidential.json (written by deploy-confidential-suite.js).
 *
 *   npx hardhat run scripts/bootstrap-confidential.js --network <net>
 *
 * Optional env: BOOTSTRAP_USERS="0xabc...,0xdef..." (extra addresses to fund + give a limit).
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { Encryptable } = require("@cofhe/sdk");

async function main() {
  const file = path.join(__dirname, "..", "deployments-confidential.json");
  if (!fs.existsSync(file)) throw new Error("deployments-confidential.json not found — run deploy-confidential-suite.js first");
  const { contracts: c } = JSON.parse(fs.readFileSync(file, "utf8"));

  const [deployer] = await ethers.getSigners();
  console.log("Bootstrapping with:", deployer.address);

  const cUSDC = await ethers.getContractAt("ConfidentialToken", c.CONFIDENTIAL_USDC);
  const cWETH = await ethers.getContractAt("ConfidentialToken", c.CONFIDENTIAL_WETH);
  const score = await ethers.getContractAt("ConfidentialScoreManager", c.SCORE_MANAGER);
  const pool = await ethers.getContractAt("ConfidentialLendingPool", c.LENDING_POOL);
  const swap = await ethers.getContractAt("ConfidentialSwapPool", c.SWAP_POOL);
  const escrow = await ethers.getContractAt("ConfidentialMerchantEscrow", c.MERCHANT_ESCROW);

  const UNTIL = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const client = await hre.cofhe.createClientWithBatteries(deployer);
  const enc = async (v) => (await client.encryptInputs([Encryptable.uint64(BigInt(v))]).execute())[0];

  const users = [deployer.address, ...((process.env.BOOTSTRAP_USERS || "").split(",").map((s) => s.trim()).filter(Boolean))];

  // 1. Faucet mint to every user.
  for (const u of users) {
    await (await cUSDC.mint(u, 1_000_000)).wait();
    await (await cWETH.mint(u, 1_000)).wait();
    console.log(`minted 1,000,000 cUSDC + 1,000 cWETH -> ${u}`);
  }

  // 2. Seed lending pool with cUSDC liquidity (deployer supplies 500,000).
  await (await cUSDC.setOperator(c.LENDING_POOL, UNTIL)).wait();
  await (await pool.supply(await enc(500_000))).wait();
  console.log("seeded lending pool with 500,000 cUSDC");

  // 3. Seed swap pool (1 cWETH = 2000 cUSDC): 500 cWETH + 1,000,000 cUSDC.
  await (await cWETH.setOperator(c.SWAP_POOL, UNTIL)).wait();
  await (await cUSDC.setOperator(c.SWAP_POOL, UNTIL)).wait();
  await (await swap.addLiquidityA(await enc(500))).wait();
  await (await swap.addLiquidityB(await enc(1_000_000))).wait();
  console.log("seeded swap pool with 500 cWETH + 1,000,000 cUSDC");

  // 4. Credit profile: initialize + set a 100,000 limit for each user.
  for (const u of users) {
    await (await score.initialize(u)).wait();
    await (await score.setCreditLimit(u, await enc(100_000))).wait();
    console.log(`credit limit 100,000 set for ${u}`);
  }

  // 5. Register the deployer as a demo merchant.
  await (await escrow.registerMerchant()).wait();
  console.log("registered deployer as a demo merchant in the escrow");

  console.log("\nBootstrap complete. Pools seeded, limits set, merchant registered.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
