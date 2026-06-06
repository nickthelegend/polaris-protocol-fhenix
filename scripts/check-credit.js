const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const TARGET = wallet.address;

  const SM = "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a";
  const PM = "0x130AD70864F8F5A6f83058951B544a7be5Bc2bc0";
  const CO = "0x7716D5ea002e42b3f0cCC75aCCE602832cF46be6";
  const LE = "0xdE8B22E09f0BCfEC41900b8ef748Ec0c5FF18BD3";

  const sm = new ethers.Contract(SM, [
    "function getScore(address) view returns (uint256)",
    "function getCreditLimit(address) view returns (uint256)",
  ], provider);

  const pm = new ethers.Contract(PM, [
    "function getUserTotalCollateral(address) view returns (uint256)",
  ], provider);

  const co = new ethers.Contract(CO, [
    "function getExternalNetValue(address) view returns (int256)",
    "function profiles(address) view returns (uint256 totalCollateralUsd, uint256 totalDebtUsd, uint256 lastUpdate, uint256 nonce)",
  ], provider);

  const le = new ethers.Contract(LE, [
    "function userActiveDebt(address) view returns (uint256)",
    "function loanCount() view returns (uint256)",
  ], provider);

  console.log("Target:", TARGET);
  console.log("Score:", (await sm.getScore(TARGET)).toString());
  console.log("Credit Limit:", ethers.formatUnits(await sm.getCreditLimit(TARGET), 18));
  console.log("Native Collateral:", ethers.formatUnits(await pm.getUserTotalCollateral(TARGET), 18));
  console.log("Active Debt:", ethers.formatUnits(await le.userActiveDebt(TARGET), 18));
  console.log("Loan Count:", (await le.loanCount()).toString());

  try {
    const netValue = await co.getExternalNetValue(TARGET);
    console.log("External Net Value:", ethers.formatUnits(netValue, 18));
  } catch (e) {
    console.log("External Net Value: 0 (stale or no data)");
  }

  const profile = await co.profiles(TARGET);
  console.log("Oracle Profile:", {
    collateral: ethers.formatUnits(profile.totalCollateralUsd, 18),
    debt: ethers.formatUnits(profile.totalDebtUsd, 18),
    lastUpdate: new Date(Number(profile.lastUpdate) * 1000).toISOString(),
    nonce: profile.nonce.toString(),
  });
}

main().catch(console.error);
