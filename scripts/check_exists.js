const hre = require("hardhat");

async function main() {
    const address = "0xE66545D2271438Df70f0798E7A7c8DA5870BcD17";
    const code = await hre.ethers.provider.getCode(address);
    if (code === "0x") {
        console.log("No contract at", address);
    } else {
        console.log("Contract found at", address);
    }
}

main().catch(console.error);
