const hre = require("hardhat");

async function main() {
    // CONFIG: Update these with the addresses from your deployment output if they changed
    const VAULT_ADDRESS = "0x054678B3dd544332F1918D989eBa80d270eA55a2";
    const USDC_ADDRESS = "0xfC06c48C7670a9E19D39Fe1a6D94e6B236fa983f";
    const POOL_MANAGER_ADDRESS_USC = "0xB159E0c8093081712c92e274DbFEa5A97A80cA30";

    const [signer] = await hre.ethers.getSigners();
    console.log("Using account:", signer.address);

    const vault = await hre.ethers.getContractAt("LiquidityVault", VAULT_ADDRESS);
    const usdc = await hre.ethers.getContractAt("MockERC20", USDC_ADDRESS);

    const depositAmount = hre.ethers.parseEther("5000"); // 5000 USDC

    console.log(`Approving ${depositAmount} USDC...`);
    await (await usdc.approve(VAULT_ADDRESS, depositAmount)).wait();

    console.log("Depositing to LiquidityVault on Localnet...");
    const tx = await vault.deposit(USDC_ADDRESS, depositAmount);
    const receipt = await tx.wait();

    console.log("Deposit Transaction Hash:", tx.hash);

    // Extract event data for the proof
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'LiquidityDeposited');
    // Note: For USC Oracle, usually the backend captures this. 
    // Here we show what the encoded data looks like for the addLiquidityFromProof call.

    const queryId = hre.ethers.id(tx.hash + Date.now()); // Simulate a unique queryId

    const encodedData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256"],
        [signer.address, USDC_ADDRESS, depositAmount, 0] // lender, token, amount, depositId
    );

    console.log("\n--- USC ORACLE FLOW STEPS ---");
    console.log("1. Submit this tx hash to Creditcoin Oracle:");
    console.log(`   Command: yarn submit_query <rpc> ${tx.hash} <pk>`);
    console.log("\n2. Once Oracle verifies, you get a queryId.");
    console.log(`   Example Query ID: ${queryId}`);
    console.log("\n3. Call PoolManager on Creditcoin USC Testnet:");
    console.log(`   Target: ${POOL_MANAGER_ADDRESS_USC}`);
    console.log(`   Method: addLiquidityFromProof(${queryId})`);
    console.log("\nEncoded Proof Data (for Mocking/Validation):");
    console.log(encodedData);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
