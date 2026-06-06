const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deploying Mock USDC to ${hre.network.name} with: ${deployer.address}`);

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("Creditcoin USDC", "cUSDC", 18, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: hre.ethers.parseUnits("2", "gwei"),
        maxFeePerGas: hre.ethers.parseUnits("50", "gwei")
    });

    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();

    console.log("Mock USDC deployed to:", usdcAddress);

    // Mint some initial tokens to deployer
    console.log("Minting initial supply...");
    const tx = await usdc.mint(deployer.address, hre.ethers.parseEther("1000000"));
    await tx.wait();
    console.log("Minted 1,000,000 cUSDC");

    // Save to file
    const deployment = {
        network: hre.network.name,
        timestamp: new Date().toISOString(),
        contracts: {
            USDC: usdcAddress
        }
    };
    fs.writeFileSync("deployments-mock-tokens.json", JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
