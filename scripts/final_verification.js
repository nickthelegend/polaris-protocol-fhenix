const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";
    const queryId = "0x93afc4ccdc4acd6b7a9c602b9abc67dd596d0e0e26a057c93831b34194466810";

    const prover = new ethers.Contract(proverAddress, [
        "function getQueryDetails(bytes32 queryId) view returns (uint8 state, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) query, uint256 escrowedAmount, address principal, uint256 estimatedCost, uint256 timestamp, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments)"
    ], provider);

    console.log(`Checking Query State for ID: ${queryId}`);
    const details = await prover.getQueryDetails(queryId);

    console.log(`\n--- FINAL ORACLE PROOF STATUS ---`);
    console.log(`QueryId:   ${queryId}`);
    console.log(`Principal: ${details.principal}`);
    console.log(`State:     ${details.state} (0=Pending, 1=Verified, 2=Processed, 3=Failed)`);
    console.log(`Timestamp: ${new Date(Number(details.timestamp) * 1000).toLocaleString()}`);

    if (details.state == 2) {
        console.log(`\n✅ VERIFICATION COMPLETE!`);
        console.log(`The proof has been verified by the Creditcoin Oracle nodes.`);
        console.log(`You can now call SYNC_PROOF in the Polaris UI with this QueryId.`);
    } else {
        console.log(`\n⏳ Status is still ${details.state}. Please wait a few more minutes.`);
    }
}

main().catch(console.error);
