const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("--- Starting Loan Flow Test ---");

    // Load addresses
    const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
    const [user] = await ethers.getSigners(); // Only 1 signer available in config
    const deployer = user; // Deployer is the User for this test

    // Connect to contracts
    const usdc = await ethers.getContractAt("MockERC20", addresses.usdc);
    const liquidityVault = await ethers.getContractAt("LiquidityVault", addresses.liquidityVault);
    const poolManager = await ethers.getContractAt("PoolManager", addresses.poolManager);
    const scoreManager = await ethers.getContractAt("ScoreManager", addresses.scoreManager);
    const loanEngine = await ethers.getContractAt("LoanEngine", addresses.loanEngine);
    const oracle = await ethers.getContractAt("MockOracleRelayer", addresses.oracle); // Use Mock for local test

    console.log(`User: ${user.address}`);

    // 1. Check Initial Score
    let score = await scoreManager.getScore(user.address);
    console.log(`Initial Score: ${score}`); // Should be 300

    // 2. Deposit Liquidity (Collateral)
    console.log("Depositing 1000 USDC...");
    const depositAmount = ethers.parseUnits("1000", 18);
    // Mint tokens to user first (since deployer is owner, they can mint)
    await usdc.connect(user).mint(user.address, depositAmount);
    await usdc.connect(user).approve(addresses.liquidityVault, depositAmount);
    const tx = await liquidityVault.connect(user).deposit(addresses.usdc, depositAmount);
    const receipt = await tx.wait();

    // 3. Mock Oracle Proof
    console.log("Syncing proof to Hub...");
    // In real flow, we use relayer. Here we mock it directly by adding to PoolManager OR mocking Oracle.
    // Let's use the explicit "addLiquidityFromProof" flow but with a mocked proof in MockOracleRelayer.

    // Randomize queryId to prevent re-use errors on persistent chain
    const randomId = ethers.hexlify(ethers.randomBytes(32));
    const queryId = ethers.keccak256(ethers.toUtf8Bytes(randomId));

    // Encode data expected by PoolManager: (lender, token, amount, depositId)
    // We make up a depositId = 1
    const abiCoder = new ethers.AbiCoder();
    const encodedData = abiCoder.encode(
        ["address", "address", "uint256", "uint256"],
        [user.address, addresses.usdc, depositAmount, 1]
    );

    // Seed the MockOracle
    await oracle.connect(deployer).seedProof(queryId, encodedData);

    // Call PoolManager
    await poolManager.connect(user).addLiquidityFromProof(queryId);

    // Verify LP Balance
    const lpBal = await poolManager.lpBalance(user.address, addresses.usdc);
    console.log(`LP Balance (Collateral): ${ethers.formatUnits(lpBal, 18)} USDC`);

    // 4. Check Credit Limit
    const limit = await scoreManager.getCreditLimit(user.address, addresses.usdc);
    console.log(`Credit Limit: ${ethers.formatUnits(limit, 18)} USDC`);

    // Expected: 1000 * (300/1000) = 300 USDC limit.

    // 5. Create Loan
    console.log("Requesting 200 USDC Loan...");

    // Verify wiring
    const smAddr = await loanEngine.scoreManager();
    console.log(`LoanEngine points to ScoreManager at: ${smAddr}`);
    console.log(`Expected ScoreManager: ${addresses.scoreManager}`);

    if (smAddr.toLowerCase() !== addresses.scoreManager.toLowerCase()) {
        console.error("MISMATCH! LoanEngine not wired to correct ScoreManager.");
    }

    const loanAmount = ethers.parseUnits("200", 18);
    // Explicitly estimate gas to see if that reveals error
    try {
        await loanEngine.connect(user).createLoan.estimateGas(user.address, loanAmount, addresses.usdc);
    } catch (e) {
        console.log("Estimate Gas Failed:", e.reason || e.message);
    }

    try {
        await loanEngine.connect(user).createLoan(user.address, loanAmount, addresses.usdc, { gasLimit: 5000000 });
        console.log("Loan created!");
    } catch (e) {
        console.error("FATAL ERROR in createLoan:");
        if (e.data) {
            // Try to decode generic revert
            console.error("Error Data:", e.data);
        }
        console.error(e);
        process.exit(1);
    }

    const activeDebt = await loanEngine.userActiveDebt(user.address);
    console.log(`Active Debt: ${ethers.formatUnits(activeDebt, 18)} USDC`);

    // 6. Repay Loan
    // Wait a bit? No need for mock time unless testing liquidation.
    console.log("Repaying 100 USDC...");
    const repayAmount = ethers.parseUnits("100", 18);
    // Loan ID should be 0 (first loan)
    await loanEngine.connect(user).repay(0, repayAmount);

    const newDebt = await loanEngine.userActiveDebt(user.address);
    console.log(`Remaining Debt: ${ethers.formatUnits(newDebt, 18)} USDC`);

    // 7. Check Score Update
    const newScore = await scoreManager.getScore(user.address);
    console.log(`New Score: ${newScore}`);

    if (newScore > score) {
        console.log("✅ Score increased!");
    } else {
        console.log("❌ Score did not increase.");
    }

    console.log("--- Test Complete ---");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
