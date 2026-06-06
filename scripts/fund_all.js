const hre = require("hardhat");

async function main() {
    const SENDER_PK = "0x4efc8a3f0ea3f72ae8d4070ba8c0741531dfcc1e448ae3bfc2363f3fc5a2b094"; // Ganache Account 0
    const TARGETS = [
        "0x0C679b59c792BE94BE6cfE5f5ED78C9ff3E9b38f",
        "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B"
    ];
    const USDC_ADDRESS = "0xfC06c48C7670a9E19D39Fe1a6D94e6B236fa983f";

    const sender = new hre.ethers.Wallet(SENDER_PK, hre.ethers.provider);
    const usdc = await hre.ethers.getContractAt("MockERC20", USDC_ADDRESS, sender);

    for (const target of TARGETS) {
        console.log(`\nFunding ${target}...`);

        // Send 10 ETH
        const txEth = await sender.sendTransaction({
            to: target,
            value: hre.ethers.parseEther("10"),
        });
        await txEth.wait();
        console.log(`- 10 ETH sent`);

        // Send 100,000 USDC
        const txUsdc = await usdc.transfer(target, hre.ethers.parseUnits("100000", 18));
        await txUsdc.wait();
        console.log(`- 100,000 USDC sent`);
    }

    console.log("\nAll accounts funded!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
