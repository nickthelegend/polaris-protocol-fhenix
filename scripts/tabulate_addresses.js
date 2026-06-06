const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("--- CHECKSUM TABULATION ---");

    // 1. Ganache from addresses.json
    const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
    const results = {
        GANACHE: {},
        MASTER: {}
    };

    for (const [key, val] of Object.entries(addresses)) {
        results.GANACHE[key.toUpperCase()] = ethers.getAddress(val);
    }

    // 2. Master Hub (current values in contracts.ts)
    const currentMaster = {
        POOL_MANAGER: "0xB7f5B6dc3978046c7cEA05EB529e500400290675",
        LOAN_ENGINE: "0x2a5653E5621A197600757C35abEC1c6C50Ea5344",
        SCORE_MANAGER: "0x6EfC88aFa5bA8c0f68EbCEd8410c3B1c54b87242",
        PROTOCOL_FUNDS: "0x91602066C09bdd9B42D1F5eBaC574664fbb27278",
        MERCHANT_ROUTER: "0x722878c5349e602E6f6A2A3869a5C9213bAe183F",
        CREDIT_ORACLE: "0x7EfF6789723046Cc3cEA05eB529E500400290675",
        USDC: "0x58e67dEEEcde20f10eD90B5191f08f39e81B6658",
        ORACLE: "0x0000000000000000000000000000000000000FD2"
    };

    for (const [key, val] of Object.entries(currentMaster)) {
        try {
            results.MASTER[key.toUpperCase()] = ethers.getAddress(val);
        } catch (e) {
            results.MASTER[key.toUpperCase()] = ethers.getAddress(val.toLowerCase());
        }
    }

    fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
    console.log("Done. Results in results.json");
}

main().catch(console.error);
