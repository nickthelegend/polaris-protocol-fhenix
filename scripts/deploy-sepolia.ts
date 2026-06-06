import hre from "hardhat";
const { ethers } = hre;
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying to Sepolia with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // 1. PrivateCollateralVault
  console.log("\nDeploying PrivateCollateralVault...");
  const CollateralVaultFactory = await ethers.getContractFactory("PrivateCollateralVault");
  const collateralVault = await CollateralVaultFactory.deploy();
  await collateralVault.waitForDeployment();
  const collateralVaultAddress = await collateralVault.getAddress();
  console.log("  PrivateCollateralVault:", collateralVaultAddress);

  // 2. PrivateLendingPool
  console.log("Deploying PrivateLendingPool...");
  const LendingPoolFactory = await ethers.getContractFactory("PrivateLendingPool");
  const lendingPool = await LendingPoolFactory.deploy();
  await lendingPool.waitForDeployment();
  const lendingPoolAddress = await lendingPool.getAddress();
  console.log("  PrivateLendingPool:", lendingPoolAddress);

  // 3. PrivateBorrowManager
  console.log("Deploying PrivateBorrowManager...");
  const BorrowManagerFactory = await ethers.getContractFactory("PrivateBorrowManager");
  const borrowManager = await BorrowManagerFactory.deploy(collateralVaultAddress);
  await borrowManager.waitForDeployment();
  const borrowManagerAddress = await borrowManager.getAddress();
  console.log("  PrivateBorrowManager:", borrowManagerAddress);

  // 4. PrivateLiquidationEngine
  console.log("Deploying PrivateLiquidationEngine...");
  const LiquidationEngineFactory = await ethers.getContractFactory("PrivateLiquidationEngine");
  const liquidationEngine = await LiquidationEngineFactory.deploy(collateralVaultAddress, borrowManagerAddress);
  await liquidationEngine.waitForDeployment();
  const liquidationEngineAddress = await liquidationEngine.getAddress();
  console.log("  PrivateLiquidationEngine:", liquidationEngineAddress);

  // Wiring
  console.log("\nWiring contracts...");
  await (await collateralVault.authorizeContract(borrowManagerAddress)).wait();
  await (await collateralVault.authorizeContract(liquidationEngineAddress)).wait();
  await (await borrowManager.setLendingPool(lendingPoolAddress)).wait();
  await (await borrowManager.authorizeContract(liquidationEngineAddress)).wait();
  await (await lendingPool.setBorrowManager(borrowManagerAddress)).wait();
  console.log("  Wiring complete.");

  // Save deployments
  const deployments = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PRIVATE_COLLATERAL_VAULT: collateralVaultAddress,
      PRIVATE_BORROW_MANAGER: borrowManagerAddress,
      PRIVATE_LENDING_POOL: lendingPoolAddress,
      PRIVATE_LIQUIDATION_ENGINE: liquidationEngineAddress,
    },
  };

  const outputPath = path.join(__dirname, "..", "deployments-sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved to deployments-sepolia.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
