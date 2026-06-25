import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

/**
 * Demonstrates the full encryption AND decryption round-trip through the SDK:
 *   encrypt (client) -> store on-chain (euint64) -> decryptForView with a permit.
 * Plus the deny-path: a non-owner of a handle cannot decrypt it.
 */
describe("Confidential encryption / decryption round-trip", function () {
  async function deployToken() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ConfidentialToken");
    const token = await Token.deploy("Confidential USDC", "cUSDC", 6);
    const Score = await ethers.getContractFactory("ConfidentialScoreManager");
    const score = await Score.deploy();
    return { owner, alice, bob, token, score };
  }

  const OPERATOR_UNTIL = 4_000_000_000;

  it("encrypts a balance and lets ONLY the owner decrypt it via permit", async () => {
    const { owner, alice, bob, token } = await loadFixture(deployToken);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);

    // Faucet mint 500 to Alice.
    await token.connect(owner).mint(alice.address, 500);

    const balHandle = await token.confidentialBalanceOf(alice.address);

    // (a) Mock-level plaintext assertion (state check).
    await mock_expectPlaintext(alice.provider, balHandle, 500n);

    // (b) Real SDK decryption with Alice's permit — proves the decryption path works.
    const aliceView = await aliceClient.decryptForView(balHandle, FheTypes.Uint64).execute();
    expect(aliceView).to.equal(500n);

    // (c) Deny path: Bob is not in the ACL for Alice's balance handle → decryption denied.
    await expect(bobClient.decryptForView(balHandle, FheTypes.Uint64).execute()).to.be.rejected;
  });

  it("keeps amounts encrypted across a confidential transfer (both parties decrypt their own)", async () => {
    const { owner, alice, bob, token } = await loadFixture(deployToken);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);

    await token.connect(owner).mint(alice.address, 500);

    // Alice confidentially sends 120 to Bob (amount never appears in plaintext calldata).
    const [enc] = await aliceClient.encryptInputs([Encryptable.uint64(120n)]).execute();
    await token.connect(alice)["confidentialTransfer(address,(uint256,uint8,uint8,bytes))"](bob.address, enc);

    const aliceBal = await aliceClient
      .decryptForView(await token.confidentialBalanceOf(alice.address), FheTypes.Uint64)
      .execute();
    const bobBal = await bobClient
      .decryptForView(await token.confidentialBalanceOf(bob.address), FheTypes.Uint64)
      .execute();

    expect(aliceBal).to.equal(380n);
    expect(bobBal).to.equal(120n);
  });

  it("encrypts a credit score that only the user can read", async () => {
    const { owner, alice, bob, score } = await loadFixture(deployToken);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);

    await score.connect(owner).authorizeManager(owner.address);
    await score.initialize(alice.address);
    await score.connect(owner).recordRepayment(alice.address); // 300 -> 305

    const scoreHandle = await score.getEncryptedScore(alice.address);
    const aliceScore = await aliceClient.decryptForView(scoreHandle, FheTypes.Uint32).execute();
    expect(aliceScore).to.equal(305n);

    // Bob cannot read Alice's score.
    await expect(bobClient.decryptForView(scoreHandle, FheTypes.Uint32).execute()).to.be.rejected;
  });

  it("supports opt-in public disclosure of one's own balance (decryptForTx reveal)", async () => {
    const { owner, alice, token } = await loadFixture(deployToken);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);

    await token.connect(owner).mint(alice.address, 777);

    // Alice opts to make her balance publicly decryptable.
    await token.connect(alice).requestDiscloseBalance();
    const balHandle = await token.confidentialBalanceOf(alice.address);

    const res = await aliceClient.decryptForTx(balHandle).withoutPermit().execute();
    expect(res.decryptedValue).to.equal(777n);

    // Finalize the disclosure on-chain with the MPC proof.
    await expect(token.connect(alice).finalizeDiscloseBalance(alice.address, res.decryptedValue, res.signature))
      .to.emit(token, "BalanceDisclosed")
      .withArgs(alice.address, 777n);
  });
});
