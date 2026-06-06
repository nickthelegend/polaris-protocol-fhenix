const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const txHash = "0xbd4e9591e17f93056b1fbcac24615f3e";

    console.log(`Checking transaction: ${txHash}`);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
        console.log("Transaction receipt not found. It might be further back in history or on a different chain.");
        return;
    }

    console.log(`Transaction found in block: ${receipt.blockNumber}`);

    const proverInterface = new ethers.Interface([
        "event QuerySubmitted(bytes32 indexed queryId, address indexed principal, uint256 cost)"
    ]);

    for (const log of receipt.logs) {
        try {
            const parsed = proverInterface.parseLog(log);
            if (parsed.name === "QuerySubmitted") {
                console.log(`\n--- PROOF SUBMITTED ---`);
                console.log(`QueryId: ${parsed.args.queryId}`);
                console.log(`Principal: ${parsed.args.principal}`);

                // Now check the status of this specific query
                const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";
                const prover = new ethers.Contract(proverAddress, [
                    "function getQueryDetails(bytes32 queryId) view returns (uint8 state, tuple(uint64 chainId, uint64 height, uint64 index, tuple(uint64 offset, uint64 size)[] layoutSegments) query, uint256 escrowedAmount, address principal, uint256 estimatedCost, uint256 timestamp, tuple(uint256 offset, bytes32 abiBytes)[] resultSegments)"
                ], provider);

                const details = await prover.getQueryDetails(parsed.args.queryId);
                console.log(`State: ${details.state} (0=Pending, 1=Verified, 2=Processed, 3=Failed)`);
                console.log(`Timestamp: ${new Date(Number(details.timestamp) * 1000).toLocaleString()}`);
            }
        } catch (e) {
            // Not a QuerySubmitted log
        }
    }
}

main().catch(console.error);
