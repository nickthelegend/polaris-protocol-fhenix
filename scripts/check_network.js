const hre = require("hardhat");

async function main() {
    const provider = hre.ethers.provider;
    const network = await provider.getNetwork();
    console.log("Connected to network:");
    console.log("Name:", network.name);
    console.log("Chain ID:", network.chainId.toString());

    const [deployer] = await hre.ethers.getSigners();
    const balance = await provider.getBalance(deployer.address);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", hre.ethers.formatEther(balance), "tCTC");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
