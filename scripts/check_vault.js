const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    const network = hre.network.name;

    const { usdc, liquidityVault } = addresses[network];
    const vault = await hre.ethers.getContractAt("LiquidityVault", liquidityVault);

    const isWhitelisted = await vault.whitelistedTokens(usdc);
    console.log(`Token ${usdc} is whitelisted: ${isWhitelisted}`);

    const [signer] = await hre.ethers.getSigners();
    const token = await hre.ethers.getContractAt("MockERC20", usdc);
    const balance = await token.balanceOf(signer.address);
    console.log(`Signer balance: ${hre.ethers.formatUnits(balance, 18)}`);

    const allowance = await token.allowance(signer.address, liquidityVault);
    console.log(`Vault allowance: ${hre.ethers.formatUnits(allowance, 18)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
