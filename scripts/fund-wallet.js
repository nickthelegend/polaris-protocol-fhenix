/**
 * Fund any wallet with ETH from the Hardhat deployer account.
 *
 * Usage:
 *   npx hardhat run scripts/fund-wallet.js --network localhost
 *
 * Set TARGET_WALLET to the address you want to fund.
 */

const { ethers } = require("hardhat");

const TARGET_WALLET = "0xcced528a5b70e16c8131cb2de424564dd938fd3b";
const AMOUNT_ETH = "100"; // 100 ETH — plenty for gas

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log(
    "Deployer balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  console.log(`\nSending ${AMOUNT_ETH} ETH to ${TARGET_WALLET}...`);
  const tx = await deployer.sendTransaction({
    to: TARGET_WALLET,
    value: ethers.parseEther(AMOUNT_ETH),
  });
  await tx.wait();

  const newBalance = await ethers.provider.getBalance(TARGET_WALLET);
  console.log(
    `Done! ${TARGET_WALLET} now has ${ethers.formatEther(newBalance)} ETH`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
