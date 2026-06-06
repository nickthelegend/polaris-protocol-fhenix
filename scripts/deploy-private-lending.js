const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("----------------------------------------------------------");
  console.log("Deploying Confidential Lending Suite to Localhost");
  console.log("Account:", deployer.address);
  console.log("----------------------------------------------------------\n");

  // 1. Deploy PrivateCollateralVault
  console.log("[1/4] Deploying PrivateCollateralVault...");
  const PrivateCollateralVault = await ethers.getContractFactory("PrivateCollateralVault");
  const collateralVault = await PrivateCollateralVault.deploy();
  await collateralVault.waitForDeployment();
  const collateralVaultAddress = await collateralVault.getAddress();
  console.log(`- Deployed at: ${collateralVaultAddress}`);

  // 2. Deploy PrivateLendingPool
  console.log("[2/4] Deploying PrivateLendingPool...");
  const PrivateLendingPool = await ethers.getContractFactory("PrivateLendingPool");
  const lendingPool = await PrivateLendingPool.deploy();
  await lendingPool.waitForDeployment();
  const lendingPoolAddress = await lendingPool.getAddress();
  console.log(`- Deployed at: ${lendingPoolAddress}`);

  // 3. Deploy PrivateBorrowManager
  console.log("[3/4] Deploying PrivateBorrowManager...");
  const PrivateBorrowManager = await ethers.getContractFactory("PrivateBorrowManager");
  // Pass collateralVault as initial reference
  const borrowManager = await PrivateBorrowManager.deploy(collateralVaultAddress);
  await borrowManager.waitForDeployment();
  const borrowManagerAddress = await borrowManager.getAddress();
  console.log(`- Deployed at: ${borrowManagerAddress}`);

  // 4. Deploy PrivateLiquidationEngine
  console.log("[4/4] Deploying PrivateLiquidationEngine...");
  const PrivateLiquidationEngine = await ethers.getContractFactory("PrivateLiquidationEngine");
  const liquidationEngine = await PrivateLiquidationEngine.deploy(collateralVaultAddress, borrowManagerAddress);
  await liquidationEngine.waitForDeployment();
  const liquidationEngineAddress = await liquidationEngine.getAddress();
  console.log(`- Deployed at: ${liquidationEngineAddress}`);

  // 5. Configuration & Wiring
  console.log("\n[5/5] Wiring Dependencies...");
  
  // PrivateBorrowManager -> setLendingPool
  const tx1 = await borrowManager.setLendingPool(lendingPoolAddress);
  await tx1.wait();
  console.log("- PrivateBorrowManager linked to PrivateLendingPool");

  // PrivateLendingPool -> setBorrowManager
  const tx2 = await lendingPool.setBorrowManager(borrowManagerAddress);
  await tx2.wait();
  console.log("- PrivateLendingPool linked to PrivateBorrowManager");

  // PrivateLiquidationEngine -> redundant check (constructor handled it, but let's confirm setters work)
  const tx3 = await liquidationEngine.setBorrowManager(borrowManagerAddress);
  await tx3.wait();
  const tx4 = await liquidationEngine.setCollateralVault(collateralVaultAddress);
  await tx4.wait();
  console.log("- PrivateLiquidationEngine wired manually");

  const deploymentData = {
    PrivateLendingPool: lendingPoolAddress,
    PrivateCollateralVault: collateralVaultAddress,
    PrivateBorrowManager: borrowManagerAddress,
    PrivateLiquidationEngine: liquidationEngineAddress,
    network: "localhost",
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  // Store addresses in config file
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  fs.writeFileSync(
    path.join(deploymentsDir, "localhost.json"),
    JSON.stringify(deploymentData, null, 2)
  );

  console.log(`\nDeployment configuration saved to: polaris-protocol/deployments/localhost.json`);
  console.log("\n----------------------------------------------------------");
  console.log("Confidential Lending Suite Deployment Complete");
  console.log("----------------------------------------------------------\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
