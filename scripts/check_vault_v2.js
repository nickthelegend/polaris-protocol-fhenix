const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    const network = hre.network.name;

    const { usdc, liquidityVault } = addresses[network];
    const targetUser = "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B";

    const vault = await hre.ethers.getContractAt("LiquidityVault", liquidityVault);

    const isWhitelisted = await vault.whitelistedTokens(usdc);
    console.log(`Token ${usdc} is whitelisted: ${isWhitelisted}`);

    const token = await hre.ethers.getContractAt("MockERC20", usdc);
    const balance = await token.balanceOf(targetUser);
    console.log(`User ${targetUser} balance: ${hre.ethers.formatUnits(balance, 18)}`);

    const allowance = await token.allowance(targetUser, liquidityVault);
    console.log(`Vault allowance: ${hre.ethers.formatUnits(allowance, 18)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
