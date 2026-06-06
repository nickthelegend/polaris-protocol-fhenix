const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const addressesPath = path.join(__dirname, "../addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    const network = hre.network.name;

    const { usdc, usdt, ctc } = addresses[network];
    const targetUser = "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B";

    console.log(`Minting tokens to ${targetUser} on ${network}...`);

    const usdcContract = await hre.ethers.getContractAt("MockERC20", usdc);
    const usdtContract = await hre.ethers.getContractAt("MockERC20", usdt);
    const ctcContract = await hre.ethers.getContractAt("MockERC20", ctc);

    const amount = hre.ethers.parseUnits("10000", 18);

    await (await usdcContract.mint(targetUser, amount)).wait();
    await (await usdtContract.mint(targetUser, amount)).wait();
    await (await ctcContract.mint(targetUser, amount)).wait();

    console.log("SUCCESS: 10,000 USDC, USDT, and CTC minted to user.");
}

main().catch(console.error);
