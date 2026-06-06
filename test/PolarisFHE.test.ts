import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

type HardhatEthersSigner = any;

async function encryptAmount(contractAddress: string, signer: HardhatEthersSigner, amount: bigint) {
    const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    return { handle: encrypted.handles[0], proof: encrypted.inputProof };
}

describe("Polaris FHE Full Protocol Flow", function () {
    let poolManager: any, loanEngine: any, scoreManager: any, merchantRouter: any, creditOracle: any, protocolFunds: any;
    let owner: HardhatEthersSigner, alice: HardhatEthersSigner, bob: HardhatEthersSigner, attester: HardhatEthersSigner, merchant: HardhatEthersSigner;
    let mockVerifier: any;

    before(async function () {
        [owner, alice, bob, attester, merchant] = await ethers.getSigners();

        // 1. Deploy Mocks & Infrastructure
        const MockVerifier = await ethers.getContractFactory("MockNativeQueryVerifier");
        mockVerifier = await MockVerifier.deploy();
        await mockVerifier.waitForDeployment();

        // 2. Deploy Core Contracts
        const PoolManager = await ethers.getContractFactory("PoolManager");
        poolManager = await PoolManager.deploy(await mockVerifier.getAddress());
        await poolManager.waitForDeployment();

        const CreditOracle = await ethers.getContractFactory("CreditOracle");
        creditOracle = await CreditOracle.deploy(attester.address);
        await creditOracle.waitForDeployment();

        const ScoreManager = await ethers.getContractFactory("ScoreManager");
        scoreManager = await ScoreManager.deploy(await poolManager.getAddress(), await creditOracle.getAddress());
        await scoreManager.waitForDeployment();

        const ProtocolFunds = await ethers.getContractFactory("ProtocolFunds");
        protocolFunds = await ProtocolFunds.deploy();
        await protocolFunds.waitForDeployment();

        const LoanEngine = await ethers.getContractFactory("LoanEngine");
        loanEngine = await LoanEngine.deploy(
            await scoreManager.getAddress(),
            await poolManager.getAddress(),
            await mockVerifier.getAddress(),
            await protocolFunds.getAddress()
        );
        await loanEngine.waitForDeployment();

        const MerchantRouter = await ethers.getContractFactory("MerchantRouter");
        merchantRouter = await MerchantRouter.deploy(await poolManager.getAddress(), await loanEngine.getAddress());
        await merchantRouter.waitForDeployment();

        // 3. Wiring
        await (await poolManager.setLoanEngine(await loanEngine.getAddress())).wait();
        await (await scoreManager.transferOwnership(await loanEngine.getAddress())).wait(); // LoanEngine needs to update scores
        await (await protocolFunds.setLoanEngine(await loanEngine.getAddress())).wait();
        
        // Mock Token Whitelisting
        const mockToken = "0x0000000000000000000000000000000000000001";
        await (await poolManager.setWhitelistedToken(mockToken, true)).wait();
    });

    it("should allow Alice to establish a credit profile via Oracle", async function () {
        const collateralAmt = 2000n;
        const debtAmt = 500n;
        
        const encCollateral = await encryptAmount(await creditOracle.getAddress(), alice, collateralAmt);
        const encDebt = await encryptAmount(await creditOracle.getAddress(), alice, debtAmt);
        
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = 0;
        
        // Sign the attestation (Mocking the signature logic for test)
        const messageHash = ethers.solidityPackedKeccak256(
            ["address", "bytes32", "bytes32", "uint256", "uint256"],
            [alice.address, encCollateral.handle, encDebt.handle, timestamp, nonce]
        );
        const signature = await attester.signMessage(ethers.toBeArray(messageHash));

        await (await creditOracle.connect(owner).updateProfile(
            alice.address,
            encCollateral.handle,
            encCollateral.proof,
            encDebt.handle,
            encDebt.proof,
            timestamp,
            signature
        )).wait();
        
        // Credit limit check is internal to ScoreManager, we verify it doesn't revert
        const limit = await scoreManager.getCreditLimit(alice.address);
        expect(limit).to.not.be.undefined;
    });

    it("should allow Alice to pay Merchant via MerchantRouter", async function () {
        const payAmt = 100n;
        const mockToken = "0x0000000000000000000000000000000000000001";
        const enc = await encryptAmount(await merchantRouter.getAddress(), alice, payAmt);
        
        // Initial setup for PoolManager (Alice needs some collateral or limit needs to be high enough)
        // In our case, Alice has external collateral in Oracle, so her limit > 0
        
        await (await merchantRouter.connect(alice).payWithCredit(
            merchant.address,
            mockToken,
            enc.handle,
            enc.proof
        )).wait();
        
        const mBalance = await merchantRouter.getMerchantBalance(merchant.address, mockToken);
        expect(mBalance).to.not.be.undefined;
    });

    it("should allow Merchant to withdraw funds", async function () {
        const withdrawAmt = 50n;
        const mockToken = "0x0000000000000000000000000000000000000001";
        const enc = await encryptAmount(await merchantRouter.getAddress(), merchant, withdrawAmt);
        
        // First we need to make sure PoolManager has liquidity (mocked)
        // For hackathon completeness, we bypass the Proof check by just updating state or assuming verifier mock returns true
        
        await expect(merchantRouter.connect(merchant).merchantWithdraw(
            mockToken,
            enc.handle,
            enc.proof,
            1 // destChainId
        )).to.not.be.reverted;
    });
});
