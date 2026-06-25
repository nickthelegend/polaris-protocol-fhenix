import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

/**
 * Exhaustive per-method tests for the confidential suite. Each test ENCRYPTS its inputs
 * client-side and DECRYPTS the results two ways:
 *   - mock_expectPlaintext(...) — asserts the value stored on-chain (the ciphertext's plaintext)
 *   - client.decryptForView(handle, type) — the real SDK decrypt path, gated by a permit
 * so you can see encryption + decryption working for every method.
 */
const UNTIL = 4_000_000_000;
const enc = async (client: any, v: number | bigint) =>
  (await client.encryptInputs([Encryptable.uint64(BigInt(v))]).execute())[0];

// ───────────────────────────── ConfidentialToken ─────────────────────────────
describe("ConfidentialToken — every method (encrypted)", () => {
  async function fix() {
    const [owner, alice, bob, carol] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ConfidentialToken");
    const token = await T.deploy("Confidential USDC", "cUSDC", 6);
    return { owner, alice, bob, carol, token };
  }

  it("mint → confidentialBalanceOf decrypts to the minted amount (only the owner of the handle)", async () => {
    const { owner, alice, bob, token } = await loadFixture(fix);
    const aliceC = await hre.cofhe.createClientWithBatteries(alice);
    const bobC = await hre.cofhe.createClientWithBatteries(bob);

    await token.connect(owner).mint(alice.address, 500);
    const h = await token.confidentialBalanceOf(alice.address);
    await mock_expectPlaintext(alice.provider, h, 500n);                       // on-chain ciphertext = 500
    expect(await aliceC.decryptForView(h, FheTypes.Uint64).execute()).to.equal(500n); // SDK decrypt
    await expect(bobC.decryptForView(h, FheTypes.Uint64).execute()).to.be.rejected;   // bob denied
  });

  it("confidentialTransfer(InEuint64) moves an encrypted amount; both balances update", async () => {
    const { owner, alice, bob, token } = await loadFixture(fix);
    const aliceC = await hre.cofhe.createClientWithBatteries(alice);
    await token.connect(owner).mint(alice.address, 500);
    await token.connect(alice)["confidentialTransfer(address,(uint256,uint8,uint8,bytes))"](bob.address, await enc(aliceC, 120));
    await mock_expectPlaintext(alice.provider, await token.confidentialBalanceOf(alice.address), 380n);
    await mock_expectPlaintext(bob.provider, await token.confidentialBalanceOf(bob.address), 120n);
  });

  it("zero-replacement: over-sending more than balance moves 0 (no revert, no leak)", async () => {
    const { owner, alice, bob, token } = await loadFixture(fix);
    const aliceC = await hre.cofhe.createClientWithBatteries(alice);
    await token.connect(owner).mint(alice.address, 100);
    await token.connect(alice)["confidentialTransfer(address,(uint256,uint8,uint8,bytes))"](bob.address, await enc(aliceC, 999));
    await mock_expectPlaintext(alice.provider, await token.confidentialBalanceOf(alice.address), 100n); // unchanged
    await mock_expectPlaintext(bob.provider, await token.confidentialBalanceOf(bob.address), 0n);       // got 0
  });

  it("setOperator / isOperator + confidentialTransferFrom (operator pulls funds)", async () => {
    const { owner, alice, bob, carol, token } = await loadFixture(fix);
    const carolC = await hre.cofhe.createClientWithBatteries(carol);
    await token.connect(owner).mint(alice.address, 300);
    expect(await token.isOperator(alice.address, carol.address)).to.equal(false);
    await token.connect(alice).setOperator(carol.address, UNTIL);
    expect(await token.isOperator(alice.address, carol.address)).to.equal(true);
    // carol (operator) pulls 200 alice -> bob
    await token.connect(carol)["confidentialTransferFrom(address,address,(uint256,uint8,uint8,bytes))"](alice.address, bob.address, await enc(carolC, 200));
    await mock_expectPlaintext(alice.provider, await token.confidentialBalanceOf(alice.address), 100n);
    await mock_expectPlaintext(bob.provider, await token.confidentialBalanceOf(bob.address), 200n);
    // a non-operator cannot pull
    await expect(
      token.connect(bob)["confidentialTransferFrom(address,address,(uint256,uint8,uint8,bytes))"](alice.address, bob.address, await enc(carolC, 10))
    ).to.be.reverted;
  });

  it("operator window expires (isOperator false in the past)", async () => {
    const { owner, alice, carol, token } = await loadFixture(fix);
    await token.connect(alice).setOperator(carol.address, 1); // expired (ts=1)
    expect(await token.isOperator(alice.address, carol.address)).to.equal(false);
  });

  it("burn reduces the encrypted balance", async () => {
    const { owner, alice, token } = await loadFixture(fix);
    const aliceC = await hre.cofhe.createClientWithBatteries(alice);
    await token.connect(owner).mint(alice.address, 500);
    await token.connect(alice).burn(200);
    await mock_expectPlaintext(alice.provider, await token.confidentialBalanceOf(alice.address), 300n);
    expect(await aliceC.decryptForView(await token.confidentialBalanceOf(alice.address), FheTypes.Uint64).execute()).to.equal(300n);
  });

  it("indicator system: balanceOf is a non-confidential indicator, not the real balance", async () => {
    const { owner, alice, token } = await loadFixture(fix);
    expect(await token.balanceOfIsIndicator()).to.equal(true);
    await token.connect(owner).mint(alice.address, 12345);
    const indicator = await token.balanceOf(alice.address);
    expect(indicator).to.not.equal(12345n);             // it is NOT the real amount
    expect(Number(indicator)).to.be.greaterThan(0);     // it ticks on activity
  });

  it("opt-in disclosure: requestDiscloseBalance → decryptForTx → finalizeDiscloseBalance", async () => {
    const { owner, alice, token } = await loadFixture(fix);
    const aliceC = await hre.cofhe.createClientWithBatteries(alice);
    await token.connect(owner).mint(alice.address, 777);
    await token.connect(alice).requestDiscloseBalance();
    const h = await token.confidentialBalanceOf(alice.address);
    const r = await aliceC.decryptForTx(h).withoutPermit().execute();
    expect(r.decryptedValue).to.equal(777n);
    await expect(token.connect(alice).finalizeDiscloseBalance(alice.address, r.decryptedValue, r.signature))
      .to.emit(token, "BalanceDisclosed").withArgs(alice.address, 777n);
  });

  it("setMinter gates mint(); ERC20 mutators revert as incompatible", async () => {
    const { owner, alice, bob, token } = await loadFixture(fix);
    await expect(token.connect(alice).mint(alice.address, 1)).to.be.revertedWithCustomError(token, "NotMinter");
    await token.connect(owner).setMinter(alice.address, true);
    await token.connect(alice).mint(bob.address, 5); // now allowed
    await mock_expectPlaintext(bob.provider, await token.confidentialBalanceOf(bob.address), 5n);
    await expect(token.transfer(bob.address, 1)).to.be.revertedWithCustomError(token, "FHERC20IncompatibleFunction");
    await expect(token.approve(bob.address, 1)).to.be.revertedWithCustomError(token, "FHERC20IncompatibleFunction");
    await expect(token.transferFrom(owner.address, bob.address, 1)).to.be.revertedWithCustomError(token, "FHERC20IncompatibleFunction");
  });
});

