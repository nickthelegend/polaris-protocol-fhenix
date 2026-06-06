const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log(`🚀 Registering Extra Tokens on Hub (${hre.network.name}) with: ${deployer.address}`);

    if (!fs.existsSync("extra_tokens_sepolia.json")) {
        throw new Error("extra_tokens_sepolia.json not found. Run the deployment script on Sepolia first.");
    }

    const deploymentInfo = JSON.parse(fs.readFileSync("extra_tokens_sepolia.json"));
    const tokenAddresses = deploymentInfo.tokens;
    const SEPOLIA_VAULT = deploymentInfo.vault;

    // Hub PoolManager from PayEase contracts.ts
    const POOL_MANAGER_HUB = "0x9f40bfe80fADa11569c68d2DFb9f3250841C572E";
    const SEPOLIA_CHAIN_ID = 11155111;
    const PROVER_KEY = 1;

    const poolManager = await hre.ethers.getContractAt("PoolManager", POOL_MANAGER_HUB);

    for (const [symbol, address] of Object.entries(tokenAddresses)) {
        console.log(`\n  🔧 Registering ${symbol} (${address})...`);

        // 1. Set Source Params for Standard Chain ID
        console.log(`    📍 Setting Source Params for Chain ${SEPOLIA_CHAIN_ID}...`);
        const tx1 = await poolManager.setSourceParams(SEPOLIA_CHAIN_ID, SEPOLIA_VAULT, address, true);
        await tx1.wait();

        // 2. Set Source Params for Prover Key
        console.log(`    📍 Setting Source Params for Prover Key ${PROVER_KEY}...`);
        const tx2 = await poolManager.setSourceParams(PROVER_KEY, SEPOLIA_VAULT, address, true);
        await tx2.wait();

        // 3. Global Whitelist
        console.log(`    ✨ Whitelisting token globally on Hub...`);
        const tx3 = await poolManager.setWhitelistedToken(address, true);
        await tx3.wait();

        console.log(`  ✅ ${symbol} fully registered on Hub`);
    }

    console.log("\n✨ All extra tokens fully registered on Master Hub.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
