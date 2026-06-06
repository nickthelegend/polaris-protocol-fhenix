const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const TARGET = wallet.address;

  const CO = "0x7716D5ea002e42b3f0cCC75aCCE602832cF46be6";
  const SM = "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a";
  const LE = "0xdE8B22E09f0BCfEC41900b8ef748Ec0c5FF18BD3";
  const USDC = "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0";

  const coAbi = [
    "function updateProfile(address user, uint256 collateral, uint256 debt, uint256 timestamp, bytes signature) external",
    "function profiles(address) view returns (uint256, uint256, uint256, uint256)",
    "function attester() view returns (address)",
    "function getExternalNetValue(address) view returns (int256)",
  ];
  const smAbi = [
    "function getScore(address) view returns (uint256)",
    "function getCreditLimit(address) view returns (uint256)",
  ];
  const leAbi = [
    "function createLoan(address user, uint256 amount, address poolToken) external",
    "function repay(uint256 loanId, uint256 amount) external",
    "function loanCount() view returns (uint256)",
    "function loans(uint256) view returns (address, uint256, uint256, uint256, uint256, uint8, address)",
  ];

  const co = new ethers.Contract(CO, coAbi, wallet);
  const sm = new ethers.Contract(SM, smAbi, provider);
  const le = new ethers.Contract(LE, leAbi, wallet);

  // Step 1: Attest credit via CreditOracle
  console.log("=== Step 1: Attest Credit Profile ===");
  const attester = await co.attester();
  console.log("Attester:", attester);
  console.log("Wallet:", wallet.address);

  if (attester.toLowerCase() !== wallet.address.toLowerCase()) {
    console.log("ERROR: Wallet is not the attester. Cannot update profile.");
    return;
  }

  const collateral = ethers.parseUnits("500000", 18); // $500k collateral
  const debt = ethers.parseUnits("0", 18);
  const block = await provider.getBlock("latest");
  const timestamp = block.timestamp + 60; // 60 seconds in the future
  const [, , , nonce] = await co.profiles(TARGET);

  // Sign the attestation
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "uint256", "uint256", "uint256", "uint256"],
    [TARGET, collateral, debt, timestamp, nonce]
  );
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  console.log("Submitting attestation...");
  const attestTx = await co.updateProfile(TARGET, collateral, debt, timestamp, signature, { gasLimit: 300000 });
  await attestTx.wait();
  console.log("Attestation TX:", attestTx.hash);

  const netValue = await co.getExternalNetValue(TARGET);
  console.log("External Net Value:", ethers.formatUnits(netValue, 18));

  const creditLimit = await sm.getCreditLimit(TARGET);
  console.log("Credit Limit:", ethers.formatUnits(creditLimit, 18));

  // Step 2: Create and repay loans to boost score
  console.log("\n=== Step 2: Boost Score via Loan Repayments ===");
  const ROUNDS = 20; // +5 per repayment = +100 total → 300+100 = 400
  const AMOUNT = ethers.parseUnits("10", 18);

  for (let i = 0; i < ROUNDS; i++) {
    try {
      const countBefore = await le.loanCount();
      process.stdout.write(`[${i + 1}/${ROUNDS}] Loan #${countBefore}... `);

      const createTx = await le.createLoan(TARGET, AMOUNT, USDC, { gasLimit: 500000 });
      await createTx.wait();

      const loan = await le.loans(countBefore);
      const totalDebt = loan[1] + loan[2]; // principal + interest

      const repayTx = await le.repay(countBefore, totalDebt, { gasLimit: 500000 });
      await repayTx.wait();

      const newScore = await sm.getScore(TARGET);
      console.log(`Score: ${newScore}`);

      if (Number(newScore) >= 650) {
        console.log("\nReached 650 (Good tier)!");
        break;
      }
    } catch (err) {
      console.log(`Error: ${err.message?.slice(0, 80)}`);
      break;
    }
  }

  // Final state
  console.log("\n=== Final State ===");
  console.log("Score:", (await sm.getScore(TARGET)).toString());
  console.log("Credit Limit:", ethers.formatUnits(await sm.getCreditLimit(TARGET), 18));
  console.log("Done! Refresh the Credit Dashboard.");
}

main().catch(console.error);
