const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log(`🚀 Deploying Extra Tokens to ${hre.network.name} with: ${deployer.address}`);

    const TOKENS_TO_DEPLOY = [
        { name: "Avalanche", symbol: "AVAX", decimals: 18 },
        { name: "Wrapped BTC", symbol: "WBTC", decimals: 8 },
        { name: "Wrapped ETH", symbol: "WETH", decimals: 18 },
        { name: "Chainlink", symbol: "LINK", decimals: 18 },
        { name: "Binance Coin", symbol: "BNB", decimals: 18 }
    ];

    const SEPOLIA_VAULT = "0x5163A9689C0560DE07Cdc2ecA391BA5BE8b3D35A";

    // Hardcoded results from previous partial run to avoid redeploying (and wasting gas/time)
    const tokenAddresses = {
        "AVAX": "0x5b731C3e54b7aC7A5516861eac9704aDBC480584",
        "WBTC": "0x4105F990aBd92f8CCCD8c58433963B862C4b34a5",
        "WETH": "0x35504AceAea50B3dbeF640618b535feDB2db680B"
    };

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const vault = await hre.ethers.getContractAt("LiquidityVault", SEPOLIA_VAULT);

    for (const token of TOKENS_TO_DEPLOY) {
        if (tokenAddresses[token.symbol]) {
            console.log(`\n  ⏭️ Skipping ${token.symbol} (already deployed at ${tokenAddresses[token.symbol]})`);
            continue;
        }

        console.log(`\n  📝 Deploying ${token.name} (${token.symbol})...`);
        try {
            const contract = await MockERC20.deploy(token.name, token.symbol, token.decimals);
            await contract.waitForDeployment();
            const address = await contract.getAddress();
            tokenAddresses[token.symbol] = address;
            console.log(`  ✅ ${token.symbol} deployed at: ${address}`);

            // Whitelist in Vault
            console.log(`  🔧 Whitelisting ${token.symbol} in Vault...`);
            const tx1 = await vault.setTokenWhitelist(address, true);
            await tx1.wait();
            console.log(`  ✅ ${token.symbol} whitelisted`);

            // Mint initial supply
            console.log(`  💵 Minting ${token.symbol}...`);
            const mintAmount = token.symbol === "WBTC" ? "100" : "1000000";
            const tx2 = await contract.mint(deployer.address, hre.ethers.parseUnits(mintAmount, token.decimals));
            await tx2.wait();
            console.log(`  ✅ ${mintAmount} ${token.symbol} minted to deployer`);
        } catch (e) {
            console.error(`  ❌ Failed to deploy ${token.symbol}:`, e.message);
            // Don't stop the whole script
        }
    }

    console.log("\n✨ Deployment Summary:");
    console.log(JSON.stringify(tokenAddresses, null, 2));

    const deploymentInfo = {
        network: hre.network.name,
        timestamp: new Date().toISOString(),
        tokens: tokenAddresses,
        vault: SEPOLIA_VAULT
    };
    fs.writeFileSync("extra_tokens_sepolia.json", JSON.stringify(deploymentInfo, null, 2));
    console.log(`\n✅ Saved to extra_tokens_sepolia.json`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
