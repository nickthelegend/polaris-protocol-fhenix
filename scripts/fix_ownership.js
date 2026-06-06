const hre = require("hardhat");

const ADDRESSES = {
    poolManager: "0xe799b8f0A37786aa77b7540E5123E4FC103a3661",
    loanEngine: "0x47F90ca038a1fdAA370eD8C8221F874270F4b54E",
    scoreManager: "0x224c0D64c04c0DBEb1aA6D8103f06a7911a89cd9"
};

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Deep Audit of Polaris Configuration\n");

    // 1. Audit LoanEngine
    console.log("--- LoanEngine Audit ---");
    const loanEngine = await hre.ethers.getContractAt("LoanEngine", ADDRESSES.loanEngine);
    const scoreManagerAddrInLoan = await loanEngine.scoreManager();
    const poolManagerAddrInLoan = await loanEngine.poolManager();
    console.log("LoanEngine Address:  ", ADDRESSES.loanEngine);
    console.log("ScoreManager in LE:  ", scoreManagerAddrInLoan);
    console.log("PoolManager in LE:   ", poolManagerAddrInLoan);

    // 2. Audit ScoreManager
    console.log("\n--- ScoreManager Audit ---");
    const scoreManager = await hre.ethers.getContractAt("ScoreManager", scoreManagerAddrInLoan);
    const poolManagerAddrInScore = await scoreManager.poolManager();
    const smOwner = await scoreManager.owner();
    console.log("ScoreManager Address:", scoreManagerAddrInLoan);
    console.log("PoolManager in SM:   ", poolManagerAddrInScore);
    console.log("ScoreManager Owner:  ", smOwner);

    // 3. Audit PoolManager
    console.log("\n--- PoolManager Audit ---");
    const poolManager = await hre.ethers.getContractAt("PoolManager", poolManagerAddrInScore);
    const loanEngineInPool = await poolManager.loanEngine();
    const pmOwner = await poolManager.owner();
    console.log("PoolManager Address: ", poolManagerAddrInScore);
    console.log("LoanEngine in PM:    ", loanEngineInPool);
    console.log("PoolManager Owner:   ", pmOwner);

    console.log("\n--- Verification ---");
    let issues = 0;

    if (smOwner.toLowerCase() !== ADDRESSES.loanEngine.toLowerCase()) {
        console.log("❌ ScoreManager NOT owned by LoanEngine!");
        issues++;
        if (smOwner.toLowerCase() === deployer.address.toLowerCase()) {
            console.log("   Attempting to fix ownership...");
            await (await scoreManager.transferOwnership(ADDRESSES.loanEngine)).wait();
            console.log("   ✅ Fixed: Ownership transferred to LoanEngine.");
        }
    } else {
        console.log("✅ ScoreManager ownership is Correct.");
    }

    if (loanEngineInPool.toLowerCase() !== ADDRESSES.loanEngine.toLowerCase()) {
        console.log("❌ PoolManager has WRONG LoanEngine pointer!");
        issues++;
        if (pmOwner.toLowerCase() === deployer.address.toLowerCase()) {
            console.log("   Attempting to fix pointer...");
            await (await poolManager.setLoanEngine(ADDRESSES.loanEngine)).wait();
            console.log("   ✅ Fixed: LoanEngine pointer updated.");
        }
    } else {
        console.log("✅ PoolManager LoanEngine pointer is Correct.");
    }

    if (issues === 0) {
        console.log("\n✅ All core pointers and ownership are correctly configured!");
    } else {
        console.log(`\n⚠️ Audit complete with ${issues} issues handled (if owner).`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
