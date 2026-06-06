const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";

    const prover = new ethers.Contract(proverAddress, [
        "event QuerySubmitted(bytes32 indexed queryId, address indexed principal, uint256 cost)",
        "function getQueryDetails(bytes32 queryId) view returns (uint8 state, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) query, uint256 escrowedAmount, address principal, uint256 estimatedCost, uint256 timestamp, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments)"
    ], provider);

    console.log("Searching for ALL recent QuerySubmitted events (last 5000 blocks)...");
    const filter = prover.filters.QuerySubmitted();
    const currentBlock = await provider.getBlockNumber();
    const events = await prover.queryFilter(filter, currentBlock - 5000, currentBlock);

    console.log(`Found ${events.length} events.`);

    for (const event of events) {
        const queryId = event.args.queryId;
        const details = await prover.getQueryDetails(queryId);

        console.log(`\n--- Oracle Proof Status ---`);
        console.log(`QueryId:   ${queryId}`);
        console.log(`Principal: ${event.args.principal}`);
        console.log(`State:     ${details.state} (0=Pending, 1=Verified, 2=Processed, 3=Failed)`);
        console.log(`Timestamp: ${new Date(Number(details.timestamp) * 1000).toLocaleString()}`);

        if (details.state == 2) {
            console.log(`✅ VERIFICATION COMPLETE: Ready for Hub synchronization.`);
        } else {
            console.log(`⏳ IN PROGRESS: Still waiting for block finality.`);
        }
    }
}

main().catch(console.error);