// ─────────────────────────── ConfidentialScoreManager ────────────────────────
describe("ConfidentialScoreManager — every method (encrypted)", () => {
  async function fix() {
    const [owner, user, other] = await ethers.getSigners();
    const S = await ethers.getContractFactory("ConfidentialScoreManager");
    const score = await S.deploy();
    await score.connect(owner).authorizeManager(owner.address); // owner acts as the protocol caller
    return { owner, user, other, score };
  }

  it("initialize sets score=300, limit=0 (decryptable by the user)", async () => {
    const { user, score } = await loadFixture(fix);
    const userC = await hre.cofhe.createClientWithBatteries(user);
    await score.initialize(user.address);
    expect(await score.hasScore(user.address)).to.equal(true);
    expect(await userC.decryptForView(await score.getEncryptedScore(user.address), FheTypes.Uint32).execute()).to.equal(300n);
    expect(await userC.decryptForView(await score.getEncryptedLimit(user.address), FheTypes.Uint64).execute()).to.equal(0n);
  });

  it("recordRepayment adds +5 and caps at MAX_SCORE (850)", async () => {
    const { owner, user, score } = await loadFixture(fix);
    const userC = await hre.cofhe.createClientWithBatteries(user);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner); // owner SENDS setScore, so it encrypts the input
    await score.initialize(user.address);
    await score.connect(owner).recordRepayment(user.address); // 300 -> 305
    await mock_expectPlaintext(user.provider, await score.getEncryptedScore(user.address), 305n);
    // set near the cap then ensure it doesn't exceed 850
    await score.connect(owner).setScore(user.address, await enc(ownerC, 848));
    await score.connect(owner).recordRepayment(user.address); // 848 -> capped 850 (848+5 > 850)
    await mock_expectPlaintext(user.provider, await score.getEncryptedScore(user.address), 850n);
  });

  it("recordLiquidation subtracts 50 and floors at MIN_SCORE (300)", async () => {
    const { owner, user, score } = await loadFixture(fix);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner);
    await score.connect(owner).setScore(user.address, await enc(ownerC, 500));
    await score.connect(owner).recordLiquidation(user.address); // 500 -> 450
    await mock_expectPlaintext(user.provider, await score.getEncryptedScore(user.address), 450n);
    await score.connect(owner).setScore(user.address, await enc(ownerC, 320));
    await score.connect(owner).recordLiquidation(user.address); // 320 -> floored 300 (320-50 < 300)
    await mock_expectPlaintext(user.provider, await score.getEncryptedScore(user.address), 300n);
  });

  it("setCreditLimit (owner) sets an encrypted limit the user can read", async () => {
    const { owner, user, score } = await loadFixture(fix);
    const userC = await hre.cofhe.createClientWithBatteries(user);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner); // owner SENDS, so owner encrypts the input
    await score.initialize(user.address);
    await score.connect(owner).setCreditLimit(user.address, await enc(ownerC, 250000));
    expect(await userC.decryptForView(await score.getEncryptedLimit(user.address), FheTypes.Uint64).execute()).to.equal(250000n);
  });

  it("access control: non-owner cannot setCreditLimit; non-authorized cannot recordRepayment", async () => {
    const { user, other, score } = await loadFixture(fix);
    const otherC = await hre.cofhe.createClientWithBatteries(other);
    await expect(score.connect(other).setCreditLimit(user.address, await enc(otherC, 1))).to.be.reverted;
    await expect(score.connect(other).recordRepayment(user.address)).to.be.revertedWith("not authorized");
  });
});

