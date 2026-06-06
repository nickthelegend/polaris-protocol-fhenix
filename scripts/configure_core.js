const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Configuring Core Protocol with account: ${deployer.address}`);

    // Addresses from previous deployment log
    const CONTRACTS = {
        PoolManager: "0x590BF1A90eA44354B325aD4D04a61832769DE120",
        ScoreManager: "0x3fE9A95945D2c4ED1FbC213f5C826fAc22BFa341",
        LoanEngine: "0x7Fa685aeF7DE937cad4Cc30A281926b451b55DA4",
        MerchantRouter: "0x339a44F5Ff2BF65b4Cd3990F45e705532Ebf49a9"
    };

    const PoolManager = await hre.ethers.getContractAt("PoolManager", CONTRACTS.PoolManager);
    const ScoreManager = await hre.ethers.getContractAt("ScoreManager", CONTRACTS.ScoreManager);

    console.log("Setting PoolManager.setLoanEngine...");
    try {
        const tx1 = await PoolManager.setLoanEngine(CONTRACTS.LoanEngine);
        await tx1.wait();
        console.log("Success: PoolManager.setLoanEngine");
    } catch (e) {
        console.error("Failed PoolManager.setLoanEngine:", e.message);
    }

    console.log("Setting ScoreManager.transferOwnership...");
    try {
        const tx2 = await ScoreManager.transferOwnership(CONTRACTS.LoanEngine);
        await tx2.wait();
        console.log("Success: ScoreManager.transferOwnership");
    } catch (e) {
        console.error("Failed ScoreManager.transferOwnership:", e.message);
    }

    // Save Deployment Record
    const deployment = {
        network: hre.network.name,
        timestamp: new Date().toISOString(),
        contracts: CONTRACTS
    };
    fs.writeFileSync("deployments-core.json", JSON.stringify(deployment, null, 2));
    console.log("\nSaved to deployments-core.json");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
