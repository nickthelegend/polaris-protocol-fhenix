const hre = require("hardhat");

async function main() {
    const ADDRESS = "0x0C679b59c792BE94BE6cfE5f5ED78C9ff3E9b38f";
    const USDC_ADDRESS = "0xfC06c48C7670a9E19D39Fe1a6D94e6B236fa983f";

    const provider = hre.ethers.provider;
    const ethBalance = await provider.getBalance(ADDRESS);

    const usdc = await hre.ethers.getContractAt("MockERC20", USDC_ADDRESS);
    const usdcBalance = await usdc.balanceOf(ADDRESS);

    console.log(`Address: ${ADDRESS}`);
    console.log(`ETH Balance: ${hre.ethers.formatEther(ethBalance)} ETH`);
    console.log(`USDC Balance: ${hre.ethers.formatUnits(usdcBalance, 18)} USDC`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
