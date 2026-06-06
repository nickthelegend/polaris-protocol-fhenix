const hre = require("hardhat");

const ADDRESSES = {
    poolManager: "0xe799b8f0A37786aa77b7540E5123E4FC103a3661",
    loanEngine: "0x47F90ca038a1fdAA370eD8C8221F874270F4b54E",
    scoreManager: "0x224c0D64c04c0DBEb1aA6D8103f06a7911a89cd9",
    user: "0xcCED528A5b70e16c8131Cb2de424564dD938fD3B"
};

async function main() {
    const loanEngine = await hre.ethers.getContractAt("LoanEngine", ADDRESSES.loanEngine);

    console.log("Checking Loan 0 status...");
    try {
        const loan = await loanEngine.loans(0);
        console.log("Loan 0:", {
            borrower: loan.borrower,
            principal: loan.principal.toString(),
            repaid: loan.repaid.toString(),
            status: loan.status.toString(),
            poolToken: loan.poolToken
        });

        console.log("User active debt:", (await loanEngine.userActiveDebt(ADDRESSES.user)).toString());

        const count = await loanEngine.loanCount();
        console.log("Total loan count:", count.toString());

    } catch (e) {
        console.error("Error checking loans:", e.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
