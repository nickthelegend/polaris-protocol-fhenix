const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log(`🚀 Registering Spoke Deployments on Master Hub (uscTestnetV2)`);
    console.log(`👛 Account: ${deployer.address}\n`);

    const deploymentsFile = path.join(__dirname, "../spoke_deployments.json");
    if (!fs.existsSync(deploymentsFile)) {
        console.error("❌ spoke_deployments.json not found. Run deployments first.");
        return;
    }

    const deployments = JSON.parse(fs.readFileSync(deploymentsFile));
    const POOL_MANAGER_ADDR = "0x9f40bfe80fADa11569c68d2DFb9f3250841C572E";
    const poolManager = await hre.ethers.getContractAt("PoolManager", POOL_MANAGER_ADDR);

    for (const networkName of Object.keys(deployments)) {
        const data = deployments[networkName];
        console.log(`\n🔗 Processing ${networkName} (Chain ${data.chainId})...`);

        if (!data.vault) {
            console.warn(`  ⚠️ No vault found for ${networkName}, skipping.`);
            continue;
        }

        for (const symbol of Object.keys(data.tokens)) {
            const tokenAddr = data.tokens[symbol];
            console.log(`  🔧 Registering ${symbol}: ${tokenAddr}`);

            try {
                // Set Source Params (Chain ID registration)
                const tx1 = await poolManager.setSourceParams(data.chainId, data.vault, tokenAddr, true);
                await tx1.wait();

                // Whitelist Global Token
                const tx2 = await poolManager.setWhitelistedToken(tokenAddr, true);
                await tx2.wait();

                console.log(`    ✅ ${symbol} registered`);
            } catch (e) {
                console.error(`    ❌ Failed to register ${symbol}:`, e.message);
                if (e.message.includes("already white-listed") || e.message.includes("already registered")) {
                    console.info("    (Likely already registered)");
                }
            }
        }
    }

    console.log("\n✨ All deployments processed on Master Hub.");
}

main().catch(console.error);
