const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";
    const principal = "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B";

    const prover = new ethers.Contract(proverAddress, [
        "event QuerySubmitted(bytes32 indexed queryId, address indexed principal, uint256 cost)",
        "function getQueryDetails(bytes32 queryId) view returns (uint8 state, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) query, uint256 escrowedAmount, address principal, uint256 estimatedCost, uint256 timestamp, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments)"
    ], provider);

    console.log(`Checking for ALL recent queries on Prover (last 20000 blocks)`);
    const events = await prover.queryFilter(prover.filters.QuerySubmitted(), -20000);

    if (events.length === 0) {
        console.log("No recent queries found.");
        return;
    }

    for (const event of events) {
        const queryId = event.args.queryId;
        const details = await prover.getQueryDetails(queryId);

        console.log(`\n- QueryId: ${queryId}`);
        console.log(`  Status: ${details.state} (0=Pending, 1=Verified, 2=Processed, 3=Failed)`);
        console.log(`  Submitted: ${new Date(Number(details.timestamp) * 1000).toLocaleString()}`);

        if (details.state == 2) {
            console.log(`  ✅ DATA IS READY FOR BRIDGE SYNC`);
        } else if (details.state == 0 || details.state == 1) {
            console.log(`  ⏳ Oracle is still verifying. Expected wait: ~15 mins.`);
        }
    }
}

main().catch(console.error);
