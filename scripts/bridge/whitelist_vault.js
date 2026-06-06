const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    const poolManagerAddress = addresses.usc.poolManager;
    const PoolManager = await hre.ethers.getContractAt("PoolManager", poolManagerAddress);

    const chainConfigs = [
        { name: "Sepolia", chainId: 11155111, key: "sepolia" },
        { name: "Base Sepolia", chainId: 84532, key: "baseSepolia" },
        { name: "Ganache", chainId: 1337, key: "ganache" }
    ];

    for (const config of chainConfigs) {
        if (addresses[config.key]) {
            const vaultAddress = addresses[config.key].liquidityVault;
            console.log(`Whitelisting ${config.name} Vault (${vaultAddress}) on USC Hub...`);
            try {
                const tx = await PoolManager.setWhitelistedVault(config.chainId, vaultAddress, true);
                await tx.wait();
                console.log(`SUCCESS: ${config.name} whitelisted.`);
            } catch (err) {
                console.error(`FAILED: ${config.name}. ${err.message}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
