// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/INativeQueryVerifier.sol";
import "./interfaces/EvmV1Decoder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract PoolManager is Ownable, ReentrancyGuard {
    INativeQueryVerifier public immutable VERIFIER;
    address public loanEngine;
    bytes32 public constant TRANSFER_EVENT_SIGNATURE = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    struct Pool { 
        uint64 totalLiquidity; 
        uint64 totalShares;
        address tokenOnSource; 
        bool isInitialized;
    }
    
    mapping(address => Pool) public pools;
    // user => token => shares (Encrypted)
    mapping(address => mapping(address => euint64)) private lpShares;
    mapping(bytes32 => bool) public processedQueries;
    
    // Mapping of ChainID => TokenAddress => IsWhitelisted
    mapping(uint64 => mapping(address => bool)) public whitelistedSourceTokens;
    // Mapping of ChainID => LiquidityVaultAddress
    mapping(uint64 => address) public sourceVaults;
    
    address[] public whitelistedTokens;
    mapping(address => bool) public isTokenWhitelisted;
    uint256 public withdrawalNonce;

    struct PendingWithdrawal {
        euint64 amount;
        address tokenOnSource;
        uint64 destChainId;
        bool active;
    }
    mapping(uint256 => PendingWithdrawal) public pendingWithdrawals;

    event LiquidityAdded(address indexed user, address indexed tokenOnSource, uint256 amount);
    event LiquidityWithdrawn(address indexed user, address indexed tokenOnSource, uint256 amount);
    event WithdrawalAuthorized(address indexed user, address indexed tokenOnSource, uint256 amount, uint256 nonce, uint64 destChainId);
    event LiquiditySlashed(address indexed user, address indexed token, uint256 amount);
    event SourceChainConfigured(uint64 indexed chainId, address indexed vault, address indexed token, bool status);
    event TokenWhitelisted(address indexed token, bool status);
    event WithdrawalRequested(address indexed user, bytes32 handle, uint256 nonce);
    event WithdrawalFinalized(address indexed user, uint256 amount);

    constructor(address _verifier) Ownable(msg.sender) {
        if (_verifier == address(0)) {
            VERIFIER = NativeQueryVerifierLib.getVerifier();
        } else {
            VERIFIER = INativeQueryVerifier(_verifier);
        }
    }

    function setLoanEngine(address _loanEngine) external onlyOwner {
        loanEngine = _loanEngine;
    }

    function setWhitelistedToken(address token, bool status) external onlyOwner {
        if (status && !isTokenWhitelisted[token]) whitelistedTokens.push(token);
        isTokenWhitelisted[token] = status;
        emit TokenWhitelisted(token, status);
    }

    function setSourceParams(uint64 chainId, address vault, address token, bool status) external onlyOwner {
        sourceVaults[chainId] = vault;
        whitelistedSourceTokens[chainId][token] = status;
        emit SourceChainConfigured(chainId, vault, token, status);
    }

    /**
     * @dev Supply liquidity to the pool (Encrypted).
     */
    function supply(address token, InEuint64 calldata encryptedAmount, uint64 clearAmount) public {
        euint64 amount = FHE.asEuint64(encryptedAmount);
        
        Pool storage pool = pools[token];
        if (!pool.isInitialized) {
            pool.isInitialized = true;
            pool.tokenOnSource = token;
            if (!isTokenWhitelisted[token]) {
                whitelistedTokens.push(token);
                isTokenWhitelisted[token] = true;
            }
        }

        if (FHE.isInitialized(lpShares[msg.sender][token])) {
            lpShares[msg.sender][token] = FHE.add(lpShares[msg.sender][token], amount);
        } else {
            lpShares[msg.sender][token] = amount;
        }
        
        // Update hybrid public state
        pools[token].totalLiquidity += clearAmount;
        pools[token].totalShares += clearAmount;
        
        FHE.allow(lpShares[msg.sender][token], msg.sender);
        FHE.allowThis(lpShares[msg.sender][token]);
        
        emit LiquidityAdded(msg.sender, token, clearAmount);
    }

    // Alias supply to support single-arg calls from the frontend hook
    function supply(InEuint64 calldata encryptedAmount) external {
        address token = whitelistedTokens.length > 0 ? whitelistedTokens[0] : address(0);
        supply(token, encryptedAmount, 0);
    }

    function addLiquidityFromProof(
        uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction,
        bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
    ) external nonReentrant {
        (bool isNotReplay, bytes32 txKey) = _checkForReplay(chainKey, blockHeight, siblings);
        require(isNotReplay, "Transaction already processed");

        require(VERIFIER.verifyAndEmit(
            chainKey, blockHeight, encodedTransaction,
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots})
        ), "Native verification failed");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction failed on source chain");

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, TRANSFER_EVENT_SIGNATURE);
        require(logs.length > 0, "No Transfer events found");

        bool processed = false;
        address trustedVault = sourceVaults[chainKey];
        require(trustedVault != address(0), "Source chain not configured");

        for (uint i = 0; i < logs.length; i++) {
            address tokenAddress = logs[i].address_;
            
            if (whitelistedSourceTokens[chainKey][tokenAddress]) {
                require(logs[i].topics.length == 3, "Invalid topics");
                address lender = address(uint160(uint256(logs[i].topics[1])));
                address toAddr = address(uint160(uint256(logs[i].topics[2])));
                
                if (toAddr == trustedVault) {
                    uint256 amount = abi.decode(logs[i].data, (uint256));
                    uint64 vAmount = uint64(amount);
                    
                    Pool storage pool = pools[tokenAddress];
                    uint64 sharesToMint;
                    
                    if (!pool.isInitialized) {
                        sharesToMint = vAmount;
                        pool.totalLiquidity = vAmount;
                        pool.totalShares = vAmount;
                        pool.isInitialized = true;
                    } else {
                        sharesToMint = uint64((uint256(vAmount) * pool.totalShares) / pool.totalLiquidity);
                        pool.totalLiquidity += vAmount;
                        pool.totalShares += sharesToMint;
                    }
                    
                    pool.tokenOnSource = tokenAddress;
                    
                    euint64 vSharesToMint = FHE.asEuint64(sharesToMint);
                    if (FHE.isInitialized(lpShares[lender][tokenAddress])) {
                        lpShares[lender][tokenAddress] = FHE.add(lpShares[lender][tokenAddress], vSharesToMint);
                    } else {
                        lpShares[lender][tokenAddress] = vSharesToMint;
                    }

                    FHE.allow(lpShares[lender][tokenAddress], lender);
                    FHE.allowThis(lpShares[lender][tokenAddress]);
                    
                    processed = true;
                    emit LiquidityAdded(lender, tokenAddress, amount);
                    break;
                }
            }
        }
        require(processed, "No valid deposit to LiquidityVault found");
        processedQueries[txKey] = true;
    }

    function _checkForReplay(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProofEntry[] memory siblings) 
        internal view returns (bool, bytes32 txKey) 
    {
        uint256 transactionIndex = NativeQueryVerifierLib._calculateTransactionIndex(siblings);
        txKey = keccak256(abi.encodePacked(chainKey, blockHeight, transactionIndex));
        return (!processedQueries[txKey], txKey);
    }

    function getUserTotalCollateral(address user) public returns (euint64) {
        euint64 total = FHE.asEuint64(0);
        for (uint256 i = 0; i < whitelistedTokens.length; i++) {
            address token = whitelistedTokens[i];
            if (isTokenWhitelisted[token]) {
                total = FHE.add(total, getAssetBalance(user, token));
            }
        }
        FHE.allow(total, msg.sender);
        FHE.allowThis(total);
        return total;
    }

    function getAssetBalance(address user, address token) public returns (euint64) {
        Pool storage pool = pools[token];
        if (!pool.isInitialized || pool.totalShares == 0) return FHE.asEuint64(0);
        
        euint64 balance = FHE.div(FHE.mul(lpShares[user][token], FHE.asEuint64(pool.totalLiquidity)), FHE.asEuint64(pool.totalShares));
        FHE.allow(balance, msg.sender);
        FHE.allowThis(balance);
        return balance;
    }

    function getLpShares(address user, address token) external view returns (euint64) {
        return lpShares[user][token];
    }

    function requestWithdrawal(address tokenOnSource, InEuint64 calldata encryptedAmount, uint64 destChainId) external nonReentrant {
        Pool storage pool = pools[tokenOnSource];
        require(pool.isInitialized, "Pool not found");
        
        euint64 amount = FHE.asEuint64(encryptedAmount);
        euint64 userBalance = getAssetBalance(msg.sender, tokenOnSource);
        
        ebool hasBalance = FHE.gte(userBalance, amount);
        euint64 actualWithdrawAmount = FHE.select(hasBalance, amount, userBalance);

        // sharesToBurn = (actualWithdrawAmount * pool.totalShares) / pool.totalLiquidity
        euint64 sharesToBurn = FHE.div(FHE.mul(actualWithdrawAmount, FHE.asEuint64(pool.totalShares)), FHE.asEuint64(pool.totalLiquidity));
        
        lpShares[msg.sender][tokenOnSource] = FHE.sub(lpShares[msg.sender][tokenOnSource], sharesToBurn);
        FHE.allow(lpShares[msg.sender][tokenOnSource], msg.sender);
        FHE.allowThis(lpShares[msg.sender][tokenOnSource]);
        
        uint256 nonce = withdrawalNonce++;
        pendingWithdrawals[nonce] = PendingWithdrawal({
            amount: actualWithdrawAmount,
            tokenOnSource: tokenOnSource,
            destChainId: destChainId,
            active: true
        });

        FHE.allowThis(actualWithdrawAmount);
        FHE.allowPublic(actualWithdrawAmount);
        
        emit WithdrawalAuthorized(msg.sender, tokenOnSource, 0, nonce, destChainId);
        emit WithdrawalRequested(msg.sender, euint64.unwrap(actualWithdrawAmount), nonce);
    }

    function finalizeWithdrawal(
        uint256 nonce,
        uint64 clearAmount,
        bytes calldata signature
    ) external nonReentrant {
        PendingWithdrawal storage pw = pendingWithdrawals[nonce];
        require(pw.active, "Not active");

        FHE.publishDecryptResult(pw.amount, clearAmount, signature);

        pw.active = false;

        // Update public totals AFTER reveal
        Pool storage pool = pools[pw.tokenOnSource];
        uint64 sharesToBurn = uint64((uint256(clearAmount) * pool.totalShares) / pool.totalLiquidity);
        pool.totalShares -= sharesToBurn;
        pool.totalLiquidity -= clearAmount;

        emit LiquidityWithdrawn(msg.sender, pw.tokenOnSource, uint256(clearAmount));
        emit WithdrawalFinalized(msg.sender, uint256(clearAmount));
    }

    function slashLiquidity(address user, address token, euint64 amount) external {
        require(msg.sender == loanEngine, "Only LoanEngine");
        Pool storage pool = pools[token];
        require(pool.isInitialized, "Pool not found");

        euint64 userShares = lpShares[user][token];
        euint64 sharesToBurn = FHE.div(FHE.mul(amount, FHE.asEuint64(pool.totalShares)), FHE.asEuint64(pool.totalLiquidity));
        
        ebool hasShares = FHE.gte(userShares, sharesToBurn);
        euint64 actualSharesToBurn = FHE.select(hasShares, sharesToBurn, userShares);
        
        lpShares[user][token] = FHE.sub(userShares, actualSharesToBurn);
        FHE.allow(lpShares[user][token], user);
        FHE.allowThis(lpShares[user][token]);

        emit LiquiditySlashed(user, token, 0); 
    }

    function distributeInterest(address token, euint64 amount) external {
        require(msg.sender == loanEngine, "Only LoanEngine");
        // For hackathon, we skip public total update on encrypted interest
    }

    function getPoolLiquidity(address token) external view returns (uint64) {
        return pools[token].totalLiquidity;
    }
}
