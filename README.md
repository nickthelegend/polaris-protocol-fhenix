# ⛓️ Polaris Protocol

The **Polaris Protocol** consists of a suite of Ethereum smart contracts that power decentralized lending, private asset swaps (FHEVM), and institutional-grade AMM pools. It serves as the foundation for the entire Polaris ecosystem.

## 🛠️ Tech Stack
- **Framework**: [Hardhat](https://hardhat.org/)
- **Language**: Solidity ^0.8.20
- **Privacy**: [FHEVM](https://github.com/fhenix-ai/fhevm) (Fully Homomorphic Encryption)
- **Standard**: OpenZeppelin Upgradeable & Standard Contracts.

## 📂 Contract Structure

### 🏦 Core Protocol
- **`PoolManager.sol`**: Central entry point for managing all liquidity pools.
- **`LoanEngine.sol`**: Handles the logic for borrowing, interest rates, and collateralization.
- **`CreditOracle.sol`**: Interfaces with external data feeds to provide real-time asset pricing.
- **`LiquidityVault.sol`**: Secure vault for depositing and withdrawing assets across chains.

### 📈 Lending & AMM
- **`LendingPool[TOKEN].sol`**: Specific implementations for WETH, BNB, USDC, and USDT lending.
- **`AMMPool[PAIR].sol`**: Automated Market Maker pools for major asset pairs.

### 🔐 Privacy (FHEVM)
- **`PrivateSwap[TOKEN].sol`**: Implements private swaps using Fhenix's FHEVM technology, protecting transaction details while ensuring mathematical correctness.
- **`PrivateBorrowManager.sol`**: Enables private credit scores and borrowing limits.

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Compile Smart Contracts
```bash
npx hardhat compile
```

### Run Tests
```bash
npx hardhat test
```

### Deployment (Localhost)
1. Start the local node:
   ```bash
   npx hardhat node
   ```
2. In a separate terminal, deploy the contracts:
   ```bash
   npx hardhat run scripts/deploy-full.js --network localhost
   ```

---

## 🔒 Security
The protocol implements role-based access control (RBAC) and follows industry best practices for smart contract development. All private logic is built atop the mathematically proven security of FHE.

---

## 🌐 Sepolia Integration Tests (JavaScript E2E)
A live end-to-end integration test suite is located in the core repository to verify the following Fhenix CoFHE operations on Sepolia:
1. Faucet minting of USDT.
2. Encrypted deposits into the `PrivateCollateralVault`.
3. Encrypted borrowing via the `PrivateBorrowManager`.
4. Encrypted repayments.
5. Off-chain cryptographic signature attestation & profile updates with the `CreditOracle`.
6. Live core loan creation under `LoanEngine`.

To run the integration tests:
```bash
# In the polaris-core-fhenix directory:
node scripts/integration-test-sepolia.js
```

