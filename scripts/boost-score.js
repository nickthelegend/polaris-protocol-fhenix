const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // Your wallet address — the one showing 300
  const TARGET_WALLET = process.env.TARGET_WALLET || "0x0121Cb33BdAeEb8f400b27c0D5f3C7916C77F453";
  
  // ScoreManager on Sepolia
  const SCORE_MANAGER = "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a";

  const abi = [
    "function updateScore(address user, int256 delta, string memory reason) public",
    "function getScore(address user) public view returns (uint256)",
    "function owner() public view returns (address)"
  ];

  const scoreManager = new hre.ethers.Contract(SCORE_MANAGER, abi, deployer);

  // Check ownership
  const owner = await scoreManager.owner();
  console.log("ScoreManager owner:", owner);
  console.log("Deployer:", deployer.address);

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    // Ownership was transferred to LoanEngine during test setup
    // but on Sepolia the deployer should still be owner
    // If not, we need to call via LoanEngine
    console.log("WARNING: Deployer is not the owner. Score update may fail.");
  }

  const scoreBefore = await scoreManager.getScore(TARGET_WALLET);
  console.log(`\nScore BEFORE: ${scoreBefore}`);

  // Boost by 350 points (300 + 350 = 650 = "Good" tier)
  console.log("Boosting score by +350...");
  const tx = await scoreManager.updateScore(TARGET_WALLET, 350, "Initial credit bootstrap");
  await tx.wait();

  const scoreAfter = await scoreManager.getScore(TARGET_WALLET);
  console.log(`Score AFTER: ${scoreAfter}`);
  console.log("\nDone! Refresh the Credit Dashboard.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
