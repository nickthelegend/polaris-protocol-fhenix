const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const networkName = hre.network.name;
    const chainId = hre.network.config.chainId;

    console.log(`🚀 Deploying Polaris Spoke to ${networkName} (Chain ${chainId})`);
    console.log(`👛 Account: ${deployer.address}\n`);

    if (networkName === "hardhat" || networkName === "localhost") {
        console.warn("⚠️ Warning: Deploying to local network.");
    }

    const TOKENS_TO_DEPLOY = [
        { name: "USD Coin", symbol: "USDC", decimals: 6 },
        { name: "Tether USD", symbol: "USDT", decimals: 6 },
        { name: "Avalanche", symbol: "AVAX", decimals: 18 },
        { name: "Wrapped BTC", symbol: "WBTC", decimals: 8 },
        { name: "Wrapped ETH", symbol: "WETH", decimals: 18 },
        { name: "Chainlink", symbol: "LINK", decimals: 18 },
        { name: "Binance Coin", symbol: "BNB", decimals: 18 }
    ];

    const resultsFile = path.join(__dirname, "../spoke_deployments.json");
    let allResults = {};
    if (fs.existsSync(resultsFile)) {
        allResults = JSON.parse(fs.readFileSync(resultsFile));
    }

    const currentResults = {
        chainId: chainId,
        vault: "",
        tokens: {},
        timestamp: new Date().toISOString()
    };

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");

    // 1. Deploy Vault
    console.log("  📝 Deploying LiquidityVault...");
    const vault = await LiquidityVault.deploy(deployer.address);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    currentResults.vault = vaultAddress;
    console.log(`  ✅ Vault at: ${vaultAddress}`);

    // 2. Deploy Tokens
    for (const token of TOKENS_TO_DEPLOY) {
        console.log(`  📝 Deploying ${token.symbol}...`);
        const contract = await MockERC20.deploy(token.name, token.symbol, token.decimals);
        await contract.waitForDeployment();
        const address = await contract.getAddress();
        currentResults.tokens[token.symbol] = address;
        console.log(`    ✅ ${token.symbol} at: ${address}`);

        // Whitelist in Vault
        await (await vault.setTokenWhitelist(address, true)).wait();

        // Mint initial supply
        const mintAmount = token.symbol === "WBTC" ? "100" : "1000000";
        await (await contract.mint(deployer.address, hre.ethers.parseUnits(mintAmount, token.decimals))).wait();
    }

    allResults[networkName] = currentResults;
    fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
    console.log(`\n✅ ${networkName} deployment complete and saved to spoke_deployments.json`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
