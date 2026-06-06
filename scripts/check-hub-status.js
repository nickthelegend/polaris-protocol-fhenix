const hre = require("hardhat");
const { chainInfo } = require("@gluwa/cc-next-query-builder");

async function main() {
    const provider = new hre.ethers.JsonRpcProvider("https://rpc.usc-testnet2.creditcoin.network");
    const info = new chainInfo.PrecompileChainInfoProvider(provider);

    const chainKey = 1; // Sepolia
    try {
        const latest = await info.getLatestAttestedHeightAndHash(chainKey);
        console.log("-----------------------------------------");
        console.log("SEPOLIA (Chain 1) ATTESTATION STATUS");
        console.log("Latest Attested Height:", latest.height);
        console.log("Attestation Exists:", latest.exists);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error("Failed to fetch attestation info:", e.message);
    }
}

main().catch(console.error);
