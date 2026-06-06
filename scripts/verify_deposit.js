const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("./addresses.json"));
    const [deployer] = await hre.ethers.getSigners();

    // User we want to test with
    const testUser = deployer;
    console.log("Using account:", testUser.address);

    const usdc = await hre.ethers.getContractAt("MockERC20", addresses.usdc);
    const vault = await hre.ethers.getContractAt("LiquidityVault", addresses.liquidityVault);

    const amount = hre.ethers.parseUnits("1000", 18);

    console.log("Minting 1000 USDC...");
    await usdc.connect(testUser).mint(testUser.address, amount);

    console.log("Approving USDC...");
    const approveTx = await usdc.connect(testUser).approve(addresses.liquidityVault, amount);
    await approveTx.wait();
    console.log("Approved!");

    console.log("Depositing 1000 USDC into Vault...");
    const depositTx = await vault.connect(testUser).deposit(addresses.usdc, amount);
    const receipt = await depositTx.wait();
    console.log("Deposit Success! Tx Hash:", receipt.hash);
}

main().catch(console.error);
