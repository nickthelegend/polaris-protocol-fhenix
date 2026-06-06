const hre = require("hardhat");
const deployments = require("../deployments-sepolia-final.json");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Configuring Hub with Mock Tokens...");

    const poolManagerAddress = deployments.contracts.POOL_MANAGER;
    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: {
            EvmV1Decoder: "0xf3680C1440C14266e2dC0266BC56E3855920262A", // Fixed address from deployment
        },
    });
    const poolManager = await PoolManager.attach(poolManagerAddress);

    const tokens = [
        "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0", // USDC
        "0xfCaBa68297d86E56e01E8e9CcB88AF06bc093b9E", // USDT
        "0xC14c378c295D9B518f3086d7389b7d3553d6F5DA"  // WETH
    ];

    for (const token of tokens) {
        console.log(`Whitelisting token: ${token}...`);
        const tx = await poolManager.setWhitelistedToken(token, true);
        await tx.wait();
        console.log(`  Done.`);
    }

    console.log("Hub configuration complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
