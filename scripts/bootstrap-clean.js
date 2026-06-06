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
    "function updateProfile(address,uint256,uint256,uint256,bytes) external",
    "function profiles(address) view returns (uint256,uint256,uint256,uint256)",
  ];
  const smAbi = ["function getScore(address) view returns (uint256)", "function getCreditLimit(address) view returns (uint256)"];
  const leAbi = [
    "function createLoan(address,uint256,address) external",
    "function repay(uint256,uint256) external",
    "function loanCount() view returns (uint256)",
    "function loans(uint256) view returns (address,uint256,uint256,uint256,uint256,uint8,address)",
    "function userActiveDebt(address) view returns (uint256)",
  ];

  const co = new ethers.Contract(CO, coAbi, wallet);
  const sm = new ethers.Contract(SM, smAbi, provider);
  const le = new ethers.Contract(LE, leAbi, wallet);

  // Step 1: Attest $5,000 collateral (readable, not crazy big)
  console.log("=== Attesting $5,000 collateral ===");
  const collateral = ethers.parseUnits("5000", 18);
  const debt = ethers.parseUnits("0", 18);
  const block = await provider.getBlock("latest");
  const timestamp = block.timestamp + 60;
  const [,,,nonce] = await co.profiles(TARGET);
  const msgHash = ethers.solidityPackedKeccak256(
    ["address","uint256","uint256","uint256","uint256"],
    [TARGET, collateral, debt, timestamp, nonce]
  );
  const sig = await wallet.signMessage(ethers.getBytes(msgHash));
  const attestTx = await co.updateProfile(TARGET, collateral, debt, timestamp, sig, { gasLimit: 300000 });
  await attestTx.wait();
  console.log("Attested. Credit limit:", ethers.formatUnits(await sm.getCreditLimit(TARGET), 18));

  // Step 2: Create+repay small $5 USDC loans to boost score
  console.log("\n=== Boosting score with $5 loans ===");
  const AMOUNT = ethers.parseUnits("5", 6); // 5 USDC (6 decimals)
  const ROUNDS = 10; // +5 per repay = +50 → 300+50 = 350

  for (let i = 0; i < ROUNDS; i++) {
    try {
      const count = await le.loanCount();
      process.stdout.write(`[${i+1}/${ROUNDS}] Loan #${count}... `);
      const ct = await le.createLoan(TARGET, AMOUNT, USDC, { gasLimit: 500000 });
      await ct.wait();
      const loan = await le.loans(count);
      const totalDebt = loan[1] + loan[2];
      const rt = await le.repay(count, totalDebt, { gasLimit: 500000 });
      await rt.wait();
      console.log(`Score: ${await sm.getScore(TARGET)}`);
    } catch (err) {
      console.log(`Error: ${err.message?.slice(0, 60)}`);
      break;
    }
  }

  console.log("\n=== Final State ===");
  console.log("Score:", (await sm.getScore(TARGET)).toString());
  console.log("Credit Limit:", ethers.formatUnits(await sm.getCreditLimit(TARGET), 18));
  console.log("Active Debt:", (await le.userActiveDebt(TARGET)).toString());
  console.log("Loan Count:", (await le.loanCount()).toString());
}

main().catch(console.error);
