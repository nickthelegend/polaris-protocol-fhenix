const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Deploying SPOKE contracts to:", hre.network.name);
    console.log("📍 Deployer:", deployer.address);
    console.log("💰 Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

    // Deploy Mock USDC
    console.log("\n📝 Deploying Mock USDC...");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    console.log(`✅ Mock USDC: ${usdcAddress}`);

    // Deploy Mock USDT
    console.log("\n📝 Deploying Mock USDT...");
    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    await usdt.waitForDeployment();
    const usdtAddress = await usdt.getAddress();
    console.log(`✅ Mock USDT: ${usdtAddress}`);

    // Deploy LiquidityVault
    console.log("\n📝 Deploying LiquidityVault...");
    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    const vault = await LiquidityVault.deploy(deployer.address);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log(`✅ LiquidityVault: ${vaultAddress}`);

    // Configure vault
    console.log("\n🔧 Configuring vault...");
    await (await vault.setTokenWhitelist(usdcAddress, true)).wait();
    await (await vault.setTokenWhitelist(usdtAddress, true)).wait();
    console.log("✅ Tokens whitelisted");

    // Mint test tokens
    console.log("\n💵 Minting test tokens...");
    await (await usdc.mint(deployer.address, hre.ethers.parseUnits("1000000", 6))).wait();
    await (await usdt.mint(deployer.address, hre.ethers.parseUnits("1000000", 6))).wait();
    console.log("✅ Minted 1M USDC and 1M USDT");

    console.log("\n" + "=".repeat(60));
    console.log(`SPOKE DEPLOYMENT COMPLETE - ${hre.network.name.toUpperCase()}`);
    console.log("=".repeat(60));
    console.log(`LiquidityVault: ${vaultAddress}`);
    console.log(`Mock USDC:      ${usdcAddress}`);
    console.log(`Mock USDT:      ${usdtAddress}`);
    console.log("=".repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
