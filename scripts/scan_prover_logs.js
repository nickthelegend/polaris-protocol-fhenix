const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";

    const block = await provider.getBlockNumber();
    console.log(`Searching Prover @ ${proverAddress} from block ${block - 2000} to ${block}`);

    // Get all logs for the contract
    const logs = await provider.getLogs({
        address: proverAddress,
        fromBlock: block - 2000,
        toBlock: block
    });

    console.log(`Found ${logs.length} logs in total.`);

    const iface = new ethers.Interface([
        "event QuerySubmitted(bytes32 indexed queryId, uint256 estimatedCost, uint256 escrowedAmount, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) chainQuery)",
        "event QueryProofVerified(bytes32 indexed queryId, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments, uint8 state)"
    ]);

    for (const log of logs) {
        try {
            const parsed = iface.parseLog(log);
            console.log(`\n[${parsed.name}] at block ${log.blockNumber}`);
            console.log(`- QueryId: ${parsed.args.queryId}`);
            if (parsed.name === "QueryProofVerified") {
                console.log(`- State: ${parsed.args.state}`);
            }
        } catch (e) {
            // Unrecognized event
        }
    }
}

main().catch(console.error);