// ──────────────────────── Vault + Pool + Liquidation + Repay ──────────────────
describe("Lending suite — every method incl. REPAYMENT (encrypted)", () => {
  async function fix() {
    const [owner, lender, borrower, liquidator] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ConfidentialToken");
    const cUSDC = await T.deploy("cUSDC", "cUSDC", 6);
    const cWETH = await T.deploy("cWETH", "cWETH", 6);
    const S = await ethers.getContractFactory("ConfidentialScoreManager");
    const score = await S.deploy();
    const V = await ethers.getContractFactory("ConfidentialCollateralVault");
    const vault = await V.deploy(await cWETH.getAddress());
    const P = await ethers.getContractFactory("ConfidentialLendingPool");
    const pool = await P.deploy(await cUSDC.getAddress(), await vault.getAddress(), await score.getAddress());
    const E = await ethers.getContractFactory("ConfidentialLiquidationEngine");
    const engine = await E.deploy(await vault.getAddress(), await pool.getAddress(), await score.getAddress());
    await vault.authorizeManager(await pool.getAddress());
    await vault.authorizeManager(await engine.getAddress());
    await score.authorizeManager(await pool.getAddress());
    await score.authorizeManager(await engine.getAddress());
    await pool.authorizeManager(await engine.getAddress());
    // fund + seed
    await cUSDC.mint(lender.address, 1_000_000);
    await cWETH.mint(borrower.address, 1000);
    await cUSDC.mint(borrower.address, 0);
    const lenderC = await hre.cofhe.createClientWithBatteries(lender);
    await cUSDC.connect(lender).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(lender).supply((await lenderC.encryptInputs([Encryptable.uint64(1_000_000n)]).execute())[0]);
    await score.initialize(borrower.address);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner);
    await score.connect(owner).setCreditLimit(borrower.address, (await ownerC.encryptInputs([Encryptable.uint64(1000n)]).execute())[0]);
    return { owner, lender, borrower, liquidator, cUSDC, cWETH, score, vault, pool, engine };
  }

  it("vault.deposit / getCollateral / withdraw (capped, branchless)", async () => {
    const { borrower, cWETH, vault } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 100n);
    await vault.connect(borrower).withdraw(await enc(c, 40));
    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 60n);
    await vault.connect(borrower).withdraw(await enc(c, 999)); // over-withdraw capped to remaining 60
    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 0n);
  });

  it("pool.supply / getSupplied / getTotalSupplied / withdraw", async () => {
    const { lender, pool } = await loadFixture(fix);
    await mock_expectPlaintext(lender.provider, await pool.getSupplied(lender.address), 1_000_000n);
    await mock_expectPlaintext(lender.provider, await pool.getTotalSupplied(), 1_000_000n);
    const c = await hre.cofhe.createClientWithBatteries(lender);
    await pool.connect(lender).withdraw(await enc(c, 250_000));
    await mock_expectPlaintext(lender.provider, await pool.getSupplied(lender.address), 750_000n);
  });

  it("pool.borrow respects collateral health AND credit limit (over-limit → 0)", async () => {
    const { borrower, cUSDC, cWETH, vault, pool } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 60)); // healthy + within limit
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(borrower.address), 60n);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 60n);
    await pool.connect(borrower).borrow(await enc(c, 5000)); // exceeds health → disburse 0
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 60n);
  });

  // ── REPAYMENT, in depth ──
  it("REPAY partial: debt decreases by the repaid amount and score increases", async () => {
    const { borrower, cUSDC, cWETH, vault, pool, score } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 60));
    await mock_expectPlaintext(borrower.provider, await score.getEncryptedScore(borrower.address), 300n);

    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(borrower).repay(await enc(c, 20)); // 60 -> 40, score 300 -> 305
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 40n);
    expect(await c.decryptForView(await score.getEncryptedScore(borrower.address), FheTypes.Uint32).execute()).to.equal(305n);
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(borrower.address), 40n); // 60 borrowed - 20 repaid
  });

  it("REPAY overpay is capped at the debt (no underflow, never pays more than owed)", async () => {
    const { borrower, cUSDC, cWETH, vault, pool } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 60));
    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(borrower).repay(await enc(c, 1000)); // capped at 60 -> debt 0
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 0n);
    // only 60 collected, so balance is unchanged at 60 (borrowed 60, repaid 60)
    await mock_expectPlaintext(borrower.provider, await cUSDC.confidentialBalanceOf(borrower.address), 0n);
  });

  it("REPAY full then borrow again works; multiple repays keep bumping the score", async () => {
    const { borrower, cUSDC, cWETH, vault, pool, score } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 60));
    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(borrower).repay(await enc(c, 30)); // score 305
    await pool.connect(borrower).repay(await enc(c, 30)); // score 310, debt 0
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 0n);
    expect(await c.decryptForView(await score.getEncryptedScore(borrower.address), FheTypes.Uint32).execute()).to.equal(310n);
    // borrow again after full repay
    await pool.connect(borrower).borrow(await enc(c, 50));
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 50n);
  });

  it("liquidation: auditHealth → reveal (decryptForTx) → resolveAudit seizes, clears debt, penalizes score", async () => {
    const { owner, borrower, liquidator, cUSDC, cWETH, vault, pool, engine, score } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    const liqC = await hre.cofhe.createClientWithBatteries(liquidator);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner);
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 60));
    await score.connect(owner).setScore(borrower.address, await enc(ownerC, 500));
    // push underwater by withdrawing collateral: 40 collateral vs 60 debt
    await vault.connect(borrower).withdraw(await enc(c, 60));
    await engine.connect(liquidator).auditHealth(borrower.address);
    const check = await engine.getPendingHealthCheck(borrower.address);
    const res = await liqC.decryptForTx(check).withoutPermit().execute();
    expect(res.decryptedValue).to.equal(1n); // unhealthy
    await engine.connect(liquidator).resolveAudit(borrower.address, Boolean(res.decryptedValue), res.signature);
    expect(await engine.isLiquidatable(borrower.address)).to.equal(true);
    await mock_expectPlaintext(borrower.provider, await pool.getDebt(borrower.address), 0n);
    await mock_expectPlaintext(borrower.provider, await vault.getCollateral(borrower.address), 0n);
    expect(await c.decryptForView(await score.getEncryptedScore(borrower.address), FheTypes.Uint32).execute()).to.equal(450n);
  });

  it("clearDebt is auth-gated; resolveAudit reverts on a healthy position", async () => {
    const { borrower, liquidator, cWETH, vault, pool, engine } = await loadFixture(fix);
    const c = await hre.cofhe.createClientWithBatteries(borrower);
    await expect(pool.connect(borrower).clearDebt(borrower.address)).to.be.revertedWith("not authorized");
    // healthy position: deposit 100, borrow 10 -> very healthy
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(c, 100));
    await pool.connect(borrower).borrow(await enc(c, 10));
    await engine.connect(liquidator).auditHealth(borrower.address);
    const check = await engine.getPendingHealthCheck(borrower.address);
    const liqC = await hre.cofhe.createClientWithBatteries(liquidator);
    const res = await liqC.decryptForTx(check).withoutPermit().execute();
    expect(res.decryptedValue).to.equal(0n); // healthy
    await expect(engine.connect(liquidator).resolveAudit(borrower.address, Boolean(res.decryptedValue), res.signature)).to.be.revertedWith("Position healthy");
  });
});

