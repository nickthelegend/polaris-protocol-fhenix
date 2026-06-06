import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

describe("Confidential Collateral Vault Tests", function () {
  async function deployVaultFixture() {
    const [owner, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PrivateCollateralVault");
    const vault = await Factory.deploy();
    return { vault, owner, bob };
  }

  it("Should allow Bob to deposit and withdraw collateral privately using CoFHE", async function () {
    const { vault, owner, bob } = await loadFixture(deployVaultFixture);

    // Initialize Fhenix client for Bob
    const client = await hre.cofhe.createClientWithBatteries(bob);

    // Encrypt deposit amount of 1000 tokens
    const [encDeposit] = await client
      .encryptInputs([Encryptable.uint64(1000n)])
      .execute();

    // Bob deposits the collateral
    await vault.connect(bob).deposit(encDeposit);

    // Retrieve the encrypted balance handle from the vault contract
    const handle = await vault.getCollateralAmount(bob.address);

    // Assert the plaintext value using the mock helper from @cofhe/hardhat-plugin
    await mock_expectPlaintext(bob.provider, handle, 1000n);

    // Encrypt withdrawal amount of 400 tokens
    const [encWithdraw] = await client
      .encryptInputs([Encryptable.uint64(400n)])
      .execute();

    // Bob withdraws a portion of the collateral
    await vault.connect(bob).withdraw(encWithdraw);

    // Retrieve the updated encrypted balance handle
    const updatedHandle = await vault.getCollateralAmount(bob.address);

    // Assert the new remaining plaintext value is correct (1000 - 400 = 600)
    await mock_expectPlaintext(bob.provider, updatedHandle, 600n);
  });
});
