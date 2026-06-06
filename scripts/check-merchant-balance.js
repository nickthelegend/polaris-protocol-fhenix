const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

  const MERCHANT_ROUTER = "0xCa924A3bC86b2EaBDc01a3617CA89c3CD383B19B";
  const USDC = "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0";

  const abi = [
    "function merchantBalances(address merchant, address token) view returns (uint256)"
  ];
  const router = new ethers.Contract(MERCHANT_ROUTER, abi, provider);

  // Check various addresses
  const addresses = {
    "Deployer wallet": "0x0121Cb33BdAeEb8f400b27c0D5f3C7916C77F453",
    "Escrow contract": "0xFE568b638adf96d77DbA6658542",  // from screenshot, partial
  };

  // Also check the tx to find the actual merchant address used
  console.log("Checking MerchantPaid events on MerchantRouter...\n");

  const eventAbi = ["event MerchantPaid(address indexed customer, address indexed merchant, address indexed token, uint256 amount)"];
  const routerEvents = new ethers.Contract(MERCHANT_ROUTER, eventAbi, provider);
  const filter = routerEvents.filters.MerchantPaid();
  const events = await routerEvents.queryFilter(filter, -50000);

  for (const e of events) {
    console.log("MerchantPaid event:");
    console.log("  Customer:", e.args[0]);
    console.log("  Merchant:", e.args[1]);
    console.log("  Token:", e.args[2]);
    console.log("  Amount:", e.args[3].toString());
    console.log("  Block:", e.blockNumber);

    // Check balance for this merchant
    const bal = await router.merchantBalances(e.args[1], USDC);
    console.log("  Current balance:", bal.toString(), `(${ethers.formatUnits(bal, 6)} USDC)`);
    console.log();
  }

  if (events.length === 0) {
    console.log("No MerchantPaid events found. Checking known addresses...\n");
  }

  // Check deployer balance anyway
  const deployerBal = await router.merchantBalances("0x0121Cb33BdAeEb8f400b27c0D5f3C7916C77F453", USDC);
  console.log("Deployer balance:", ethers.formatUnits(deployerBal, 6), "USDC");
}

main().catch(console.error);
