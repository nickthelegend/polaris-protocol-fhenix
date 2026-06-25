import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";

/**
 * Narrated walk-through of the exact flows you asked about — deposit, borrow, and a repayment
 * that raises the encrypted credit score. Every value below is decrypted live via the SDK and
 * printed, so you can SEE it work end to end.
 *
 *   npx hardhat test test/ConfidentialDemo.test.ts
 */
const UNTIL = 4_000_000_000;

describe("DEMO — deposit, borrow, repay → credit score increases", () => {
  async function fix() {
    const [owner, lender, borrower] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ConfidentialToken");
    const cUSDC = await T.deploy("cUSDC", "cUSDC", 6);
    const cWETH = await T.deploy("cWETH", "cWETH", 6);
    const S = await ethers.getContractFactory("ConfidentialScoreManager");
    const score = await S.deploy();
    const V = await ethers.getContractFactory("ConfidentialCollateralVault");
    const vault = await V.deploy(await cWETH.getAddress());
    const P = await ethers.getContractFactory("ConfidentialLendingPool");
    const pool = await P.deploy(await cUSDC.getAddress(), await vault.getAddress(), await score.getAddress());
    await vault.authorizeManager(await pool.getAddress());
    await score.authorizeManager(await pool.getAddress());
    return { owner, lender, borrower, cUSDC, cWETH, score, vault, pool };
  }

  it("works end to end", async () => {
    const { owner, lender, borrower, cUSDC, cWETH, score, vault, pool } = await loadFixture(fix);
    const ownerC = await hre.cofhe.createClientWithBatteries(owner);
    const lenderC = await hre.cofhe.createClientWithBatteries(lender);
    const bC = await hre.cofhe.createClientWithBatteries(borrower);
    const enc = async (c: any, v: number) => (await c.encryptInputs([Encryptable.uint64(BigInt(v))]).execute())[0];
    const dec = async (c: any, handle: string, t: any = FheTypes.Uint64) => Number(await c.decryptForView(handle, t).execute());

    const log = (s: string) => console.log("    " + s);

    // Setup: lender seeds liquidity, owner gives the borrower a credit limit of 1000.
    await cUSDC.mint(lender.address, 1_000_000);
    await cWETH.mint(borrower.address, 1000);
    await cUSDC.connect(lender).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(lender).supply(await enc(lenderC, 1_000_000));
    await score.initialize(borrower.address);
    await score.connect(owner).setCreditLimit(borrower.address, await enc(ownerC, 1000));
    log(`Setup: pool seeded with 1,000,000 cUSDC; borrower credit limit = 1000; borrower has 1000 cWETH`);

    // 1) DEPOSIT collateral
    await cWETH.connect(borrower).setOperator(await vault.getAddress(), UNTIL);
    await vault.connect(borrower).deposit(await enc(bC, 100));
    const collateral = await dec(bC, await vault.getCollateral(borrower.address));
    log(`[1] DEPOSIT 100 cWETH → decrypted collateral = ${collateral}`);
    expect(collateral).to.equal(100);

    // 2) BORROW (health: collateral*100=10000 >= debt*150=9000 ✓ AND debt<=limit ✓)
    await pool.connect(borrower).borrow(await enc(bC, 60));
    const debt1 = await dec(bC, await pool.getDebt(borrower.address));
    const bal1 = await dec(bC, await cUSDC.confidentialBalanceOf(borrower.address));
    log(`[2] BORROW 60 cUSDC → decrypted debt = ${debt1}, received cUSDC balance = ${bal1}`);
    expect(debt1).to.equal(60);
    expect(bal1).to.equal(60);

    // credit score before repay
    const scoreBefore = await dec(bC, await score.getEncryptedScore(borrower.address), FheTypes.Uint32);
    log(`[3] Credit score BEFORE repay = ${scoreBefore}`);
    expect(scoreBefore).to.equal(300);

    // 3) REPAY → debt down, score up
    await cUSDC.connect(borrower).setOperator(await pool.getAddress(), UNTIL);
    await pool.connect(borrower).repay(await enc(bC, 20));
    const debt2 = await dec(bC, await pool.getDebt(borrower.address));
    const scoreAfter = await dec(bC, await score.getEncryptedScore(borrower.address), FheTypes.Uint32);
    log(`[4] REPAY 20 cUSDC → decrypted debt = ${debt2}; credit score AFTER repay = ${scoreAfter}  (was ${scoreBefore})`);
    expect(debt2).to.equal(40);
    expect(scoreAfter).to.equal(305); // +5

    log(`✅ Deposit, borrow, and repay-raises-score all verified with live decryption.`);
  });
});
