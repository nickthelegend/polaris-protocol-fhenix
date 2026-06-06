const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Polaris Protocol Full Lifecycle", function () {
    let usdc, vault, oracle, poolManager, scoreManager, loanEngine;
    let owner, lender, borrower;
    const INITIAL_MINT = ethers.parseEther("10000");

    before(async function () {
        [owner, lender, borrower] = await ethers.getSigners();

        // 1. Deploy Mock USDC
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await MockERC20.deploy("USD Coin", "USDC", 18);

        // 2. Deploy Mock Oracle
        const MockUSCOracle = await ethers.getContractFactory("MockUSCOracle");
        oracle = await MockUSCOracle.deploy();

        // 3. Deploy LiquidityVault (Spoke)
        const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
        vault = await LiquidityVault.deploy(await oracle.getAddress());
        await vault.setTokenWhitelist(await usdc.getAddress(), true);

        // 4. Deploy PoolManager (Hub)
        const PoolManager = await ethers.getContractFactory("PoolManager");
        poolManager = await PoolManager.deploy(await oracle.getAddress());

        // 5. Deploy ScoreManager (Hub)
        const ScoreManager = await ethers.getContractFactory("ScoreManager");
        scoreManager = await ScoreManager.deploy(await poolManager.getAddress());

        // 6. Deploy LoanEngine (Hub)
        const LoanEngine = await ethers.getContractFactory("LoanEngine");
        loanEngine = await LoanEngine.deploy(await scoreManager.getAddress(), await poolManager.getAddress());

        // Setup Relationships
        await poolManager.setLoanEngine(await loanEngine.getAddress());
        await scoreManager.transferOwnership(await loanEngine.getAddress()); // LoanEngine updates scores

        // Initial Minting
        await usdc.mint(lender.address, INITIAL_MINT);
        await usdc.mint(borrower.address, INITIAL_MINT);
    });

    describe("1. Liquidity Provision (Bridge Sync)", function () {
        it("Should synchronize liquidity from Spoke to Hub via Oracle Proof", async function () {
            const depositAmount = ethers.parseEther("1000");
            await usdc.connect(lender).approve(await vault.getAddress(), depositAmount);

            // Spoke Side: Deposit
            const tx = await vault.connect(lender).deposit(await usdc.getAddress(), depositAmount);
            const receipt = await tx.wait();

            // Mock Oracle Data
            const queryId = ethers.id("test-query-deposit");
            // Build segments manually to match the real bridge decoding
            const segments = [
                { offset: 0, abiBytes: ethers.ZeroHash }, // 0: Rx
                { offset: 0, abiBytes: ethers.ZeroHash }, // 1: From
                { offset: 0, abiBytes: ethers.ZeroHash }, // 2: To
                { offset: 0, abiBytes: ethers.ZeroHash }, // 3: Meta Addr
                { offset: 0, abiBytes: ethers.ZeroHash }, // 4: Meta Signature
                { offset: 0, abiBytes: ethers.zeroPadValue(lender.address, 32) }, // 5: lender
                { offset: 0, abiBytes: ethers.zeroPadValue(await usdc.getAddress(), 32) }, // 6: token
                { offset: 0, abiBytes: ethers.zeroPadValue(ethers.toBeHex(depositAmount), 32) }, // 7: amount
                { offset: 0, abiBytes: ethers.ZeroHash } // 8: depositId
            ];
            const details = {
                state: 2, // Processed
                query: { chainId: 1, height: 100, index: 1, layoutSegments: [] },
                escrowedAmount: 0,
                principal: owner.address,
                estimatedCost: 0,
                timestamp: Math.floor(Date.now() / 1000),
                resultSegments: segments
            };
            await oracle.setProof(queryId, details);

            // Hub Side: Sync
            await poolManager.addLiquidityFromProof(queryId);

            expect(await poolManager.lpBalance(lender.address, await usdc.getAddress())).to.equal(depositAmount);
            expect(await poolManager.getPoolLiquidity(await usdc.getAddress())).to.equal(depositAmount);
        });
    });

    describe("2. Credit Scoring Logic", function () {
        it("Should start with minimum score of 300", async function () {
            expect(await scoreManager.getScore(lender.address)).to.equal(300);
        });

        it("Should calculate credit limit as Collateral * (Score / 1000)", async function () {
            // Lender has 1000 LP, score is 300. Limit = 1000 * 0.3 = 300.
            const limit = await scoreManager.getCreditLimit(lender.address, await usdc.getAddress());
            expect(limit).to.equal(ethers.parseEther("300"));
        });
    });

    describe("3. Loan Management", function () {
        it("Should allow borrowing within credit limit", async function () {
            const loanAmount = ethers.parseEther("200");
            await loanEngine.connect(lender).createLoan(lender.address, loanAmount, await usdc.getAddress());

            const loan = await loanEngine.loans(0);
            expect(loan.principal).to.equal(loanAmount);
            expect(loan.status).to.equal(0); // Active
            expect(await loanEngine.userActiveDebt(lender.address)).to.equal(loanAmount);
        });

        it("Should reject borrowing above credit limit", async function () {
            const highAmount = ethers.parseEther("101"); // Total becomes 301, limit is 300
            await expect(
                loanEngine.connect(lender).createLoan(lender.address, highAmount, await usdc.getAddress())
            ).to.be.revertedWith("Exceeds credit limit");
        });

        it("Should increase score upon repayment activity", async function () {
            const repayAmount = ethers.parseEther("100");
            const oldScore = await scoreManager.getScore(lender.address);

            await loanEngine.connect(lender).repay(0, repayAmount);

            const newScore = await scoreManager.getScore(lender.address);
            expect(newScore).to.be.greaterThan(oldScore);
        });

        it("Should clear debt when fully repaid", async function () {
            const loan = await loanEngine.loans(0);
            const remaining = loan.principal - loan.repaid;

            await loanEngine.connect(lender).repay(0, remaining);

            const updatedLoan = await loanEngine.loans(0);
            expect(updatedLoan.status).to.equal(1); // Repaid
            expect(await loanEngine.userActiveDebt(lender.address)).to.equal(0);
        });
    });

    describe("4. Liquidation (Slashing)", function () {
        before(async function () {
            // Borrower deposits 500 USDC as collateral
            const depositAmount = ethers.parseEther("500");
            await usdc.connect(borrower).approve(await vault.getAddress(), depositAmount);
            await vault.connect(borrower).deposit(await usdc.getAddress(), depositAmount);

            const queryId = ethers.id("test-query-borrower");
            const segments = [
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.zeroPadValue(borrower.address, 32) },
                { offset: 0, abiBytes: ethers.zeroPadValue(await usdc.getAddress(), 32) },
                { offset: 0, abiBytes: ethers.zeroPadValue(ethers.toBeHex(depositAmount), 32) },
                { offset: 0, abiBytes: ethers.ZeroHash }
            ];
            const details = {
                state: 2,
                query: { chainId: 1, height: 100, index: 1, layoutSegments: [] },
                escrowedAmount: 0,
                principal: owner.address,
                estimatedCost: 0,
                timestamp: Math.floor(Date.now() / 1000),
                resultSegments: segments
            };
            await oracle.setProof(queryId, details);
            await poolManager.addLiquidityFromProof(queryId);
        });

        it("Should initiate liquidation if loan is defaulted", async function () {
            // Borrow 100 USDC (limit is 500 * 0.3 = 150)
            const loanAmount = ethers.parseEther("100");
            await loanEngine.connect(borrower).createLoan(borrower.address, loanAmount, await usdc.getAddress());
            const loanId = 1;

            // Simulate time passing (move past 56 days)
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 60]);
            await ethers.provider.send("evm_mine");

            expect(await loanEngine.checkLiquidatable(loanId)).to.be.true;

            // Liquidate
            const oldLP = await poolManager.lpBalance(borrower.address, await usdc.getAddress());
            await loanEngine.liquidate(loanId);

            const newLP = await poolManager.lpBalance(borrower.address, await usdc.getAddress());

            // Check Slashing: 100 USDC principal should be slashed from LP
            expect(oldLP - newLP).to.equal(loanAmount);

            const loan = await loanEngine.loans(loanId);
            expect(loan.status).to.equal(2); // Defaulted
        });
    });

    describe("5. Withdrawal Cycle (Reverse Bridge)", function () {
        it("Should authorize and release funds on Spoke chain", async function () {
            const withdrawAmount = ethers.parseEther("100");
            const initialBal = await usdc.balanceOf(lender.address);

            // Hub Side: Authorize
            await poolManager.connect(lender).requestWithdrawal(await usdc.getAddress(), withdrawAmount);

            // Mock Reverse Oracle Proof
            const queryId = ethers.id("test-query-withdraw");
            const segments = [
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.ZeroHash },
                { offset: 0, abiBytes: ethers.zeroPadValue(lender.address, 32) },
                { offset: 0, abiBytes: ethers.zeroPadValue(await usdc.getAddress(), 32) },
                { offset: 0, abiBytes: ethers.zeroPadValue(ethers.toBeHex(withdrawAmount), 32) },
                { offset: 0, abiBytes: ethers.zeroPadValue(ethers.toBeHex(0), 32) }
            ];
            const details = {
                state: 2,
                query: { chainId: 1, height: 100, index: 1, layoutSegments: [] },
                escrowedAmount: 0,
                principal: owner.address,
                estimatedCost: 0,
                timestamp: Math.floor(Date.now() / 1000),
                resultSegments: segments
            };
            await oracle.setProof(queryId, details);

            // Spoke Side: Release
            await vault.withdrawWithAuth(queryId);

            expect(await usdc.balanceOf(lender.address)).to.equal(initialBal + withdrawAmount);
        });
    });
});
