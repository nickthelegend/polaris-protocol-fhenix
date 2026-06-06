import "@fhevm/hardhat-plugin";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";

/**
 * Unit tests for FHE Private Lending contracts.
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
describe("FHE Private Lending - Unit Tests", function () {
  this.timeout(300_000);

  // Shared fixture state
  let vault: any;
  let borrowManager: any;
  let lendingPool: any;
  let liqEngine: any;
  let vaultAddress: string;
  let borrowAddress: string;
  let poolAddress: string;
  let liqAddress: string;
  let owner: any;
  let user: any;
  let liquidator: any;

  before(async function () {
    // Requirement 8.2: skip if not in mock mode
    if (!hre.fhevm.isMock) {
      this.skip();
    }
  });

  // Requirement 8.1: Deploy all 4 contracts
  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner = signers[0];
    user = signers[1];
    liquidator = signers[2];

    const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
    vault = await VaultFactory.connect(owner).deploy();
    await vault.waitForDeployment();
    vaultAddress = await vault.getAddress();

    const BorrowFactory = await hre.ethers.getContractFactory("PrivateBorrowManager");
    borrowManager = await BorrowFactory.connect(owner).deploy(vaultAddress);
    await borrowManager.waitForDeployment();
    borrowAddress = await borrowManager.getAddress();

    const PoolFactory = await hre.ethers.getContractFactory("PrivateLendingPool");
    lendingPool = await PoolFactory.connect(owner).deploy();
    await lendingPool.waitForDeployment();
    poolAddress = await lendingPool.getAddress();

    const LiqFactory = await hre.ethers.getContractFactory("PrivateLiquidationEngine");
    liqEngine = await LiqFactory.connect(owner).deploy(vaultAddress, borrowAddress);
    await liqEngine.waitForDeployment();
    liqAddress = await liqEngine.getAddress();

    // Authorize borrow manager to read collateral handles
    await (await vault.connect(owner).authorizeContract(borrowAddress)).wait();
    // Authorize liquidation engine to read collateral and debt handles
    await (await vault.connect(owner).authorizeContract(liqAddress)).wait();
    await (await borrowManager.connect(owner).authorizeContract(liqAddress)).wait();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function encryptForVault(amount: bigint, signer: any) {
    const input = hre.fhevm.createEncryptedInput(vaultAddress, signer.address);
    input.add64(amount);
    return input.encrypt();
  }

  async function encryptForBorrow(amount: bigint, signer: any) {
    const input = hre.fhevm.createEncryptedInput(borrowAddress, signer.address);
    input.add64(amount);
    return input.encrypt();
  }

  async function encryptForPool(amount: bigint, signer: any) {
    const input = hre.fhevm.createEncryptedInput(poolAddress, signer.address);
    input.add64(amount);
    return input.encrypt();
  }

  async function depositCollateral(amount: bigint, signer: any) {
    const enc = await encryptForVault(amount, signer);
    await (await vault.connect(signer).depositCollateral(enc.handles[0], enc.inputProof)).wait();
  }

  async function borrowAmount(amount: bigint, signer: any) {
    const enc = await encryptForBorrow(amount, signer);
    await (await borrowManager.connect(signer).borrow(enc.handles[0], enc.inputProof)).wait();
  }

  // ─── Tests ──────────────────────────────────────────────────────────────────

  /**
   * Requirement 8.3: After depositCollateral, user-decryption returns deposited amount.
   */
  it("should deposit collateral and decrypt to the correct value", async function () {
    const amount = 1_000n;
    await depositCollateral(amount, user);

    const handle = await vault.getCollateralAmount(user.address);
    const decrypted = await hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, vaultAddress, user);
    expect(decrypted).to.equal(amount);
  });

  /**
   * Requirement 8.4: After borrow with sufficient collateral, debt handle decrypts to borrowed amount.
   */
  it("should borrow with sufficient collateral and decrypt debt to borrowed amount", async function () {
    const collateral = 1_500n; // 1.5x of 1000
    const borrow = 1_000n;

    await depositCollateral(collateral, user);
    await borrowAmount(borrow, user);

    const debtHandle = await borrowManager.getDebtAmount(user.address);
    const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);
    expect(decryptedDebt).to.equal(borrow);
  });

  /**
   * Requirement 8.7: When borrow exceeds collateral ratio, debt handle stays unchanged (branchless rejection).
   */
  it("should reject undercollateralized borrow — debt stays 0", async function () {
    const collateral = 100n;
    const borrow = 1_000n; // requires 1500 collateral, only 100 deposited

    await depositCollateral(collateral, user);
    await borrowAmount(borrow, user);

    const debtHandle = await borrowManager.getDebtAmount(user.address);
    const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);
    expect(decryptedDebt).to.equal(0n);
  });

  /**
   * Requirement 8.4 (repay): After repaying full debt, debt handle decrypts to 0.
   */
  it("should repay full debt and decrypt debt to 0", async function () {
    const collateral = 1_500n;
    const borrow = 1_000n;

    await depositCollateral(collateral, user);
    await borrowAmount(borrow, user);

    // Repay full amount
    const repayEnc = await encryptForBorrow(borrow, user);
    await (await borrowManager.connect(user).repay(repayEnc.handles[0], repayEnc.inputProof)).wait();

    const debtHandle = await borrowManager.getDebtAmount(user.address);
    const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);
    expect(decryptedDebt).to.equal(0n);
  });

  /**
   * Requirement 8.5: After supply, supplied balance handle decrypts to supplied amount.
   */
  it("should supply liquidity and decrypt supplied balance to correct value", async function () {
    const amount = 5_000n;
    const enc = await encryptForPool(amount, user);
    await (await lendingPool.connect(user).supply(enc.handles[0], enc.inputProof)).wait();

    const suppliedHandle = await lendingPool.getSuppliedAmount(user.address);
    const decrypted = await hre.fhevm.userDecryptEuint(FhevmType.euint64, suppliedHandle, poolAddress, user);
    expect(decrypted).to.equal(amount);
  });

  /**
   * Requirement 8.6: auditHealth + resolveAudit correctly identifies undercollateralized position.
   */
  it("should mark undercollateralized position as liquidatable after auditHealth + resolveAudit", async function () {
    // Create undercollateralized position:
    // Deposit enough to borrow 1000 (needs 1500), borrow 1000, then withdraw down to 100
    const initialCollateral = 1_500n;
    const borrowAmt = 1_000n;
    const withdrawAmt = 1_400n; // leaves 100 collateral, which is < 1000 * 1.25 = 1250

    await depositCollateral(initialCollateral, user);
    await borrowAmount(borrowAmt, user);

    // Withdraw most collateral to make position undercollateralized
    const withdrawEnc = await encryptForVault(withdrawAmt, user);
    await (await vault.connect(user).withdrawCollateral(withdrawEnc.handles[0], withdrawEnc.inputProof)).wait();

    // Audit health
    await (await liqEngine.connect(liquidator).auditHealth(user.address)).wait();

    // Get pending handle and perform public decryption
    const pendingHandle = await liqEngine.getPendingHealthCheck(user.address);
    const handleHex = ethers.toBeHex(ethers.toBigInt(pendingHandle), 32);
    const publicDecryptResult = await hre.fhevm.publicDecrypt([handleHex]);

    // Resolve audit
    await (await liqEngine.connect(liquidator).resolveAudit(
      user.address,
      publicDecryptResult.abiEncodedClearValues,
      publicDecryptResult.decryptionProof,
    )).wait();

    expect(await liqEngine.isLiquidatable(user.address)).to.equal(true);
  });

  /**
   * Requirement 8.6 (healthy revert): resolveAudit reverts for a healthy position.
   */
  it("should revert resolveAudit for a healthy position", async function () {
    // Healthy position: 1500 collateral, 1000 debt → collateral * 100 = 150000 >= debt * 125 = 125000
    const collateral = 1_500n;
    const borrow = 1_000n;

    await depositCollateral(collateral, user);
    await borrowAmount(borrow, user);

    // Audit health (position is healthy)
    await (await liqEngine.connect(liquidator).auditHealth(user.address)).wait();

    const pendingHandle = await liqEngine.getPendingHealthCheck(user.address);
    const handleHex = ethers.toBeHex(ethers.toBigInt(pendingHandle), 32);
    const publicDecryptResult = await hre.fhevm.publicDecrypt([handleHex]);

    // resolveAudit should revert because isUnhealthy = false
    await expect(
      liqEngine.connect(liquidator).resolveAudit(
        user.address,
        publicDecryptResult.abiEncodedClearValues,
        publicDecryptResult.decryptionProof,
      )
    ).to.be.revertedWith("User is healthy, cannot liquidate");
  });
});
