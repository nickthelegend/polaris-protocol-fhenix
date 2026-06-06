const { ethers } = require("hardhat");

async function main() {
  console.log("Testing ethers.getSigners()...");
  const signers = await ethers.getSigners();
  console.log("Signers count:", signers.length);
  console.log("First signer:", signers[0].address);

  console.log("\nTesting getContractFactory...");
  try {
    const factory = await ethers.getContractFactory("PrivateCollateralVault");
    console.log("Factory obtained successfully");
  } catch (e) {
    console.error("Factory failed:", e);
  }
}

main().catch(console.error);
