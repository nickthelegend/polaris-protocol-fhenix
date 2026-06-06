const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const TARGET = wallet.address; // boost deployer's own score
  const LOAN_ENGINE = "0xdE8B22E09f0BCfEC41900b8ef748Ec0c5FF18BD3";
  const SCORE_MANAGER = "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a";
  const USDC = "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0";

  const smAbi = ["function getScore(address) view returns (uint256)"];
  const leAbi = [
    "function createLoan(address user, uint256 amount, address poolToken) external",
    "function repay(uint256 loanId, uint256 amount) external",
    "function loanCount() view returns (uint256)",
    "function loans(uint256) view returns (address borrower, uint256 principal, uint256 interestAmount, uint256 repaid, uint256 startTime, uint8 status, address poolToken)",
    "function userActiveDebt(address) view returns (uint256)"
  ];

  const sm = new ethers.Contract(SCORE_MANAGER, smAbi, wallet);
  const le = new ethers.Contract(LOAN_ENGINE, leAbi, wallet);

  let score = await sm.getScore(TARGET);
  console.log("Score BEFORE:", score.toString());

  // Create small loans and repay them immediately to boost score
  // Each repayment gives +5 points. We need ~70 repayments to go from 300 to 650.
  // Let's do 20 rounds (300 + 100 = 400, gets past the warning threshold)
  const ROUNDS = 20;
  const AMOUNT = ethers.parseUnits("1", 18); // tiny 1-unit loans

  for (let i = 0; i < ROUNDS; i++) {
    try {
      // Create loan
      const countBefore = await le.loanCount();
      console.log(`\n[${i + 1}/${ROUNDS}] Creating loan #${countBefore}...`);
      const createTx = await le.createLoan(TARGET, AMOUNT, USDC, { gasLimit: 500000 });
      await createTx.wait();

      // Get loan details to know total debt
      const loanId = countBefore;
      const loan = await le.loans(loanId);
      const totalDebt = loan.principal + loan.interestAmount;

      // Repay full amount
      console.log(`  Repaying loan #${loanId} (${ethers.formatUnits(totalDebt, 18)})...`);
      const repayTx = await le.repay(loanId, totalDebt, { gasLimit: 500000 });
      await repayTx.wait();

      const newScore = await sm.getScore(TARGET);
      console.log(`  Score: ${newScore.toString()}`);

      if (Number(newScore) >= 650) {
        console.log("\n🎉 Score reached 650 (Good tier)! Stopping.");
        break;
      }
    } catch (err) {
      console.error(`  Error on round ${i + 1}:`, err.message?.slice(0, 100));
      break;
    }
  }

  score = await sm.getScore(TARGET);
  console.log("\n✅ Final Score:", score.toString());
}

main().catch(console.error);
