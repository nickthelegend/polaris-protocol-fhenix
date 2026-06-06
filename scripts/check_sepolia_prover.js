const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
    const address = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";
    const code = await provider.getCode(address);
    console.log(`Code at ${address} on Sepolia: ${code === "0x" ? "NONE" : "CONTRACT FOUND"}`);
}

main().catch(console.error);
