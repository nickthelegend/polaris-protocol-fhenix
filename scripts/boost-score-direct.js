const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const TARGET = "0x0121Cb33BdAeEb8f400b27c0D5f3C7916C77F453";
  const SCORE_MANAGER = "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a";

  const abi = [
    "function updateScore(address user, int256 delta, string memory reason) public",
    "function getScore(address user) public view returns (uint256)",
    "function owner() public view returns (address)",
    "function recordRepayment(address user, uint256 amount) external"
  ];

  const sm = new ethers.Contract(SCORE_MANAGER, abi, wallet);

  const owner = await sm.owner();
  console.log("ScoreManager owner:", owner);
  console.log("Wallet:", wallet.address);
  console.log("Owner matches wallet?", owner.toLowerCase() === wallet.address.toLowerCase());

  const scoreBefore = await sm.getScore(TARGET);
  console.log("\nScore BEFORE:", scoreBefore.toString());

  if (owner.toLowerCase() === wallet.address.toLowerCase()) {
    console.log("Boosting score by +350 via updateScore...");
    const tx = await sm.updateScore(TARGET, 350, "Demo bootstrap");
    console.log("TX:", tx.hash);
    await tx.wait();
  } else {
    console.log("Deployer is NOT the owner. Owner is:", owner);
    console.log("Trying recordRepayment (also onlyOwner)...");
    console.log("Cannot boost score directly. The LoanEngine owns ScoreManager.");
    console.log("\nAlternative: Transfer ScoreManager ownership back to deployer, boost, then transfer back.");
    
    // Check if LoanEngine has a way to call updateScore
    const LOAN_ENGINE = "0xdE8B22E09f0BCfEC41900b8ef748Ec0c5FF18BD3";
    const leAbi = [
      "function owner() public view returns (address)",
      "function scoreManager() public view returns (address)"
    ];
    const le = new ethers.Contract(LOAN_ENGINE, leAbi, wallet);
    const leOwner = await le.owner();
    console.log("\nLoanEngine owner:", leOwner);
    console.log("LoanEngine owner matches wallet?", leOwner.toLowerCase() === wallet.address.toLowerCase());
  }

  const scoreAfter = await sm.getScore(TARGET);
  console.log("\nScore AFTER:", scoreAfter.toString());
}

main().catch(console.error);
