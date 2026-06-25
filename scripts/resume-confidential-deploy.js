/**
 * RESUME a partial confidential deploy: reuses already-deployed cUSDC / cWETH / ScoreManager /
 * CollateralVault, then deploys the remaining LendingPool / LiquidationEngine / MerchantEscrow /
 * SwapPool, wires the ACL, and writes deployments-confidential.json.
 *
 * Edit the ALREADY object below with the addresses from the partial run, then:
 *   npx hardhat run scripts/resume-confidential-deploy.js --network sepolia
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const ALREADY = {
  CONFIDENTIAL_USDC: "0x68BaA837E8C2b54ee906CB058cDFC957dEdf5276",
  CONFIDENTIAL_WETH: "0xcFA6731729BF760CAe25fF96E453F05f7B3Fb25B",
  SCORE_MANAGER: "0x0D42B82356Cb135e2Ccd0f6544BAD422D5b9b011",
  COLLATERAL_VAULT: "0x24989F11f6C83244Ac3421E4fF30921Ac1bd24C3",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Resuming with:", deployer.address, "| balance:", ethers.formatEther(bal), "ETH");

  const vault = await ethers.getContractAt("ConfidentialCollateralVault", ALREADY.COLLATERAL_VAULT);
  const score = await ethers.getContractAt("ConfidentialScoreManager", ALREADY.SCORE_MANAGER);

  const Pool = await ethers.getContractFactory("ConfidentialLendingPool");
  const pool = await Pool.deploy(ALREADY.CONFIDENTIAL_USDC, ALREADY.COLLATERAL_VAULT, ALREADY.SCORE_MANAGER);
  await pool.waitForDeployment();
  console.log("LendingPool:", await pool.getAddress());

  const Engine = await ethers.getContractFactory("ConfidentialLiquidationEngine");
  const engine = await Engine.deploy(ALREADY.COLLATERAL_VAULT, await pool.getAddress(), ALREADY.SCORE_MANAGER);
  await engine.waitForDeployment();
  console.log("LiquidationEngine:", await engine.getAddress());

  const Escrow = await ethers.getContractFactory("ConfidentialMerchantEscrow");
  const escrow = await Escrow.deploy(ALREADY.CONFIDENTIAL_USDC);
  await escrow.waitForDeployment();
  console.log("MerchantEscrow:", await escrow.getAddress());

  const Swap = await ethers.getContractFactory("ConfidentialSwapPool");
  const swap = await Swap.deploy(ALREADY.CONFIDENTIAL_WETH, ALREADY.CONFIDENTIAL_USDC, 2000, 1);
  await swap.waitForDeployment();
  console.log("SwapPool:", await swap.getAddress());

  // ACL wiring
  const poolAddr = await pool.getAddress();
  const engineAddr = await engine.getAddress();
  await (await vault.authorizeManager(poolAddr)).wait();
  await (await vault.authorizeManager(engineAddr)).wait();
  await (await score.authorizeManager(poolAddr)).wait();
  await (await score.authorizeManager(engineAddr)).wait();
  await (await pool.authorizeManager(engineAddr)).wait();
  console.log("ACL wiring complete.");

  const out = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ...ALREADY,
      LENDING_POOL: poolAddr,
      LIQUIDATION_ENGINE: engineAddr,
      MERCHANT_ESCROW: await escrow.getAddress(),
      SWAP_POOL: await swap.getAddress(),
    },
    envForFrontend: {
      NEXT_PUBLIC_CONF_USDC: ALREADY.CONFIDENTIAL_USDC,
      NEXT_PUBLIC_CONF_WETH: ALREADY.CONFIDENTIAL_WETH,
      NEXT_PUBLIC_CONF_SCORE_MANAGER: ALREADY.SCORE_MANAGER,
      NEXT_PUBLIC_CONF_COLLATERAL_VAULT: ALREADY.COLLATERAL_VAULT,
      NEXT_PUBLIC_CONF_LENDING_POOL: poolAddr,
      NEXT_PUBLIC_CONF_LIQUIDATION_ENGINE: engineAddr,
      NEXT_PUBLIC_CONF_MERCHANT_ESCROW: await escrow.getAddress(),
      NEXT_PUBLIC_CONF_SWAP_POOL: await swap.getAddress(),
    },
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployments-confidential.json"), JSON.stringify(out, null, 2));
  console.log("\nSaved deployments-confidential.json — full suite deployed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
