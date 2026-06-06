const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("./addresses.json"));
    const [deployer] = await hre.ethers.getSigners();

    console.log("Setting up Vault with deployer:", deployer.address);

    const vault = await hre.ethers.getContractAt("LiquidityVault", addresses.liquidityVault);

    console.log("Whitelisting USDC...");
    const tx1 = await vault.setTokenWhitelist(addresses.usdc, true);
    await tx1.wait();

    console.log("Whitelisting USDT...");
    const tx2 = await vault.setTokenWhitelist(addresses.usdt, true);
    await tx2.wait();

    console.log("Setup complete!");
}

main().catch(console.error);
