import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

/**
 * Full end-to-end journey that mirrors deploy + bootstrap + real usage of the confidential suite:
 *   deploy all 8 contracts -> wire ACL -> bootstrap (mint, seed pool + swap, set limit, register
 *   merchant) -> lender supplies -> borrower deposits/borrows/repays (score up) -> user swaps ->
 *   customer pays a merchant privately and the merchant sees its public payment count.
 * Everything decrypts only for the owner; amounts never appear in plaintext.
 */
const UNTIL = 4_000_000_000;

describe("Confidential suite — full E2E (deploy → bootstrap → journey)", function () {
  // This test runs a long stateful sequence WITHOUT loadFixture, so snapshot/revert around it to
  // isolate its on-chain mock ACL grants from the rest of the suite (deterministic mock ctHashes
  // can otherwise collide across tests).
  let snapshotId: string;
  beforeEach(async () => { snapshotId = await ethers.provider.send("evm_snapshot", []); });
  afterEach(async () => { await ethers.provider.send("evm_revert", [snapshotId]); });

  it("runs the entire confidential flow with encryption + decryption", async () => {
    const [deployer, lender, borrower, customer, merchant] = await ethers.getSigners();

    // ── Deploy ──
    const Token = await ethers.getContractFactory("ConfidentialToken");
    const cUSDC = await Token.deploy("Confidential USDC", "cUSDC", 6);
    const cWETH = await Token.deploy("Confidential WETH", "cWETH", 6);
    const Score = await ethers.getContractFactory("ConfidentialScoreManager");
    const score = await Score.deploy();
    const Vault = await ethers.getContractFactory("ConfidentialCollateralVault");
    const vault = await Vault.deploy(await cWETH.getAddress());
    const Pool = await ethers.getContractFactory("ConfidentialLendingPool");
    const pool = await Pool.deploy(await cUSDC.getAddress(), await vault.getAddress(), await score.getAddress());
    const Engine = await ethers.getContractFactory("ConfidentialLiquidationEngine");
    const engine = await Engine.deploy(await vault.getAddress(), await pool.getAddress(), await score.getAddress());
    const Escrow = await ethers.getContractFactory("ConfidentialMerchantEscrow");
    const escrow = await Escrow.deploy(await cUSDC.getAddress());
    const Swap = await ethers.getContractFactory("ConfidentialSwapPool");
    const swap = await Swap.deploy(await cWETH.getAddress(), await cUSDC.getAddress(), 2000, 1);

    // ── ACL wiring ──
    await vault.authorizeManager(await pool.getAddress());
    await vault.authorizeManager(await engine.getAddress());
    await score.authorizeManager(await pool.getAddress());
    await score.authorizeManager(await engine.getAddress());
    await pool.authorizeManager(await engine.getAddress());

    // ── Bootstrap ──
    // mint
    await cUSDC.connect(deployer).mint(lender.address, 1_000_000);
    await cWETH.connect(deployer).mint(borrower.address, 1000);
    await cUSDC.connect(deployer).mint(customer.address, 5000);
    await cWETH.connect(deployer).mint(deployer.address, 1000); // swap A liquidity
    await cUSDC.connect(deployer).mint(deployer.address, 4_000_000); // swap B liquidity
    // seed swap liquidity
    const depClient = await hre.cofhe.createClientWithBatteries(deployer);
    await cWETH.connect(deployer).setOperator(await swap.getAddress(), UNTIL);
    await cUSDC.connect(deployer).setOperator(await swap.getAddress(), UNTIL);
    const [encA] = await depClient.encryptInputs([Encryptable.uint64(1000n)]).execute();
    await swap.connect(deployer).addLiquidityA(encA);
    const [encB] = await depClient.encryptInputs([Encryptable.uint64(4_000_000n)]).execute();
    await swap.connect(deployer).addLiquidityB(encB);
    // credit profile for borrower
    await score.initialize(borrower.address);
    const [encLimit] = await depClient.encryptInputs([Encryptable.uint64(1000n)]).execute();
    await score.connect(deployer).setCreditLimit(borrower.address, encLimit);
    // register merchant
    await escrow.connect(merchant).registerMerchant();

    // ── Lender supplies liquidity ──
    const lenderClient = await hre.cofhe.createClientWithBatteries(lender);
    await cUSDC.connect(lender).setOperator(await pool.getAddress(), UNTIL);
    const [encSupply] = await lenderClient.encryptInputs([Encryptable.uint64(1_000_000n)]).execute();
    await pool.connect(lender).supply(encSupply);
    await mock_expectPlaintext(lender.provider, await pool.getSupplied(lender.address), 1_000_000n);

    // ── Borrower deposits collateral, borrows, repays ──
    const borrowerClient = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    const [encColl] = await borrowerClient.encryptInputs([Encryptable.uint64(100n)]).execute();
    await vault.connect(borrower).deposit(encColl);
    const [encBorrow] = await borrowerClient.encryptInputs([Encryptable.uint64(60n)]).execute();
    await pool.connect(borrower).borrow(encBorrow);
    // borrower received 60 cUSDC, owes 60
    expect(await borrowerClient.decryptForView(await cUSDC.confidentialBalanceOf(borrower.address), FheTypes.Uint64).execute()).to.equal(60n);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 60n);
    // repay 20, score 300 -> 305
    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), UNTIL);
    const [encRepay] = await borrowerClient.encryptInputs([Encryptable.uint64(20n)]).execute();
    await pool.connect(borrower).repay(encRepay);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 40n);
    expect(await borrowerClient.decryptForView(await score.getEncryptedScore(borrower.address), FheTypes.Uint32).execute()).to.equal(305n);

    // ── User swaps 5 cWETH -> 10000 cUSDC ──
    await cWETH.connect(deployer).mint(customer.address, 5);
    const custClient = await hre.cofhe.createClientWithBatteries(customer);
    await cWETH.connect(customer).setOperator(await swap.getAddress(), UNTIL);
    const [encSwap] = await custClient.encryptInputs([Encryptable.uint64(5n)]).execute();
    await swap.connect(customer).swapAToB(encSwap);
    // customer had 5000 cUSDC + 10000 from swap = 15000
    expect(await custClient.decryptForView(await cUSDC.confidentialBalanceOf(customer.address), FheTypes.Uint64).execute()).to.equal(15000n);

    // ── Customer pays the merchant privately ──
    await cUSDC.connect(customer).setOperator(await escrow.getAddress(), UNTIL);
    const orderId = ethers.id("e2e-order-1");
    const [encPay] = await custClient.encryptInputs([Encryptable.uint64(250n)]).execute();
    await escrow.connect(customer).settlePayment(orderId, merchant.address, encPay);

    // merchant received 250 (encrypted), and the PUBLIC analytics count is 1
    const merchantClient = await hre.cofhe.createClientWithBatteries(merchant);
    expect(await merchantClient.decryptForView(await escrow.getReceived(merchant.address), FheTypes.Uint64).execute()).to.equal(250n);
    expect(await escrow.paymentCount(merchant.address)).to.equal(1n);
    const [registered, payments] = await escrow.getMerchantStats(merchant.address);
    expect(registered).to.equal(true);
    expect(payments).to.equal(1n);
    expect(await escrow.totalPayments()).to.equal(1n);
  });
});
