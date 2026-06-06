const hre = require("hardhat");

const ADDRESSES = {
    poolManager: "0x2a2cc16e7fa8E84169cD1c3bA79b37F2d1577B5F",
    scoreManager: "0x856442b9DD170cFDE24eB1cdF5F68E1A97e8C5E9",
    loanEngine: "0xdBA667c63045cceF16fa97DA7512A46cB02AD8FA",
    evmV1Decoder: "0x412ec75F5dBFF6D912D0780744dd77C97E1De2a7"
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
    console.log("🚀 Configuring contracts with account:", deployer.address);

    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = ScoreManager.attach(ADDRESSES.scoreManager);

    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: { EvmV1Decoder: ADDRESSES.evmV1Decoder }
    });
    const poolManager = PoolManager.attach(ADDRESSES.poolManager);

    // 1. Transfer ScoreManager ownership
    console.log("Checking ScoreManager owner...");
    const currentOwner = await scoreManager.owner();
    console.log("Current ScoreManager owner:", currentOwner);

    if (currentOwner === deployer.address) {
        console.log("Transferring ScoreManager ownership to LoanEngine...");
        const tx = await scoreManager.transferOwnership(ADDRESSES.loanEngine, {
            gasLimit: 100000,
            gasPrice: hre.ethers.parseUnits("50", "gwei")
        });
        await tx.wait();
        console.log("✅ Ownership transferred");
    } else if (currentOwner === ADDRESSES.loanEngine) {
        console.log("✅ Ownership already transferred");
    } else {
        console.log("⚠️ Unknown owner!");
    }

    // 2. Set LoanEngine in PoolManager
    console.log("Setting LoanEngine in PoolManager...");
    try {
        const tx = await poolManager.setLoanEngine(ADDRESSES.loanEngine);
        await tx.wait();
        console.log("✅ LoanEngine set");
    } catch (e) {
        console.log("⚠️ Failed to set LoanEngine (might be already set or not owner):", e.message);
    }

    // 3. Whitelist Sepolia vaults
    console.log("Whitelisting Sepolia vaults...");
    try {
        // Standard Chain ID
        // setSourceParams(chainId, liquidityVault, token, status)
        console.log(`Configuring Chain ${SPOKE_ADDRESSES.sepolia.chainId}...`);
        await (await poolManager.setSourceParams(
            SPOKE_ADDRESSES.sepolia.chainId,
            SPOKE_ADDRESSES.sepolia.vault,
            SPOKE_ADDRESSES.sepolia.usdc,
            true
        )).wait();

        await (await poolManager.setSourceParams(
            SPOKE_ADDRESSES.sepolia.chainId,
            SPOKE_ADDRESSES.sepolia.vault,
            SPOKE_ADDRESSES.sepolia.usdt,
            true
        )).wait();

        // Prover API Chain Key (1)
        const PROVER_CHAIN_KEY = 1;
        console.log(`Whitelisting Sepolia for Prover API Key ${PROVER_CHAIN_KEY}...`);
        await (await poolManager.setSourceParams(
            PROVER_CHAIN_KEY,
            SPOKE_ADDRESSES.sepolia.vault,
            SPOKE_ADDRESSES.sepolia.usdc,
            true
        )).wait();

        await (await poolManager.setSourceParams(
            PROVER_CHAIN_KEY,
            SPOKE_ADDRESSES.sepolia.vault,
            SPOKE_ADDRESSES.sepolia.usdt,
            true
        )).wait();

        // Also whitelist in the "Global Hub List" for collateral calculation
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdc, true)).wait();
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.sepolia.usdt, true)).wait(); // Fixed: was usdc
        console.log("✅ Sepolia whitelisted");
    } catch (e) {
        console.log("⚠️ Error whitelisting Sepolia:", e.message);
    }

    // 4. Whitelist Hedera vaults
    console.log("Whitelisting Hedera vaults...");
    try {
        // Hedera Chain ID
        await (await poolManager.setSourceParams(
            SPOKE_ADDRESSES.hedera.chainId,
            SPOKE_ADDRESSES.hedera.vault,
            SPOKE_ADDRESSES.hedera.usdc,
            true
        )).wait();

        await (await poolManager.setSourceParams(
            SPOKE_ADDRESSES.hedera.chainId,
            SPOKE_ADDRESSES.hedera.vault,
            SPOKE_ADDRESSES.hedera.usdt,
            true
        )).wait();

        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdc, true)).wait();
        await (await poolManager.setWhitelistedToken(SPOKE_ADDRESSES.hedera.usdt, true)).wait();
        console.log("✅ Hedera whitelisted");
    } catch (e) {
        console.log("⚠️ Error whitelisting Hedera:", e.message);
    }

    // Save deployment file
    const fs = require("fs");
    const deploymentData = {
        master: {
            network: hre.network.name,
            chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
            poolManager: ADDRESSES.poolManager,
            loanEngine: ADDRESSES.loanEngine,
            scoreManager: ADDRESSES.scoreManager,
            evmV1Decoder: ADDRESSES.evmV1Decoder
        },
        spokes: SPOKE_ADDRESSES
    };

    fs.writeFileSync("deployments.json", JSON.stringify(deploymentData, null, 2));
    console.log("\n✅ Deployment addresses saved to deployments.json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
