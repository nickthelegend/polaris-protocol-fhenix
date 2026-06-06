const { ethers } = require("hardhat");

const TARGET = "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B";

const TOKENS = {
  WETH: { address: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82", decimals: 18, amount: ethers.parseEther("1000") },
  USDC: { address: "0x9A676e781A523b5d0C0e43731313A708CB607508", decimals: 6,  amount: 1_000_000n * 10n ** 6n },
  WBTC: { address: "0x0B306BF915C4d645ff596e518fAf3F9669b97016", decimals: 8,  amount: 10n * 10n ** 8n },
  BNB:  { address: "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1", decimals: 18, amount: ethers.parseEther("1000") },
};

const ERC20_ABI = ["function mint(address to, uint256 amount) external", "function balanceOf(address) view returns (uint256)"];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Minting to:", TARGET);

  for (const [symbol, { address, decimals, amount }] of Object.entries(TOKENS)) {
    const token = new ethers.Contract(address, ERC20_ABI, deployer);
    await (await token.mint(TARGET, amount)).wait();
    const bal = await token.balanceOf(TARGET);
    console.log(`  ${symbol}: ${ethers.formatUnits(bal, decimals)}`);
  }

  // Also send 5 ETH for gas
  const tx = await deployer.sendTransaction({ to: TARGET, value: ethers.parseEther("5") });
  await tx.wait();
  console.log("  ETH: 5 (gas)");
}

main().catch(console.error);
