import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MerchantRouter to Sepolia with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Load existing deployment addresses
  const deploymentsPath = path.join(__dirname, "..", "deployments-sepolia-final.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const poolManagerAddr = deployments.contracts.PoolManager;
  const loanEngineAddr = deployments.contracts.LoanEngine;

  console.log("Using PoolManager:", poolManagerAddr);
  console.log("Using LoanEngine:", loanEngineAddr);

  // Deploy MerchantRouter
  console.log("\nDeploying MerchantRouter...");
  const MerchantRouter = await ethers.getContractFactory("MerchantRouter");
  const merchantRouter = await MerchantRouter.deploy(poolManagerAddr, loanEngineAddr);
  await merchantRouter.waitForDeployment();
  const merchantRouterAddr = await merchantRouter.getAddress();
  console.log("MerchantRouter deployed at:", merchantRouterAddr);

  // Update deployments file
  deployments.contracts.MerchantRouter = merchantRouterAddr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nUpdated deployments-sepolia-final.json with MerchantRouter address");

  console.log("\n--- Deployment Complete ---");
  console.log("MerchantRouter:", merchantRouterAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
