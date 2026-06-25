/**
 * Deploys the full confidential lending suite and performs EVERY ACL/wiring grant.
 *
 * This is the fix for audit findings H-1/H-2: the cross-contract `authorizeManager`
 * grants are now part of deployment (not omitted), and every authorize/admin function
 * is owner-gated, so the suite is actually functional and access-controlled as deployed.
 *
 *   npx hardhat run scripts/deploy-confidential-suite.js --network <net>
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying confidential suite with:", deployer.address);

  // On the local hardhat network the CoFHE coprocessor isn't present, so deploy the mocks first.
  // On real networks (Sepolia etc.) the live CoFHE coprocessor is used — skip.
  const net = await ethers.provider.getNetwork();
  if (Number(net.chainId) === 31337 && hre.cofhe?.mocks?.deployMocks) {
    await hre.cofhe.mocks.deployMocks();
    console.log("Deployed CoFHE mocks (local network).");
  }

  // 1. Confidential tokens (6 decimals, ERC-7984-style).
  const Token = await ethers.getContractFactory("ConfidentialToken");
  const cUSDC = await Token.deploy("Confidential USDC", "cUSDC", 6);
  await cUSDC.waitForDeployment();
  const cWETH = await Token.deploy("Confidential WETH", "cWETH", 6);
  await cWETH.waitForDeployment();
  console.log("cUSDC:", await cUSDC.getAddress());
  console.log("cWETH:", await cWETH.getAddress());

  // 2. Score manager (encrypted score + limit).
  const Score = await ethers.getContractFactory("ConfidentialScoreManager");
  const scoreManager = await Score.deploy();
  await scoreManager.waitForDeployment();
  console.log("ScoreManager:", await scoreManager.getAddress());

  // 3. Collateral vault (custodies cWETH).
  const Vault = await ethers.getContractFactory("ConfidentialCollateralVault");
  const vault = await Vault.deploy(await cWETH.getAddress());
  await vault.waitForDeployment();
  console.log("CollateralVault:", await vault.getAddress());

  // 4. Lending pool (borrowable cUSDC).
  const Pool = await ethers.getContractFactory("ConfidentialLendingPool");
  const pool = await Pool.deploy(
    await cUSDC.getAddress(),
    await vault.getAddress(),
    await scoreManager.getAddress()
  );
  await pool.waitForDeployment();
  console.log("LendingPool:", await pool.getAddress());

  // 5. Liquidation engine.
  const Engine = await ethers.getContractFactory("ConfidentialLiquidationEngine");
  const engine = await Engine.deploy(
    await vault.getAddress(),
    await pool.getAddress(),
    await scoreManager.getAddress()
  );
  await engine.waitForDeployment();
  console.log("LiquidationEngine:", await engine.getAddress());

  // 6. CROSS-CONTRACT ACL WIRING (the part the old deploy script forgot).
  //    Each producing contract must authorize the contracts that read/compute on its handles.
  const poolAddr = await pool.getAddress();
  const engineAddr = await engine.getAddress();

  // Pool reads collateral; engine reads collateral + seizes it.
  await (await vault.authorizeManager(poolAddr)).wait();
  await (await vault.authorizeManager(engineAddr)).wait();
  // Pool reads credit limit + records repayments; engine records liquidations.
  await (await scoreManager.authorizeManager(poolAddr)).wait();
  await (await scoreManager.authorizeManager(engineAddr)).wait();
  // Engine reads debt + clears it.
  await (await pool.authorizeManager(engineAddr)).wait();
  console.log("ACL wiring complete (vault→[pool,engine], score→[pool,engine], pool→[engine]).");

  // 7. Confidential merchant escrow (private, encrypted-amount payments in cUSDC).
  const Escrow = await ethers.getContractFactory("ConfidentialMerchantEscrow");
  const merchantEscrow = await Escrow.deploy(await cUSDC.getAddress());
  await merchantEscrow.waitForDeployment();
  console.log("MerchantEscrow:", await merchantEscrow.getAddress());

  // 8. Confidential swap pool (cWETH <-> cUSDC at a fixed oracle rate, e.g. 1 WETH = 2000 USDC).
  const Swap = await ethers.getContractFactory("ConfidentialSwapPool");
  const swapPool = await Swap.deploy(await cWETH.getAddress(), await cUSDC.getAddress(), 2000, 1);
  await swapPool.waitForDeployment();
  console.log("SwapPool:", await swapPool.getAddress());

  const out = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      CONFIDENTIAL_USDC: await cUSDC.getAddress(),
      CONFIDENTIAL_WETH: await cWETH.getAddress(),
      SCORE_MANAGER: await scoreManager.getAddress(),
      COLLATERAL_VAULT: await vault.getAddress(),
      LENDING_POOL: poolAddr,
      LIQUIDATION_ENGINE: engineAddr,
      MERCHANT_ESCROW: await merchantEscrow.getAddress(),
      SWAP_POOL: await swapPool.getAddress()
    },
    envForFrontend: {
      NEXT_PUBLIC_CONF_USDC: await cUSDC.getAddress(),
      NEXT_PUBLIC_CONF_WETH: await cWETH.getAddress(),
      NEXT_PUBLIC_CONF_SCORE_MANAGER: await scoreManager.getAddress(),
      NEXT_PUBLIC_CONF_COLLATERAL_VAULT: await vault.getAddress(),
      NEXT_PUBLIC_CONF_LENDING_POOL: poolAddr,
      NEXT_PUBLIC_CONF_LIQUIDATION_ENGINE: engineAddr,
      NEXT_PUBLIC_CONF_MERCHANT_ESCROW: await merchantEscrow.getAddress(),
      NEXT_PUBLIC_CONF_SWAP_POOL: await swapPool.getAddress()
    }
  };
  fs.writeFileSync(
    path.join(__dirname, "..", "deployments-confidential.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("\nSaved deployments-confidential.json");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
