const hre = require("hardhat");

async function main() {
    const USER_PRIVATE_KEY = "0xc1c46d8f06533e4aa0899a933ee5ba8556b244b7f262cf1b4702c575257956a2"; // Your account PK
    const VAULT_ADDRESS = "0x054678B3dd544332F1918D989eBa80d270eA55a2";
    const USDC_ADDRESS = "0xfC06c48C7670a9E19D39Fe1a6D94e6B236fa983f";

    const wallet = new hre.ethers.Wallet(USER_PRIVATE_KEY, hre.ethers.provider);
    const usdc = await hre.ethers.getContractAt("MockERC20", USDC_ADDRESS, wallet);

    console.log("Force approving 1,000,000 USDC for Vault...");
    const tx = await usdc.approve(VAULT_ADDRESS, hre.ethers.parseUnits("1000000", 18));
    await tx.wait();

    console.log("Success! You can now deposit in the browser without the approval popup.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
