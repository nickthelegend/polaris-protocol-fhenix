import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying PrivateScoreManager to Sepolia with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Deploy
  console.log("\nDeploying PrivateScoreManager...");
  const Factory = await ethers.getContractFactory("PrivateScoreManager");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("PrivateScoreManager deployed at:", addr);

  // Authorize the LoanEngine as a caller so it can record repayments
  const deploymentsPath = path.join(__dirname, "..", "deployments-sepolia-final.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const loanEngineAddr = deployments.contracts.LoanEngine;

  console.log("Authorizing LoanEngine as caller:", loanEngineAddr);
  const authTx = await contract.authorizeCaller(loanEngineAddr);
  await authTx.wait();
  console.log("LoanEngine authorized.");

  // Update deployments file
  deployments.contracts.PrivateScoreManager = addr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nUpdated deployments-sepolia-final.json");
  console.log("PrivateScoreManager:", addr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
