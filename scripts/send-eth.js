const { ethers } = require("hardhat");
async function main() {
  const [sender] = await ethers.getSigners();
  const tx = await sender.sendTransaction({
    to: "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B",
    value: ethers.parseEther("10")
  });
  await tx.wait();
  console.log("Sent 10 ETH, tx:", tx.hash);
}
main().catch(console.error);
