const hre = require("hardhat");

async function main() {
    const TARGET_ADDRESS = "0x0C679b59c792BE94BE6cfE5f5ED78C9ff3E9b38f";
    const USDC_ADDRESS = "0xfC06c48C7670a9E19D39Fe1a6D94e6B236fa983f"; // Localnet USDC

    const [sender] = await hre.ethers.getSigners();
    console.log("Sending funds from:", sender.address);
    console.log("Target account:", TARGET_ADDRESS);

    // 1. Send 10 ETH
    const ethAmount = hre.ethers.parseEther("10");
    console.log(`Sending ${hre.ethers.formatEther(ethAmount)} ETH...`);
    const txEth = await sender.sendTransaction({
        to: TARGET_ADDRESS,
        value: ethAmount,
    });
    await txEth.wait();
    console.log("ETH sent. Hash:", txEth.hash);

    // 2. Send 50,000 USDC
    const usdc = await hre.ethers.getContractAt("MockERC20", USDC_ADDRESS);
    const usdcAmount = hre.ethers.parseUnits("50000", 18);
    console.log(`Sending 50,000 USDC...`);
    const txUsdc = await usdc.transfer(TARGET_ADDRESS, usdcAmount);
    await txUsdc.wait();
    console.log("USDC sent. Hash:", txUsdc.hash);

    console.log("Funding complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
