const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("V2 Migration Tests", function () {
    let poolManager, loanEngine, scoreManager, mockVerifier, evmDecoder;
    let owner, lender, borrower;

    beforeEach(async function () {
        try {
            [owner, lender, borrower] = await ethers.getSigners();

            const MockVerifier = await ethers.getContractFactory("MockNativeQueryVerifier");
            mockVerifier = await MockVerifier.deploy();
            await mockVerifier.waitForDeployment();
            const mockVerifierAddress = await mockVerifier.getAddress();

            const EvmDecoder = await ethers.getContractFactory("EvmV1Decoder");
            evmDecoder = await EvmDecoder.deploy();
            await evmDecoder.waitForDeployment();

            const PoolManager = await ethers.getContractFactory("PoolManager", {
                libraries: { EvmV1Decoder: await evmDecoder.getAddress() },
            });
            poolManager = await PoolManager.deploy(mockVerifierAddress);
            await poolManager.waitForDeployment();

            const ScoreManager = await ethers.getContractFactory("ScoreManager");
            scoreManager = await ScoreManager.deploy(await poolManager.getAddress());
            await scoreManager.waitForDeployment();

            const LoanEngine = await ethers.getContractFactory("LoanEngine", {
                libraries: { EvmV1Decoder: await evmDecoder.getAddress() },
            });
            loanEngine = await LoanEngine.deploy(await scoreManager.getAddress(), await poolManager.getAddress(), mockVerifierAddress);
            await loanEngine.waitForDeployment();

            await poolManager.setLoanEngine(await loanEngine.getAddress());

            // Transfer ownership of ScoreManager to LoanEngine so it can record repayments
            await scoreManager.transferOwnership(await loanEngine.getAddress());
        } catch (error) {
            console.error("SETUP ERROR:", error);
            throw error;
        }
    });

    const createProofChunks = (from, to, amount, isTransfer = true, loanId = 0) => {
        const chunk0 = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
            [1, 21000, from, false, to, isTransfer ? amount : 0, "0x"]
        );
        const chunk1 = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint128", "uint256", "bytes32", "bytes32"],
            [0, 0, ethers.ZeroHash, ethers.ZeroHash]
        );

        let logEntry;
        if (isTransfer) {
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
    };

    describe("PoolManager V2", function () {
        it("Should add liquidity via V2 proof", async function () {
            const chainKey = 1;
            const blockHeight = 100;
            const depositAmount = ethers.parseEther("500");
            const vaultAddress = owner.address;

            await poolManager.setWhitelistedVault(chainKey, vaultAddress, true);
            const encodedTransaction = createProofChunks(lender.address, vaultAddress, depositAmount);

            await poolManager.addLiquidityFromProof(chainKey, blockHeight, encodedTransaction, ethers.ZeroHash, [], ethers.ZeroHash, []);
            expect(await poolManager.lpBalance(lender.address, vaultAddress)).to.equal(depositAmount);
        });
    });

    describe("LoanEngine V2", function () {
        it("Should repay loan via V2 proof", async function () {
            const poolToken = owner.address;
            await poolManager.setWhitelistedVault(1, poolToken, true);
            await poolManager.setWhitelistedToken(poolToken, true);

            const collatAmount = ethers.parseEther("1000");
            const encodedTransactionCollat = createProofChunks(borrower.address, poolToken, collatAmount);
            // Use unique block height to avoid replay protection
            await poolManager.addLiquidityFromProof(1, 200, encodedTransactionCollat, ethers.ZeroHash, [], ethers.ZeroHash, []);

            const loanAmount = ethers.parseEther("100");
            await loanEngine.createLoan(borrower.address, loanAmount, poolToken);

            const encodedTransactionRepay = createProofChunks(borrower.address, await loanEngine.getAddress(), loanAmount, false, 0);
            await loanEngine.repayFromProof(1, 201, encodedTransactionRepay, ethers.ZeroHash, [], ethers.ZeroHash, []);

            const loan = await loanEngine.loans(0);
            expect(loan.status).to.equal(1); // Repaid
            expect(loan.repaid).to.equal(loanAmount);
        });
    });
});
