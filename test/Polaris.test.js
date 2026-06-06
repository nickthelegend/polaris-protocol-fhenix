const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Polaris Protocol", function () {
    let usdc, usdt, vault, poolManager, creditVault, loanEngine, oracle;
    let owner, lender, borrower, merchant;

    beforeEach(async function () {
        [owner, lender, borrower, merchant] = await ethers.getSigners();

        // Deploy Mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await MockERC20.deploy("USD Coin", "USDC", 18);
        usdt = await MockERC20.deploy("Tether", "USDT", 18);

        // Deploy Vault (Source Chain)
        const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
        vault = await LiquidityVault.deploy(owner.address); // Use owner as validator
        await vault.setTokenWhitelist(await usdc.getAddress(), true);
        // Deploy and Link Library
        const EvmV1Decoder = await ethers.getContractFactory("EvmV1Decoder");
        const decoder = await EvmV1Decoder.deploy();
        const decoderAddress = await decoder.getAddress();

        // Deploy Mock verifier
        const MockNativeQueryVerifier = await ethers.getContractFactory("MockNativeQueryVerifier");
        const mockVerifier = await MockNativeQueryVerifier.deploy();
        const mockVerifierAddress = await mockVerifier.getAddress();

        // Deploy PoolManager (Creditcoin)
        const PoolManager = await ethers.getContractFactory("PoolManager", {
            libraries: { EvmV1Decoder: decoderAddress }
        });
        poolManager = await PoolManager.deploy(mockVerifierAddress);

        // Deploy ScoreManager
        const ScoreManager = await ethers.getContractFactory("ScoreManager");
        const poolManagerAddress = await poolManager.getAddress();
        const scoreManager = await ScoreManager.deploy(poolManagerAddress);

        // Deploy LoanEngine
        const LoanEngine = await ethers.getContractFactory("LoanEngine", {
            libraries: { EvmV1Decoder: decoderAddress }
        });
        loanEngine = await LoanEngine.deploy(await scoreManager.getAddress(), await poolManager.getAddress(), mockVerifierAddress);

        // Transfer ScoreManager ownership to LoanEngine
        await scoreManager.transferOwnership(await loanEngine.getAddress());

        await poolManager.setLoanEngine(await loanEngine.getAddress());
        await poolManager.setWhitelistedVault(1, await vault.getAddress(), true);
        await poolManager.setWhitelistedVault(1, await usdc.getAddress(), true);
        await poolManager.setWhitelistedVault(1, await usdt.getAddress(), true);
        await poolManager.setWhitelistedToken(await usdc.getAddress(), true);
        await poolManager.setWhitelistedToken(await usdt.getAddress(), true);
    });

    function createProofChunks(from, to, amount, isRepay = false, loanId = 0) {
        const chunk0 = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
            [0, 21000, from, false, to, amount, "0x"]
        );
        const chunk1 = "0x";

        let logEntry;
        if (!isRepay) {
            logEntry = {
                address_: to,
                topics: [
                    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                    ethers.zeroPadValue(from, 32),
                    ethers.zeroPadValue("0x0000000000000000000000000000000000000001", 32)
                ],
                data: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [amount])
            };
        } else {
            logEntry = {
                address_: to,
                topics: [
                    "0x040cee90ee4799897c30ca04e5feb6fa43dbba9b6d084b4b257cdafd84ba013e",
                    ethers.zeroPadValue(ethers.toBeHex(loanId), 32)
                ],
                data: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [amount])
            };
        }

        const chunk2 = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint8", "uint64", "(address address_, bytes32[] topics, bytes data)[]", "bytes"],
            [1, 21000, [logEntry], "0x"]
        );

        return ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes[]"], [0, [chunk0, chunk1, chunk2]]);
    }

    describe("Liquidity Deposit & Oracle Proof", function () {
        it("Should deposit liquidity and add it to pool via proof", async function () {
            const depositAmount = ethers.parseEther("1000");
            await usdc.mint(lender.address, depositAmount);
            await usdc.connect(lender).approve(await vault.getAddress(), depositAmount);

            // Deposit on source chain
            const tx = await vault.connect(lender).deposit(await usdc.getAddress(), depositAmount);
            const receipt = await tx.wait();

            // V2 Proof Data
            const chainKey = 1;
            const blockHeight = 100;
            const encodedTransaction = "0x01020304"; // Dummy
            const merkleRoot = ethers.ZeroHash;
            const siblings = [];
            const lowerEndpointDigest = ethers.ZeroHash;
            const continuityRoots = [];

            // Mock verification will succeed by default with MockNativeQueryVerifier

            // We need to mock the decoder result if possible, or use a real-ish transaction
            // For now, let's assume the mock verifier and decoder are enough
            // Wait, the decoder is real! So we need a valid-ish RLP encoded transaction.

            // I'll use the same helper as V2Migration
            const txData = createProofChunks(lender.address, await usdc.getAddress(), depositAmount);

            try {
                await poolManager.addLiquidityFromProof(
                    chainKey, blockHeight, txData,
                    merkleRoot, siblings, lowerEndpointDigest, continuityRoots
                );
            } catch (error) {
                console.log("SUBMISSION ERROR:", error.message);
                throw error;
            }

            expect(await poolManager.getPoolLiquidity(await usdc.getAddress())).to.equal(depositAmount);
        });
    });

    describe("BNPL Loans", function () {
        it("Should create a loan using credit limit", async function () {
            const depositAmount = ethers.parseEther("1000");
            const loanAmount = ethers.parseEther("200");

            // Setup collateral manually for this test if needed, or through proof
            // Let's just use the previous test's state by not using a fresh beforeEach if possible? 
            // No, beforeEach runs every time.

            // We need to add liquidity first
            const txData = createProofChunks(borrower.address, await usdc.getAddress(), depositAmount);
            await poolManager.addLiquidityFromProof(1, 101, txData, ethers.ZeroHash, [], ethers.ZeroHash, []);

            await loanEngine.connect(borrower).createLoan(borrower.address, loanAmount, await usdc.getAddress());
            const loan = await loanEngine.loans(0);
            expect(loan.principal).to.equal(loanAmount);
            expect(loan.borrower).to.equal(borrower.address);
        });

        it("Should repay a loan", async function () {
            const depositAmount = ethers.parseEther("1000");
            const loanAmount = ethers.parseEther("200");

            // Add liquidity
            const txDataL = createProofChunks(borrower.address, await usdc.getAddress(), depositAmount);
            await poolManager.addLiquidityFromProof(1, 102, txDataL, ethers.ZeroHash, [], ethers.ZeroHash, []);

            await loanEngine.connect(borrower).createLoan(borrower.address, loanAmount, await usdc.getAddress());

            // Repay via proof
            const txDataR = createProofChunks(borrower.address, await loanEngine.getAddress(), loanAmount, true, 0);

            await loanEngine.repayFromProof(1, 200, txDataR, ethers.ZeroHash, [], ethers.ZeroHash, []);

            const loan = await loanEngine.loans(0);
            expect(loan.status).to.equal(1); // Repaid
        });
    });
});
