const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const address = "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B";

    console.log(`Getting nonce and balance for: ${address}`);
    const balance = await provider.getBalance(address);
    const nonce = await provider.getTransactionCount(address);

    console.log(`Balance: ${ethers.formatEther(balance)} tCTC`);
    console.log(`Nonce (Txs sent): ${nonce}`);

    const block = await provider.getBlockNumber();
    console.log(`Current Hub Block: ${block}`);

    // We can iterate back and check blocks, but that's slow.
    // Let's check the last 5000 blocks for ANY log from this address.
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";
    const prover = new ethers.Contract(proverAddress, [
        "event QuerySubmitted(bytes32 indexed queryId, address indexed principal, uint256 cost)",
        "function getQueryDetails(bytes32 queryId) view returns (uint8 state, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) query, uint256 escrowedAmount, address principal, uint256 estimatedCost, uint256 timestamp, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments)"
    ], provider);

    const filter = prover.filters.QuerySubmitted(null, address);
    console.log("Searching for logs...");
    const events = await prover.queryFilter(filter, block - 10000, block);

    console.log(`Found ${events.length} submission events for this user.`);
    for (const event of events) {
        const details = await prover.getQueryDetails(event.args.queryId);
        console.log(`- QueryId: ${event.args.queryId}`);
        console.log(`  Status:  ${details.state} (0=Pending, 1=Verified, 2=Processed, 3=Failed)`);
        console.log(`  Time:    ${new Date(Number(details.timestamp) * 1000).toLocaleString()}`);
    }
}

main().catch(console.error);
