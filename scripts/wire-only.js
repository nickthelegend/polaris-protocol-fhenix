const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDR_POOL_MANAGER = "0x2effA4cb512A1513a0a1AC490FA92e52Fe2d274F";
const ADDR_SCORE_MANAGER = "0x3a665926175E63f7cD76eC93f2Ed4d6add74B0F8";
const ADDR_LOAN_ENGINE = "0xa77923565D58fc05d5A1B9A50c9CB125d9B1F097";
const ADDR_CREDIT_ORACLE = "0x958d0f0Ee78f0f92CF86609BD565438a98E1bd63";
const ADDR_PROTOCOL_FUNDS = "0xfd3e165D706Df5447Fc344BE8c128304Bf270D0D";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Starting manual wiring only...");
  console.log("📍 Account:", deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  const scoreManager = await hre.ethers.getContractAt("ScoreManager", ADDR_SCORE_MANAGER, deployer);
  const poolManager = await hre.ethers.getContractAt("PoolManager", ADDR_POOL_MANAGER, deployer);

  // 1. Wire PoolManager setLoanEngine
  console.log("\n🔧 Setting LoanEngine in PoolManager...");
  const tx1 = await poolManager.setLoanEngine(ADDR_LOAN_ENGINE);
  await tx1.wait();
  console.log("✅ PoolManager updated.");

  // 2. Wire ScoreManager transferOwnership
  console.log("\n🔧 Transferring ScoreManager ownership to LoanEngine...");
  const tx2 = await scoreManager.transferOwnership(ADDR_LOAN_ENGINE);
  await tx2.wait();
  console.log("✅ ScoreManager ownership transferred.");

  // 3. Save all addresses to deployments-sepolia-final.json (leaving MerchantRouter as empty or using the old one for now)
  const deployments = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PROTOCOL_FUNDS: ADDR_PROTOCOL_FUNDS,
      POOL_MANAGER: ADDR_POOL_MANAGER,
      CREDIT_ORACLE: ADDR_CREDIT_ORACLE,
      SCORE_MANAGER: ADDR_SCORE_MANAGER,
      LOAN_ENGINE: ADDR_LOAN_ENGINE,
      MERCHANT_ROUTER: "0x01d4A20a8275A12D62805aCEDF5a4782A7966FdF" // placeholder
    }
  };

  const outputPath = path.join(__dirname, "..", "deployments-sepolia-final.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployments, null, 2));
  console.log("\n✅ Global Deployment Data successfully saved to deployments-sepolia-final.json");
}

main().catch(console.error);
