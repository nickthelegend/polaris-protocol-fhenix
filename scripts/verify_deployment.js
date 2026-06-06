const hre = require("hardhat");
const addresses = require("../addresses.json");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Verifying Ganache Deployment...");

    // 1. Check ScoreManager's Oracle
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = ScoreManager.attach(addresses.scoreManager);
    const oracleAddr = await scoreManager.creditOracle();
    console.log(`ScoreManager -> CreditOracle: ${oracleAddr}`);
    if (oracleAddr.toLowerCase() === addresses.creditOracle.toLowerCase()) {
        console.log("✅ ScoreManager correctly linked to CreditOracle");
    } else {
        console.log("❌ ScoreManager Oracle mismatch!");
    }

    // 2. Check CreditOracle's Attester
    const CreditOracle = await hre.ethers.getContractFactory("CreditOracle");
    const creditOracle = CreditOracle.attach(addresses.creditOracle);
    const attester = await creditOracle.attester();
    console.log(`CreditOracle -> Attester: ${attester}`);
    if (attester.toLowerCase() === deployer.address.toLowerCase()) {
        console.log("✅ Attester correctly set to deployer");
    } else {
        console.log("❌ Attester mismatch!");
    }

    // 3. Check LoanEngine's ScoreManager/PoolManager
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: {
            EvmV1Decoder: addresses.evmV1Decoder,
        },
    });
    const loanEngine = LoanEngine.attach(addresses.loanEngine);
    const sm = await loanEngine.scoreManager();
    const pm = await loanEngine.poolManager();
    console.log(`LoanEngine -> ScoreManager: ${sm}`);
    console.log(`LoanEngine -> PoolManager: ${pm}`);

    if (sm.toLowerCase() === addresses.scoreManager.toLowerCase() &&
        pm.toLowerCase() === addresses.poolManager.toLowerCase()) {
        console.log("✅ LoanEngine relationships verified");
    } else {
        console.log("❌ LoanEngine relationship mismatch!");
    }

    // 4. Verify ProtocolFunds ownership
    const ProtocolFunds = await hre.ethers.getContractFactory("ProtocolFunds");
    const protocolFunds = ProtocolFunds.attach(addresses.protocolFunds);
    const owner = await protocolFunds.owner();
    console.log(`ProtocolFunds -> Owner: ${owner}`);
    if (owner.toLowerCase() === deployer.address.toLowerCase()) {
        console.log("✅ ProtocolFunds ownership verified");
    }

    console.log("\n--- Verification Complete ---");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
