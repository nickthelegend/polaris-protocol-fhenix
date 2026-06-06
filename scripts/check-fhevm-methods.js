const hre = require("hardhat");

async function main() {
    console.log("FHEVM Object Keys:", Object.keys(hre.fhevm));
    if (hre.fhevm.gateway) {
        console.log("Gateway Object Keys:", Object.keys(hre.fhevm.gateway));
    }
}

main().catch(console.error);