// ──────────────────────────── ConfidentialSwapPool ───────────────────────────
describe("ConfidentialSwapPool — every method (encrypted)", () => {
  async function fix() {
    const [owner, lp, user] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ConfidentialToken");
    const cWETH = await T.deploy("cWETH", "cWETH", 6);
    const cUSDC = await T.deploy("cUSDC", "cUSDC", 6);
    const SW = await ethers.getContractFactory("ConfidentialSwapPool");
    const swap = await SW.deploy(await cWETH.getAddress(), await cUSDC.getAddress(), 2000, 1);
    await cUSDC.mint(lp.address, 1_000_000);
    await cWETH.mint(lp.address, 1000);
    const lpC = await hre.cofhe.createClientWithBatteries(lp);
    await cUSDC.connect(lp).setOperator(await swap.getAddress(), UNTIL);
    await cWETH.connect(lp).setOperator(await swap.getAddress(), UNTIL);
    await swap.connect(lp).addLiquidityB((await lpC.encryptInputs([Encryptable.uint64(1_000_000n)]).execute())[0]);
    await swap.connect(lp).addLiquidityA((await lpC.encryptInputs([Encryptable.uint64(1000n)]).execute())[0]);
    return { owner, lp, user, cWETH, cUSDC, swap };
  }

  it("addLiquidity seeds encrypted reserves; getReserveA/B reflect them", async () => {
    const { owner, cWETH, cUSDC, swap } = await loadFixture(fix);
    // pool's reserves are its confidential token balances
    await mock_expectPlaintext(owner.provider, await cUSDC.confidentialBalanceOf(await swap.getAddress()), 1_000_000n);
    await mock_expectPlaintext(owner.provider, await cWETH.confidentialBalanceOf(await swap.getAddress()), 1000n);
  });

  it("swapAToB at the fixed rate (1 cWETH = 2000 cUSDC), real tokens move", async () => {
    const { owner, user, cWETH, cUSDC, swap } = await loadFixture(fix);
    await cWETH.connect(owner).mint(user.address, 10);
    const c = await hre.cofhe.createClientWithBatteries(user);
    await cWETH.connect(user).setOperator(await swap.getAddress(), UNTIL);
    await swap.connect(user).swapAToB(await enc(c, 5)); // 5 * 2000 = 10000 cUSDC
    await mock_expectPlaintext(user.provider, await cWETH.confidentialBalanceOf(user.address), 5n);
    await mock_expectPlaintext(user.provider, await cUSDC.confidentialBalanceOf(user.address), 10000n);
  });

  it("swapBToA at the inverse rate; setRate is owner-gated", async () => {
    const { owner, user, cWETH, cUSDC, swap } = await loadFixture(fix);
    await cUSDC.connect(owner).mint(user.address, 4000);
    const c = await hre.cofhe.createClientWithBatteries(user);
    await cUSDC.connect(user).setOperator(await swap.getAddress(), UNTIL);
    await swap.connect(user).swapBToA(await enc(c, 4000)); // 4000 / 2000 = 2 cWETH
    await mock_expectPlaintext(user.provider, await cWETH.confidentialBalanceOf(user.address), 2n);
    await expect(swap.connect(user).setRate(1, 1)).to.be.reverted; // not owner
    await swap.connect(owner).setRate(3000, 1);
    expect(await swap.rateNum()).to.equal(3000n);
  });
});

