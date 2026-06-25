import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

// Far-future operator expiry (unix seconds, fits uint48).
const OPERATOR_UNTIL = 4_000_000_000;

describe("Confidential Lending Suite (end-to-end encrypted)", function () {
  async function deploySuite() {
    const [owner, lender, borrower, liquidator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ConfidentialToken");
    const cUSDC = await Token.deploy("Confidential USDC", "cUSDC", 6);
    const cWETH = await Token.deploy("Confidential WETH", "cWETH", 6);

    const Score = await ethers.getContractFactory("ConfidentialScoreManager");
    const scoreManager = await Score.deploy();

    const Vault = await ethers.getContractFactory("ConfidentialCollateralVault");
    const vault = await Vault.deploy(await cWETH.getAddress());

    const Pool = await ethers.getContractFactory("ConfidentialLendingPool");
    const pool = await Pool.deploy(
      await cUSDC.getAddress(),
      await vault.getAddress(),
      await scoreManager.getAddress()
    );

    const Engine = await ethers.getContractFactory("ConfidentialLiquidationEngine");
    const engine = await Engine.deploy(
      await vault.getAddress(),
      await pool.getAddress(),
      await scoreManager.getAddress()
    );

    // Full ACL wiring.
    await vault.authorizeManager(await pool.getAddress());
    await vault.authorizeManager(await engine.getAddress());
    await scoreManager.authorizeManager(await pool.getAddress());
    await scoreManager.authorizeManager(await engine.getAddress());
    await pool.authorizeManager(await engine.getAddress());

    // Faucet mint (plaintext entry point).
    await cUSDC.mint(lender.address, 1000);
    await cWETH.mint(borrower.address, 100);

    return { owner, lender, borrower, liquidator, cUSDC, cWETH, scoreManager, vault, pool, engine };
  }

  async function enc(client: any, value: number | bigint) {
    const [e] = await client.encryptInputs([Encryptable.uint64(BigInt(value))]).execute();
    return e;
  }

  it("custodies real confidential tokens on supply and deposit", async () => {
    const { lender, borrower, cUSDC, cWETH, vault, pool } = await loadFixture(deploySuite);
    const lenderClient = await hre.cofhe.createClientWithBatteries(lender);
    const borrowerClient = await hre.cofhe.createClientWithBatteries(borrower);

    // Lender supplies 1000 cUSDC.
    await cUSDC.connect(lender).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    await pool.connect(lender).supply(await enc(lenderClient, 1000));

    await mock_expectPlaintext(lender.provider, await pool.getSupplied(lender.address), 1000n);
    await mock_expectPlaintext(lender.provider, await cUSDC.confidentialBalanceOf(await pool.getAddress()), 1000n);
    await mock_expectPlaintext(lender.provider, await cUSDC.confidentialBalanceOf(lender.address), 0n);

    // Borrower deposits 100 cWETH collateral.
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), OPERATOR_UNTIL);
    await vault.connect(borrower).deposit(await enc(borrowerClient, 100));

    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 100n);
    await mock_expectPlaintext(borrower.provider, await cWETH.confidentialBalanceOf(await vault.getAddress()), 100n);
    await mock_expectPlaintext(borrower.provider, await cWETH.confidentialBalanceOf(borrower.address), 0n);
  });

  it("borrows within health + credit limit, and disburses 0 when over-limit", async () => {
    const { owner, lender, borrower, cUSDC, cWETH, scoreManager, vault, pool } = await loadFixture(deploySuite);
    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const lenderClient = await hre.cofhe.createClientWithBatteries(lender);
    const borrowerClient = await hre.cofhe.createClientWithBatteries(borrower);

    // Liquidity + collateral.
    await cUSDC.connect(lender).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    await pool.connect(lender).supply(await enc(lenderClient, 1000));
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), OPERATOR_UNTIL);
    await vault.connect(borrower).deposit(await enc(borrowerClient, 100));

    // Credit profile: initialize + 500 limit.
    await scoreManager.initialize(borrower.address);
    await scoreManager.connect(owner).setCreditLimit(borrower.address, await enc(ownerClient, 500));

    // Borrow 60: health 100*100=10000 >= 60*150=9000 ✓, limit 60<=500 ✓ → disburse 60.
    await pool.connect(borrower).borrow(await enc(borrowerClient, 60));
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(borrower.address), 60n);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 60n);

    // Over-borrow 1000: newDebt 1060, required 159000 > weighted 10000 → unhealthy → disburse 0.
    await pool.connect(borrower).borrow(await enc(borrowerClient, 1000));
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(borrower.address), 60n);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 60n);
  });

  it("reduces debt and increases the encrypted credit score on repayment", async () => {
    const { owner, lender, borrower, cUSDC, cWETH, scoreManager, vault, pool } = await loadFixture(deploySuite);
    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const lenderClient = await hre.cofhe.createClientWithBatteries(lender);
    const borrowerClient = await hre.cofhe.createClientWithBatteries(borrower);

    await cUSDC.connect(lender).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    await pool.connect(lender).supply(await enc(lenderClient, 1000));
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), OPERATOR_UNTIL);
    await vault.connect(borrower).deposit(await enc(borrowerClient, 100));
    await scoreManager.initialize(borrower.address);
    await scoreManager.connect(owner).setCreditLimit(borrower.address, await enc(ownerClient, 500));
    await pool.connect(borrower).borrow(await enc(borrowerClient, 60));

    // Score starts at MIN (300).
    await mock_expectPlaintext(borrower.provider, await scoreManager.getEncryptedScore(borrower.address), 300n);

    // Repay 20 → debt 40, score +5 = 305.
    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    await pool.connect(borrower).repay(await enc(borrowerClient, 20));

    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 40n);
    await mock_expectPlaintext(borrower.provider, await scoreManager.getEncryptedScore(borrower.address), 305n);
  });

  it("liquidates an unhealthy position: seizes collateral, clears debt, penalizes score", async () => {
    const { owner, lender, borrower, liquidator, cUSDC, cWETH, scoreManager, vault, pool, engine } =
      await loadFixture(deploySuite);
    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const lenderClient = await hre.cofhe.createClientWithBatteries(lender);
    const borrowerClient = await hre.cofhe.createClientWithBatteries(borrower);
    const liquidatorClient = await hre.cofhe.createClientWithBatteries(liquidator);

    await cUSDC.connect(lender).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    await pool.connect(lender).supply(await enc(lenderClient, 1000));
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), OPERATOR_UNTIL);
    await vault.connect(borrower).deposit(await enc(borrowerClient, 100));
    await scoreManager.initialize(borrower.address);
    await scoreManager.connect(owner).setCreditLimit(borrower.address, await enc(ownerClient, 1000));
    await pool.connect(borrower).borrow(await enc(borrowerClient, 60));

    // Bootstrap a higher score so the liquidation penalty is observable (450 after -50).
    await scoreManager.connect(owner).setScore(borrower.address, await enc(ownerClient, 500));

    // Withdraw most collateral to push the position underwater: collateral 40, debt 60.
    // health: 40*100=4000 < 60*125=7500 → liquidatable.
    await vault.connect(borrower).withdraw(await enc(borrowerClient, 60));

    // Phase 1: audit → encrypted "unhealthy" flag is made publicly decryptable.
    await engine.connect(liquidator).auditHealth(borrower.address);
    const checkHandle = await engine.getPendingHealthCheck(borrower.address);

    // Off-chain decrypt of the boolean only (never the amounts).
    const res = await liquidatorClient.decryptForTx(checkHandle).withoutPermit().execute();
    expect(res.decryptedValue).to.equal(1n);

    // Phase 2: resolve with the MPC-signed proof → liquidate.
    await engine.connect(liquidator).resolveAudit(borrower.address, Boolean(res.decryptedValue), res.signature);

    expect(await engine.isLiquidatable(borrower.address)).to.equal(true);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 0n);
    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 0n);
    // Collateral (40) seized into the pool, on top of remaining liquidity (1000-60 disbursed = 940) → 980.
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(await pool.getAddress()), 940n);
    await mock_expectPlaintext(borrower.provider, await cWETH.confidentialBalanceOf(await pool.getAddress()), 40n);
    // Score penalized: 500 - 50 = 450.
    await mock_expectPlaintext(borrower.provider, await scoreManager.getEncryptedScore(borrower.address), 450n);
  });

  it("rejects unauthorized manager grants and privileged calls", async () => {
    const { borrower, vault, pool } = await loadFixture(deploySuite);
    await expect(vault.connect(borrower).authorizeManager(borrower.address)).to.be.reverted;
    await expect(pool.connect(borrower).clearDebt(borrower.address)).to.be.revertedWith("not authorized");
  });
});
