import "@fhevm/hardhat-plugin";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as fc from "fast-check";
import hre from "hardhat";

// Typed contract helpers — avoids TypeChain generation requirement
type CollateralVault = {
  getAddress(): Promise<string>;
  waitForDeployment(): Promise<void>;
  connect(signer: any): CollateralVault;
  authorizeContract(addr: string): Promise<any>;
  depositCollateral(handle: any, proof: any): Promise<any>;
  withdrawCollateral(handle: any, proof: any): Promise<any>;
  getCollateralAmount(user: string): Promise<any>;
};

type BorrowManager = {
  getAddress(): Promise<string>;
  waitForDeployment(): Promise<void>;
  connect(signer: any): BorrowManager;
  authorizeContract(addr: string): Promise<any>;
  borrow(handle: any, proof: any): Promise<any>;
  repay(handle: any, proof: any): Promise<any>;
  getDebtAmount(user: string): Promise<any>;
};

type LiquidationEngine = {
  getAddress(): Promise<string>;
  waitForDeployment(): Promise<void>;
  connect(signer: any): LiquidationEngine;
  auditHealth(user: string): Promise<any>;
  resolveAudit(user: string, abiEncoded: any, proof: any): Promise<any>;
  getPendingHealthCheck(user: string): Promise<any>;
  isLiquidatable(user: string): Promise<boolean>;
};

type LendingPool = {
  getAddress(): Promise<string>;
  waitForDeployment(): Promise<void>;
  connect(signer: any): LendingPool;
  supply(handle: any, proof: any): Promise<any>;
  getSuppliedAmount(user: string): Promise<any>;
};

// Feature: fhe-private-lending, Property 1: Collateral deposit round-trip

