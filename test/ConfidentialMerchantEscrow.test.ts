import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

const OPERATOR_UNTIL = 4_000_000_000;

describe("ConfidentialMerchantEscrow (private payments)", function () {
  async function deploy() {
    const [owner, merchant, customer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ConfidentialToken");
    const token = await Token.deploy("Confidential USDC", "cUSDC", 6);
    const Escrow = await ethers.getContractFactory("ConfidentialMerchantEscrow");
    const escrow = await Escrow.deploy(await token.getAddress());
    await token.connect(owner).mint(customer.address, 1000);
    return { owner, merchant, customer, token, escrow };
  }

  it("settles an order with an encrypted amount, paying the merchant privately", async () => {
    const { merchant, customer, token, escrow } = await loadFixture(deploy);
    const customerClient = await hre.cofhe.createClientWithBatteries(customer);
    const merchantClient = await hre.cofhe.createClientWithBatteries(merchant);

    await escrow.connect(merchant).registerMerchant();
    await token.connect(customer).setOperator(await escrow.getAddress(), OPERATOR_UNTIL);

    const orderId = ethers.id("order-001");
    const [enc] = await customerClient.encryptInputs([Encryptable.uint64(250n)]).execute();
    await escrow.connect(customer).settlePayment(orderId, merchant.address, enc);

    // Balances moved privately.
    await mock_expectPlaintext(customer.provider, await token.confidentialBalanceOf(customer.address), 750n);
    await mock_expectPlaintext(merchant.provider, await token.confidentialBalanceOf(merchant.address), 250n);

    // Merchant can decrypt their own lifetime total; the amount never appeared in plaintext.
    const total = await merchantClient
      .decryptForView(await escrow.getReceived(merchant.address), FheTypes.Uint64)
      .execute();
    expect(total).to.equal(250n);

    expect(await escrow.orderPaid(orderId)).to.equal(true);

    // Public analytics (counts only — amounts stay encrypted).
    expect(await escrow.paymentCount(merchant.address)).to.equal(1n);
    expect(await escrow.totalPayments()).to.equal(1n);
    expect(await escrow.orderPayer(orderId)).to.equal(customer.address);
    const [registered, payments, lastPayment] = await escrow.getMerchantStats(merchant.address);
    expect(registered).to.equal(true);
    expect(payments).to.equal(1n);
    expect(lastPayment).to.be.greaterThan(0n);
  });

  it("rejects double payment and unknown merchants", async () => {
    const { merchant, customer, token, escrow } = await loadFixture(deploy);
    const customerClient = await hre.cofhe.createClientWithBatteries(customer);
    await token.connect(customer).setOperator(await escrow.getAddress(), OPERATOR_UNTIL);

    const orderId = ethers.id("order-002");
    const [enc1] = await customerClient.encryptInputs([Encryptable.uint64(100n)]).execute();
    // Unknown merchant (not registered).
    await expect(escrow.connect(customer).settlePayment(orderId, merchant.address, enc1)).to.be.revertedWith(
      "Unknown merchant"
    );

    await escrow.connect(merchant).registerMerchant();
    const [enc2] = await customerClient.encryptInputs([Encryptable.uint64(100n)]).execute();
    await escrow.connect(customer).settlePayment(orderId, merchant.address, enc2);

    const [enc3] = await customerClient.encryptInputs([Encryptable.uint64(100n)]).execute();
    await expect(escrow.connect(customer).settlePayment(orderId, merchant.address, enc3)).to.be.revertedWith(
      "Order already paid"
    );
  });
});
