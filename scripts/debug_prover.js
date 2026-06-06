const { ethers } = require("ethers");

async function main() {
    const provider = new ethers.JsonRpcProvider("https://rpc.usc-testnet.creditcoin.network");
    const proverAddress = "0xc43402c66e88f38a5aa6e35113b310e1c19571d4";

    const block = await provider.getBlockNumber();
    console.log(`Current Block on USC: ${block}`);

    const prover = new ethers.Contract(proverAddress, [
        "event QuerySubmitted(bytes32 indexed queryId, address indexed principal, uint256 cost)"
    ], provider);

    // Check very recent events (last 100)
    console.log(`Searching from ${block - 500} to ${block}`);
    const events = await prover.queryFilter(prover.filters.QuerySubmitted(), block - 500, block);
    console.log(`Found ${events.length} QuerySubmitted events.`);

    // Also check if QueryProofVerified exists
    const prover2 = new ethers.Contract(proverAddress, [
        "event QueryProofVerified(bytes32 indexed queryId, uint8 state)"
    ], provider);
    const events2 = await prover2.queryFilter(prover2.filters.QueryProofVerified(), block - 500, block);
    console.log(`Found ${events2.length} QueryProofVerified events.`);
}

main().catch(console.error);
