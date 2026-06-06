const hre = require("hardhat");

const DEPLOYED = {
    poolManager: "0x9f40bfe80fADa11569c68d2DFb9f3250841C572E",
    scoreManager: "0x4f8295bf1bE96b548aa0384673415217c4afed99",
    loanEngine: "0x3b3af0440510Cd99336AF525200Fd1d3F311DA24"
};

const SPOKE_ADDRESSES = {
    sepolia: {
        chainId: 11155111,
        vault: "0x8C213a3Db9187966Ebf8DfD0488A225044265AeF",
        usdc: "0xbCFCF4D1B880Ea38b71E45394FaCC5b71678C44A",
        usdt: "0xf75C8eE5b4a005120bCF0D6d457A8000dddDea8f"
    },
    hedera: {
        chainId: 296,
        vault: "0x214730188780a3A64fD24ede85f2724535772Ff0",
        usdc: "0x84373D817230268b2dE1d7727ca3c930293CCE51",
        usdt: "0xB159E0c8093081712c92e274DbFEa5A97A80cA30"
    }
};

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Resuming Configuration for MASTER on:", hre.network.name);
    console.log("📍 Account:", deployer.address);

    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: { EvmV1Decoder: "0x86768D20Ad92d727c987fddD10d08aFA25B85E78" }
    });
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    // LoanEngine doesn't have whitelisting logic we need to call directly, so just attach for linking check if needed

    const poolManager = PoolManager.attach(DEPLOYED.poolManager);
    const scoreManager = ScoreManager.attach(DEPLOYED.scoreManager);

    // 1. Ownership Transfer
    console.log("1. Checking ScoreManager Ownership...");
    try {
        const owner = await scoreManager.owner();
        if (owner !== DEPLOYED.loanEngine) {
            console.log("   Transferring ownership to LoanEngine...");
            await (await scoreManager.transferOwnership(DEPLOYED.loanEngine)).wait();
            console.log("✅ Ownership Transferred");
        } else {
            console.log("✅ Ownership already correct");
        }
    } catch (e) {
        console.error("⚠️ Failed ScoreManager config:", e.message);
    }

    // 2. Set Loan Engine
    console.log("2. Setting LoanEngine in PoolManager...");
    try {
        await (await poolManager.setLoanEngine(DEPLOYED.loanEngine)).wait();
        console.log("✅ LoanEngine Set");
    } catch (e) {
        console.log("⚠️ LoanEngine config error (maybe already set):", e.message);
    }

    // 3. Whitelist Sepolia (New Logic)
    console.log("3. Whitelisting Sepolia...");
    try {
        const SEPOLIA_ID = SPOKE_ADDRESSES.sepolia.chainId;
        const PROVER_KEY = 1;

        console.log("   - Setting Source Params for USDC...");
        await (await poolManager.setSourceParams(SEPOLIA_ID, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdc, true)).wait();
        await (await poolManager.setSourceParams(PROVER_KEY, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdc, true)).wait();

        console.log("   - Setting Source Params for USDT...");
        await (await poolManager.setSourceParams(SEPOLIA_ID, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdt, true)).wait();
        await (await poolManager.setSourceParams(PROVER_KEY, SPOKE_ADDRESSES.sepolia.vault, SPOKE_ADDRESSES.sepolia.usdt, true)).wait(); // Fixed typo in deploy-master (was usdc)

        console.log("   - Global Whitelist...");
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdc, true)).wait();
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdt, true)).wait();
        console.log("✅ Sepolia Configured");
    } catch (e) {
        console.error("⚠️ Sepolia config failed:", e.message);
    }

    // 4. Whitelist Hedera
    console.log("4. Whitelisting Hedera...");
    try {
        const HEDERA_ID = SPOKE_ADDRESSES.hedera.chainId;

        console.log("   - Setting Source Params for Hedera...");
        await (await poolManager.setSourceParams(HEDERA_ID, SPOKE_ADDRESSES.hedera.vault, SPOKE_ADDRESSES.hedera.usdc, true)).wait();
        await (await poolManager.setSourceParams(HEDERA_ID, SPOKE_ADDRESSES.hedera.vault, SPOKE_ADDRESSES.hedera.usdt, true)).wait();

        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdc, true)).wait();
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdt, true)).wait();
        console.log("✅ Hedera Configured");
    } catch (e) {
        console.error("⚠️ Hedera config failed:", e.message);
    }

    console.log("\n✅ Configuration Complete!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
