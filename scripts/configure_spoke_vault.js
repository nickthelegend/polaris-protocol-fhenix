const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    const network = hre.network.name;

    if (!addresses[network]) {
        console.error("Network not found in addresses.json");
        return;
    }

    const { usdc, usdt, ctc, liquidityVault } = addresses[network];
    console.log(`Configuring Vault on ${network} at ${liquidityVault}...`);

    const vault = await hre.ethers.getContractAt("LiquidityVault", liquidityVault);

    console.log("Whitelisting tokens...");
    await (await vault.setTokenWhitelist(usdc, true)).wait();
    await (await vault.setTokenWhitelist(usdt, true)).wait();
    await (await vault.setTokenWhitelist(ctc, true)).wait();

    console.log("SUCCESS: Spoke Vault configured.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