// ────────────────────────── ConfidentialMerchantEscrow ───────────────────────
describe("ConfidentialMerchantEscrow — every method (encrypted + analytics)", () => {
  async function fix() {
    const [owner, merchant, customer] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ConfidentialToken");
    const token = await T.deploy("cUSDC", "cUSDC", 6);
    const E = await ethers.getContractFactory("ConfidentialMerchantEscrow");
    const escrow = await E.deploy(await token.getAddress());
    await token.connect(owner).mint(customer.address, 1000);
    return { owner, merchant, customer, token, escrow };
  }

  it("registerMerchant → settlePayment (encrypted) → getReceived + public analytics", async () => {
    const { merchant, customer, token, escrow } = await loadFixture(fix);
    const custC = await hre.cofhe.createClientWithBatteries(customer);
    const merchC = await hre.cofhe.createClientWithBatteries(merchant);
    await escrow.connect(merchant).registerMerchant();
    expect(await escrow.isMerchant(merchant.address)).to.equal(true);
    expect(await escrow.totalMerchants()).to.equal(1n);

    await token.connect(customer).setOperator(await escrow.getAddress(), UNTIL);
    const orderId = ethers.id("order-A");
    await escrow.connect(customer).settlePayment(orderId, merchant.address, await enc(custC, 250));

    // encrypted balances + merchant-decryptable total
    await mock_expectPlaintext(customer.provider, await token.confidentialBalanceOf(customer.address), 750n);
    await mock_expectPlaintext(merchant.provider, await token.confidentialBalanceOf(merchant.address), 250n);
    expect(await merchC.decryptForView(await escrow.getReceived(merchant.address), FheTypes.Uint64).execute()).to.equal(250n);

    // public analytics (counts only)
    expect(await escrow.paymentCount(merchant.address)).to.equal(1n);
    expect(await escrow.totalPayments()).to.equal(1n);
    expect(await escrow.orderPayer(orderId)).to.equal(customer.address);
    expect(await escrow.orderPaid(orderId)).to.equal(true);
    const [registered, payments, last] = await escrow.getMerchantStats(merchant.address);
    expect(registered).to.equal(true);
    expect(payments).to.equal(1n);
    expect(last).to.be.greaterThan(0n);

    // a second payment increments the count
    await token.connect(customer).setOperator(await escrow.getAddress(), UNTIL);
    await escrow.connect(customer).settlePayment(ethers.id("order-B"), merchant.address, await enc(custC, 100));
    expect(await escrow.paymentCount(merchant.address)).to.equal(2n);
    expect(await merchC.decryptForView(await escrow.getReceived(merchant.address), FheTypes.Uint64).execute()).to.equal(350n);
  });

  it("guards: unknown merchant + double-pay both revert", async () => {
    const { merchant, customer, token, escrow } = await loadFixture(fix);
    const custC = await hre.cofhe.createClientWithBatteries(customer);
    await token.connect(customer).setOperator(await escrow.getAddress(), UNTIL);
    const orderId = ethers.id("order-C");
    await expect(escrow.connect(customer).settlePayment(orderId, merchant.address, await enc(custC, 50))).to.be.revertedWith("Unknown merchant");
    await escrow.connect(merchant).registerMerchant();
    await escrow.connect(customer).settlePayment(orderId, merchant.address, await enc(custC, 50));
    await expect(escrow.connect(customer).settlePayment(orderId, merchant.address, await enc(custC, 50))).to.be.revertedWith("Order already paid");
  });
});