describe("FHE Private Lending - Property Tests", function () {
  this.timeout(300_000);

  before(async function () {
    if (!hre.fhevm.isMock) {
      this.skip();
    }
  });

  /**
   * Property 1: Collateral Deposit Round-Trip
   * For any valid uint64 amount, depositing then decrypting returns the same amount.
   * Feature: fhe-private-lending, Property 1: Collateral deposit round-trip
   * Validates: Requirements 2.1, 2.3, 8.3
   */
  it("Property 1: Collateral deposit round-trip", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 4_294_967_295n }),
        async (amount) => {
          const user = signers[1];

          const FreshVaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const freshVault = (await FreshVaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await freshVault.waitForDeployment();
          const freshVaultAddress = await freshVault.getAddress();

          const input = hre.fhevm.createEncryptedInput(freshVaultAddress, user.address);
          input.add64(amount);
          const encryptedInput = await input.encrypt();

          const tx = await freshVault.connect(user).depositCollateral(encryptedInput.handles[0], encryptedInput.inputProof);
          await tx.wait();

          const collateralHandle = await freshVault.getCollateralAmount(user.address);
          const decrypted = await hre.fhevm.userDecryptEuint(FhevmType.euint64, collateralHandle, freshVaultAddress, user);

          expect(decrypted).to.equal(amount);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 7: Withdrawal Cap
   * For any deposit D and withdrawal W > D, after withdrawing, balance = 0 (no underflow).
   * Feature: fhe-private-lending, Property 7: Withdrawal cap
   * Validates: Requirements 2.2, 2.5
   */
  it("Property 7: Withdrawal cap - over-withdrawal zeroes the balance without underflow", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 1_000_000n }).chain((deposit) =>
          fc.tuple(
            fc.constant(deposit),
            fc.bigInt({ min: deposit + 1n, max: deposit + 1_000_000n }),
          )
        ),
        async ([deposit, withdrawal]) => {
          const user = signers[8];

          const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const vault = (await VaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await vault.waitForDeployment();
          const vaultAddress = await vault.getAddress();

          const depositInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          depositInput.add64(deposit);
          const encDeposit = await depositInput.encrypt();
          await (await vault.connect(user).depositCollateral(encDeposit.handles[0], encDeposit.inputProof)).wait();

          const withdrawInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          withdrawInput.add64(withdrawal);
          const encWithdraw = await withdrawInput.encrypt();
          await (await vault.connect(user).withdrawCollateral(encWithdraw.handles[0], encWithdraw.inputProof)).wait();

          const handle = await vault.getCollateralAmount(user.address);
          const decrypted = await hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, vaultAddress, user);
          expect(decrypted).to.equal(0n);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 2: Borrow Round-Trip
   * For any healthy (collateral, borrow) pair, borrow then decrypt returns borrow amount.
   * Feature: fhe-private-lending, Property 2: Borrow round-trip
   * Validates: Requirements 3.1, 3.5, 8.4
   */
  it("Property 2: Borrow round-trip", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 1_000n }).chain((borrow) => {
          const minCollateral = (borrow * 150n + 99n) / 100n;
          return fc.tuple(
            fc.bigInt({ min: minCollateral, max: minCollateral + 10_000n }),
            fc.constant(borrow),
          );
        }),
        async ([collateral, borrow]) => {
          const user = signers[2];

          const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const vault = (await VaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await vault.waitForDeployment();
          const vaultAddress = await vault.getAddress();

          const BorrowFactory = await hre.ethers.getContractFactory("PrivateBorrowManager");
          const borrowManager = (await BorrowFactory.connect(user).deploy(vaultAddress)) as unknown as BorrowManager;
          await borrowManager.waitForDeployment();
          const borrowAddress = await borrowManager.getAddress();

          await (await vault.connect(user).authorizeContract(borrowAddress)).wait();

          const collateralInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          collateralInput.add64(collateral);
          const encCollateral = await collateralInput.encrypt();
          await (await vault.connect(user).depositCollateral(encCollateral.handles[0], encCollateral.inputProof)).wait();

          const borrowInput = hre.fhevm.createEncryptedInput(borrowAddress, user.address);
          borrowInput.add64(borrow);
          const encBorrow = await borrowInput.encrypt();
          await (await borrowManager.connect(user).borrow(encBorrow.handles[0], encBorrow.inputProof)).wait();

          const debtHandle = await borrowManager.getDebtAmount(user.address);
          const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);

          expect(decryptedDebt).to.equal(borrow);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 6: Health Factor Enforcement
   * Undercollateralized borrow is silently rejected — debt stays 0.
   * Feature: fhe-private-lending, Property 6: Health factor enforcement
   * Validates: Requirements 3.2, 8.7
   */
  it("Property 6: Health factor enforcement - undercollateralized borrow is silently rejected", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 2n, max: 1_000n }).chain((borrow) => {
          const maxCollateral = (borrow * 150n) / 100n - 1n;
          if (maxCollateral < 1n) return fc.tuple(fc.constant(1n), fc.constant(borrow));
          return fc.tuple(
            fc.bigInt({ min: 1n, max: maxCollateral }),
            fc.constant(borrow),
          );
        }),
        async ([collateral, borrow]) => {
          const user = signers[3];

          const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const vault = (await VaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await vault.waitForDeployment();
          const vaultAddress = await vault.getAddress();

          const BorrowFactory = await hre.ethers.getContractFactory("PrivateBorrowManager");
          const borrowManager = (await BorrowFactory.connect(user).deploy(vaultAddress)) as unknown as BorrowManager;
          await borrowManager.waitForDeployment();
          const borrowAddress = await borrowManager.getAddress();

          await (await vault.connect(user).authorizeContract(borrowAddress)).wait();

          const collateralInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          collateralInput.add64(collateral);
          const encCollateral = await collateralInput.encrypt();
          await (await vault.connect(user).depositCollateral(encCollateral.handles[0], encCollateral.inputProof)).wait();

          const borrowInput = hre.fhevm.createEncryptedInput(borrowAddress, user.address);
          borrowInput.add64(borrow);
          const encBorrow = await borrowInput.encrypt();
          await (await borrowManager.connect(user).borrow(encBorrow.handles[0], encBorrow.inputProof)).wait();

          const debtHandle = await borrowManager.getDebtAmount(user.address);
          const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);

          expect(decryptedDebt).to.equal(0n);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 3: Supply Round-Trip
   * For any uint64 amount, supply then decrypt returns the same amount.
   * Feature: fhe-private-lending, Property 3: Supply round-trip
   * Validates: Requirements 4.1, 4.5, 8.5
   */
  it("Property 3: Supply round-trip", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 4_294_967_295n }),
        async (amount) => {
          const user = signers[5];

          const PoolFactory = await hre.ethers.getContractFactory("PrivateLendingPool");
          const pool = (await PoolFactory.connect(user).deploy()) as unknown as LendingPool;
          await pool.waitForDeployment();
          const poolAddress = await pool.getAddress();

          const input = hre.fhevm.createEncryptedInput(poolAddress, user.address);
          input.add64(amount);
          const encryptedInput = await input.encrypt();

          await (await pool.connect(user).supply(encryptedInput.handles[0], encryptedInput.inputProof)).wait();

          const suppliedHandle = await pool.getSuppliedAmount(user.address);
          const decrypted = await hre.fhevm.userDecryptEuint(FhevmType.euint64, suppliedHandle, poolAddress, user);

          expect(decrypted).to.equal(amount);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 4: Repay Round-Trip
   * After borrow B then repay R (R <= B), debt = B - R.
   * Feature: fhe-private-lending, Property 4: Repay round-trip
   * Validates: Requirements 3.3, 3.5
   */
  it("Property 4: Repay round-trip - after borrow then repay, debt equals borrow minus repay", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 500n }).chain((borrow) => {
          const minCollateral = (borrow * 150n + 99n) / 100n;
          return fc.tuple(
            fc.bigInt({ min: minCollateral, max: minCollateral + 5_000n }),
            fc.constant(borrow),
            fc.bigInt({ min: 0n, max: borrow }),
          );
        }),
        async ([collateral, borrow, repay]) => {
          const user = signers[4];

          const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const vault = (await VaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await vault.waitForDeployment();
          const vaultAddress = await vault.getAddress();

          const BorrowFactory = await hre.ethers.getContractFactory("PrivateBorrowManager");
          const borrowManager = (await BorrowFactory.connect(user).deploy(vaultAddress)) as unknown as BorrowManager;
          await borrowManager.waitForDeployment();
          const borrowAddress = await borrowManager.getAddress();

          await (await vault.connect(user).authorizeContract(borrowAddress)).wait();

          const collateralInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          collateralInput.add64(collateral);
          const encCollateral = await collateralInput.encrypt();
          await (await vault.connect(user).depositCollateral(encCollateral.handles[0], encCollateral.inputProof)).wait();

          const borrowInput = hre.fhevm.createEncryptedInput(borrowAddress, user.address);
          borrowInput.add64(borrow);
          const encBorrow = await borrowInput.encrypt();
          await (await borrowManager.connect(user).borrow(encBorrow.handles[0], encBorrow.inputProof)).wait();

          const repayInput = hre.fhevm.createEncryptedInput(borrowAddress, user.address);
          repayInput.add64(repay);
          const encRepay = await repayInput.encrypt();
          await (await borrowManager.connect(user).repay(encRepay.handles[0], encRepay.inputProof)).wait();

          const debtHandle = await borrowManager.getDebtAmount(user.address);
          const decryptedDebt = await hre.fhevm.userDecryptEuint(FhevmType.euint64, debtHandle, borrowAddress, user);

          expect(decryptedDebt).to.equal(borrow - repay);
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  /**
   * Property 5: Liquidation Correctness
   * Undercollateralized position is marked liquidatable after audit+resolve.
   * Feature: fhe-private-lending, Property 5: Liquidation correctness
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4
   */
  it("Property 5: Liquidation correctness - undercollateralized position is marked liquidatable", async function () {
    const signers = await hre.ethers.getSigners();

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 2n, max: 500n }).chain((debt) => {
          const maxCollateral = (debt * 125n) / 100n - 1n;
          if (maxCollateral < 1n) return fc.tuple(fc.constant(1n), fc.constant(debt));
          return fc.tuple(
            fc.bigInt({ min: 1n, max: maxCollateral }),
            fc.constant(debt),
          );
        }),
        async ([collateral, debt]) => {
          const user = signers[6];
          const liquidator = signers[7];

          const VaultFactory = await hre.ethers.getContractFactory("PrivateCollateralVault");
          const vault = (await VaultFactory.connect(user).deploy()) as unknown as CollateralVault;
          await vault.waitForDeployment();
          const vaultAddress = await vault.getAddress();

          const BorrowFactory = await hre.ethers.getContractFactory("PrivateBorrowManager");
          const borrowManager = (await BorrowFactory.connect(user).deploy(vaultAddress)) as unknown as BorrowManager;
          await borrowManager.waitForDeployment();
          const borrowAddress = await borrowManager.getAddress();

          const LiqFactory = await hre.ethers.getContractFactory("PrivateLiquidationEngine");
          const liqEngine = (await LiqFactory.connect(user).deploy(vaultAddress, borrowAddress)) as unknown as LiquidationEngine;
          await liqEngine.waitForDeployment();
          const liqAddress = await liqEngine.getAddress();

          await (await vault.connect(user).authorizeContract(borrowAddress)).wait();
          await (await vault.connect(user).authorizeContract(liqAddress)).wait();
          await (await borrowManager.connect(user).authorizeContract(liqAddress)).wait();

          const minCollateralForBorrow = (debt * 150n + 99n) / 100n;

          const depositInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
          depositInput.add64(minCollateralForBorrow);
          const encDeposit = await depositInput.encrypt();
          await (await vault.connect(user).depositCollateral(encDeposit.handles[0], encDeposit.inputProof)).wait();

          const borrowInput = hre.fhevm.createEncryptedInput(borrowAddress, user.address);
          borrowInput.add64(debt);
          const encBorrow = await borrowInput.encrypt();
          await (await borrowManager.connect(user).borrow(encBorrow.handles[0], encBorrow.inputProof)).wait();

          const withdrawAmt = minCollateralForBorrow - collateral;
          if (withdrawAmt > 0n) {
            const withdrawInput = hre.fhevm.createEncryptedInput(vaultAddress, user.address);
            withdrawInput.add64(withdrawAmt);
            const encWithdraw = await withdrawInput.encrypt();
            await (await vault.connect(user).withdrawCollateral(encWithdraw.handles[0], encWithdraw.inputProof)).wait();
          }

          await (await liqEngine.connect(liquidator).auditHealth(user.address)).wait();

          const pendingHandle = await liqEngine.getPendingHealthCheck(user.address);
          const handleHex = ethers.toBeHex(ethers.toBigInt(pendingHandle), 32);
          const publicDecryptResult = await hre.fhevm.publicDecrypt([handleHex]);

          await (await liqEngine.connect(liquidator).resolveAudit(
            user.address,
            publicDecryptResult.abiEncodedClearValues,
            publicDecryptResult.decryptionProof,
          )).wait();

          const liquidatable = await liqEngine.isLiquidatable(user.address);
          expect(liquidatable).to.equal(true);
        },
      ),
      { numRuns: 5, verbose: true },
    );
  });
});
