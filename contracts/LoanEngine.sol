// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ScoreManager.sol";
import "./PoolManager.sol";
import "./interfaces/INativeQueryVerifier.sol";
import "./interfaces/EvmV1Decoder.sol";
import "./ProtocolFunds.sol";
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {FhenixEthereumConfig} from "@fhevm/solidity/config/FhenixConfig.sol";

contract LoanEngine is Ownable, ReentrancyGuard, FhenixEthereumConfig {
    ScoreManager public scoreManager;
    PoolManager public poolManager;
    ProtocolFunds public protocolFunds;
    INativeQueryVerifier public immutable VERIFIER;
    
    uint256 public constant INTEREST_RATE_BPS = 1000; // 10% APR
    uint256 public constant PROTOCOL_FEE_BPS = 2000; // 20% of interest goes to protocol
    
    bytes32 public constant REPAY_EVENT_SIGNATURE = 0x040cee90ee4799897c30ca04e5feb6fa43dbba9b6d084b4b257cdafd84ba013e;

    enum LoanStatus { Active, Repaid, Defaulted }
    struct Loan { 
        address borrower; 
        euint64 principal; 
        euint64 interestAmount;
        euint64 repaid; 
        uint256 startTime; 
        uint256[] dueDates; 
        LoanStatus status; 
        address poolToken; 
    }
    
    mapping(uint256 => Loan) public loans;
    // user => debt (Encrypted)
    mapping(address => euint64) private userActiveDebt;
    mapping(bytes32 => bool) public processedQueries;
    uint256 public loanCount;

    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest);
    event RepaymentMade(uint256 indexed loanId, uint256 amount);
    event LoanDefaulted(uint256 indexed loanId);
    event LoanFullyRepaid(uint256 indexed loanId);

    constructor(address _scoreManager, address _poolManager, address _verifier, address _protocolFunds) Ownable(msg.sender) {
        scoreManager = ScoreManager(_scoreManager);
        poolManager = PoolManager(_poolManager);
        protocolFunds = ProtocolFunds(_protocolFunds);
        if (_verifier == address(0)) {
            VERIFIER = NativeQueryVerifierLib.getVerifier();
        } else {
            VERIFIER = INativeQueryVerifier(_verifier);
        }
    }

    function createLoan(address user, externalEuint64 amount, bytes calldata inputProof, address poolToken) external {
        euint64 principal = FHE.fromExternal(amount, inputProof);
        euint32 score = scoreManager.getScore(user);
        euint64 limit = scoreManager.getCreditLimit(user);
        euint64 currentDebt = userActiveDebt[user];
        
        ebool isWithinLimit = FHE.le(FHE.add(currentDebt, principal), limit);
        // If over limit, we effectively create a 0 principal loan (since we lack FHE.req)
        euint64 actualPrincipal = FHE.select(isWithinLimit, principal, FHE.asEuint64(0));
        
        // Calculate 56-day interest: interest = actualPrincipal * rate * time / (10000 * 365)
        euint64 interest = FHE.div(FHE.mul(actualPrincipal, uint64(56000)), uint64(3650000));
        
        uint256[] memory dueDates = new uint256[](4);
        dueDates[0] = block.timestamp + 14 days;
        dueDates[1] = block.timestamp + 28 days;
        dueDates[2] = block.timestamp + 42 days;
        dueDates[3] = block.timestamp + 56 days;

        loans[loanCount] = Loan({ 
            borrower: user, 
            principal: actualPrincipal, 
            interestAmount: interest,
            repaid: FHE.asEuint64(0), 
            startTime: block.timestamp, 
            dueDates: dueDates, 
            status: LoanStatus.Active, 
            poolToken: poolToken 
        });
        
        userActiveDebt[user] = FHE.add(currentDebt, actualPrincipal);
        
        // Access control for the user to see their loan data
        FHE.allow(loans[loanCount].principal, user);
        FHE.allow(loans[loanCount].interestAmount, user);
        FHE.allow(loans[loanCount].repaid, user);
        FHE.allow(userActiveDebt[user], user);
        
        // Allow this contract to use the handles later
        FHE.allowThis(loans[loanCount].principal);
        FHE.allowThis(loans[loanCount].interestAmount);
        FHE.allowThis(loans[loanCount].repaid);
        FHE.allowThis(userActiveDebt[user]);

        emit LoanCreated(loanCount, user, 0, 0); // Principal/Interest are private
        loanCount++;
    }

    function repayFromProof(
        uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction,
        bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
    ) external nonReentrant {
        (bool isNotReplay, bytes32 txKey) = _checkForReplay(chainKey, blockHeight, siblings);
        require(isNotReplay, "Processed");

        require(VERIFIER.verifyAndEmit(
            chainKey, blockHeight, encodedTransaction,
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots})
        ), "Native failed");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Failed on source");

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, REPAY_EVENT_SIGNATURE);
        require(logs.length > 0, "No Repayment events");

        for (uint i = 0; i < logs.length; i++) {
            require(logs[i].topics.length == 2, "Invalid topics");
            uint256 loanId = uint256(logs[i].topics[1]);
            uint256 amount = abi.decode(logs[i].data, (uint256));
            _applyRepayment(loanId, FHE.asEuint64(uint64(amount)));
        }
        processedQueries[txKey] = true;
    }

    function _applyRepayment(uint256 loanId, euint64 amount) internal {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        
        euint64 totalDebt = FHE.add(loan.principal, loan.interestAmount);
        euint64 remainingToRepay = FHE.sub(totalDebt, loan.repaid);
        
        ebool isOverpaying = FHE.gt(amount, remainingToRepay);
        euint64 effectiveAmount = FHE.select(isOverpaying, remainingToRepay, amount);
        
        loan.repaid = FHE.add(loan.repaid, effectiveAmount);
        FHE.allow(loan.repaid, loan.borrower);
        FHE.allowThis(loan.repaid);
        
        // Handle Interest Distribution (Encrypted)
        ebool hasPaidPrincipal = FHE.gt(loan.repaid, loan.principal);
        euint64 excessOverPrincipal = FHE.sub(loan.repaid, loan.principal);
        euint64 interestPaid = FHE.select(hasPaidPrincipal, FHE.select(FHE.gt(excessOverPrincipal, effectiveAmount), effectiveAmount, excessOverPrincipal), FHE.asEuint64(0));

        // Distribution logic using encrypted arithmetic
        euint64 protocolFee = FHE.div(FHE.mul(interestPaid, uint64(PROTOCOL_FEE_BPS)), uint64(10000));
        euint64 lenderYield = FHE.sub(interestPaid, protocolFee);
        
        FHE.allow(protocolFee, address(protocolFunds));
        FHE.allow(lenderYield, address(poolManager));
        
        protocolFunds.deposit(loan.poolToken, protocolFee);
        poolManager.distributeInterest(loan.poolToken, lenderYield);

        // Record repayment in score manager (Encrypted)
        FHE.allow(effectiveAmount, address(scoreManager));
        scoreManager.recordRepayment(loan.borrower, effectiveAmount);
        
        ebool isFullyRepaid = FHE.ge(loan.repaid, totalDebt);
        FHE.allowThis(isFullyRepaid);
        // Status change must be audited via auditRepayment (Step 1)
        
        emit RepaymentMade(loanId, 0); // Amount 0 indicates encrypted repayment
    }

    /**
     * @notice Audit a loan to see if it's fully repaid (Step 1)
     */
    function auditRepayment(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        
        euint64 totalDebt = FHE.add(loan.principal, loan.interestAmount);
        ebool isFullyRepaid = FHE.ge(loan.repaid, totalDebt);
        
        FHE.allowThis(isFullyRepaid);
        FHE.makePubliclyDecryptable(isFullyRepaid);
    }

    /**
     * @notice Finalize repayment audit (Step 2)
     */
    function finalizeRepaymentAudit(
        uint256 loanId,
        bytes memory abiEncodedClearResult,
        bytes memory decryptionProof
    ) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        
        euint64 totalDebt = FHE.add(loan.principal, loan.interestAmount);
        ebool isFullyRepaidEnc = FHE.ge(loan.repaid, totalDebt);
        
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(isFullyRepaidEnc);
        
        FHE.checkSignatures(handles, abiEncodedClearResult, decryptionProof);

        bool isFullyRepaid = abi.decode(abiEncodedClearResult, (bool));
        require(isFullyRepaid, "Not fully repaid");

        loan.status = LoanStatus.Repaid;
        userActiveDebt[loan.borrower] = FHE.sub(userActiveDebt[loan.borrower], loan.principal);
        FHE.allow(userActiveDebt[loan.borrower], loan.borrower);
        FHE.allowThis(userActiveDebt[loan.borrower]);
        
        emit LoanFullyRepaid(loanId);
    }

    function _checkForReplay(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProofEntry[] memory siblings) 
        internal view returns (bool, bytes32 txKey) 
    {
        uint256 transactionIndex = NativeQueryVerifierLib._calculateTransactionIndex(siblings);
        txKey = keccak256(abi.encodePacked(chainKey, blockHeight, transactionIndex));
        return (!processedQueries[txKey], txKey);
    }

    function liquidate(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        require(block.timestamp > loan.dueDates[3], "Not overdue");
        
        loan.status = LoanStatus.Defaulted;
        scoreManager.updateScore(loan.borrower, -50, "Defaulted Loan");
        
        euint64 outstanding = FHE.sub(loan.principal, loan.repaid);
        FHE.allow(outstanding, address(poolManager));
        poolManager.slashLiquidity(loan.borrower, loan.poolToken, outstanding);
        
        userActiveDebt[loan.borrower] = FHE.sub(userActiveDebt[loan.borrower], loan.principal);
        FHE.allow(userActiveDebt[loan.borrower], loan.borrower);
        FHE.allowThis(userActiveDebt[loan.borrower]);
        
        emit LoanDefaulted(loanId);
    }

    function repay(uint256 loanId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "Only borrower");
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _applyRepayment(loanId, amount);
    }

    function getUserActiveDebt(address user) external view returns (euint64) {
        return userActiveDebt[user];
    }

    function getLoanStatus(uint256 loanId) external view returns (LoanStatus) {
        return loans[loanId].status;
    }

    function getLoanBorrower(uint256 loanId) external view returns (address) {
        return loans[loanId].borrower;
    }
}

