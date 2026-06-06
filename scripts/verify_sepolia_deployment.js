const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    const vaultAddress = addresses.liquidityVault;
    const usdcAddress = addresses.usdc;

    console.log(`Verifying LiquidityVault at: ${vaultAddress}`);

    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    // Attach to the address
    const vault = LiquidityVault.attach(vaultAddress);

    try {
        const owner = await vault.owner();
        console.log(`Vault Owner: ${owner}`);

        const isUsdcWhitelisted = await vault.whitelistedTokens(usdcAddress);
        console.log(`USDC (${usdcAddress}) Whitelisted: ${isUsdcWhitelisted}`);

        if (isUsdcWhitelisted) {
            console.log("SUCCESS: Vault appears deployed and configured.");
        } else {
            console.warn("WARNING: Vault found but tokens might not be whitelisted.");
        }

    } catch (error) {
        console.error("ERROR: Could not interact with Vault. It might not exist or the address is wrong.");
        console.error(error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
