import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { mock_expectPlaintext } from "@cofhe/hardhat-plugin";

const OPERATOR_UNTIL = 4_000_000_000;

describe("ConfidentialSwapPool (private fixed-rate swaps)", function () {
  async function deploy() {
    const [owner, lp, user] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ConfidentialToken");
    const cWETH = await Token.deploy("Confidential WETH", "cWETH", 6); // tokenA
    const cUSDC = await Token.deploy("Confidential USDC", "cUSDC", 6); // tokenB

    // 1 cWETH = 2000 cUSDC
    const Pool = await ethers.getContractFactory("ConfidentialSwapPool");
    const pool = await Pool.deploy(await cWETH.getAddress(), await cUSDC.getAddress(), 2000, 1);

    // Seed the pool with cUSDC liquidity from the LP.
    await cUSDC.connect(owner).mint(lp.address, 100000);
    await cUSDC.connect(lp).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    const lpClient = await hre.cofhe.createClientWithBatteries(lp);
    const [encLiq] = await lpClient.encryptInputs([Encryptable.uint64(100000n)]).execute();
    await pool.connect(lp).addLiquidityB(encLiq);

    // Give the user some cWETH to swap.
    await cWETH.connect(owner).mint(user.address, 10);

    return { owner, lp, user, cWETH, cUSDC, pool };
  }

  it("swaps cWETH -> cUSDC privately at the fixed rate, moving real tokens", async () => {
    const { user, cWETH, cUSDC, pool } = await loadFixture(deploy);
    const userClient = await hre.cofhe.createClientWithBatteries(user);

    await cWETH.connect(user).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    const [encIn] = await userClient.encryptInputs([Encryptable.uint64(5n)]).execute();
    await pool.connect(user).swapAToB(encIn);

    // User spent 5 cWETH, received 5 * 2000 = 10000 cUSDC.
    await mock_expectPlaintext(user.provider, await cWETH.confidentialBalanceOf(user.address), 5n);
    await mock_expectPlaintext(user.provider, await cUSDC.confidentialBalanceOf(user.address), 10000n);

    // Pool now holds 5 cWETH and 90000 cUSDC (100000 - 10000).
    await mock_expectPlaintext(user.provider, await cWETH.confidentialBalanceOf(await pool.getAddress()), 5n);
    await mock_expectPlaintext(user.provider, await cUSDC.confidentialBalanceOf(await pool.getAddress()), 90000n);

    // The user can decrypt their own received balance via the SDK.
    const got = await userClient
      .decryptForView(await cUSDC.confidentialBalanceOf(user.address), FheTypes.Uint64)
      .execute();
    expect(got).to.equal(10000n);
  });

  it("swaps back cUSDC -> cWETH at the inverse rate", async () => {
    const { owner, user, cWETH, cUSDC, pool } = await loadFixture(deploy);
    const userClient = await hre.cofhe.createClientWithBatteries(user);

    // Seed the pool with cWETH liquidity too so it can pay out A.
    await cWETH.connect(owner).mint(owner.address, 100);
    await cWETH.connect(owner).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const [encLiqA] = await ownerClient.encryptInputs([Encryptable.uint64(100n)]).execute();
    await pool.connect(owner).addLiquidityA(encLiqA);

    // Give the user cUSDC and swap 4000 -> 2 cWETH (4000 * 1/2000).
    await cUSDC.connect(owner).mint(user.address, 4000);
    await cUSDC.connect(user).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
    const [encIn] = await userClient.encryptInputs([Encryptable.uint64(4000n)]).execute();
    await pool.connect(user).swapBToA(encIn);

    await mock_expectPlaintext(user.provider, await cUSDC.confidentialBalanceOf(user.address), 0n);
    // User had 10 cWETH from the fixture + 2 received from the swap = 12.
    await mock_expectPlaintext(user.provider, await cWETH.confidentialBalanceOf(user.address), 12n);
  });
});
