# Contract layers — canonical vs. legacy

This repo contains **two** contract layers. Only the **confidential** layer is canonical and
wired to the apps. The **legacy** layer is deprecated and kept only because it is already
deployed on Sepolia; nothing in the live frontend path uses it.

## ✅ Canonical — Confidential suite (`contracts/confidential/`)

End-to-end encrypted, real custody, no mock/transparent tokens. This is what the core,
merchant, and shopping apps use.

| Contract | Role |
|---|---|
| `ConfidentialToken.sol` | ERC-7984 FHERC20 (the real, mintable privacy token — replaces all `Mock*` tokens) |
| `ConfidentialCollateralVault.sol` | Confidential collateral custody |
| `ConfidentialLendingPool.sol` | Confidential money market (supply/borrow/repay) |
| `ConfidentialScoreManager.sol` | Encrypted credit score + limit |
| `ConfidentialLiquidationEngine.sol` | Confidential liquidation |
| `ConfidentialMerchantEscrow.sol` | Private (encrypted-amount) merchant payments |
| `ConfidentialSwapPool.sol` | Confidential fixed-rate swap |
| `AuthorizedManagers.sol` | Shared owner-gated ACL base |

Tests: `test/ConfidentialEncryption.test.ts`, `ConfidentialSuite.test.ts`,
`ConfidentialMerchantEscrow.test.ts`, `ConfidentialSwap.test.ts` — **14 passing**
(encryption + decryption verified). Deploy: `scripts/deploy-confidential-suite.js`.

## 🗑️ Mock contracts — DELETED

All mock contracts have been **removed** from the repo (the deployed instances remain live on
Sepolia at their recorded addresses; only the unused source is gone, and it's git-recoverable):

- Deleted: `mocks/MockERC20.sol`, `mocks/MockNativeQueryVerifier.sol`, `mocks/MockOracleRelayer.sol`,
  `mocks/MockUSCOracle.sol`, and `tokens/Mock{BNB,USDC,USDT,WBTC,WETH}.sol`.
- No `.sol` imported them (verified), so removal had **zero compile impact** — `npx hardhat compile`
  still builds all remaining contracts and the **14 confidential tests pass**.
- Frontend: the apps no longer ship a `Mock*` ABI. The legacy hooks that previously used the
  `MockERC20` ABI as a generic ERC-20 interface now use a real `lib/abis/ERC20.json`.

There are **no mock contracts or mock ABIs anywhere in the codebase** now.

## ⚠️ DEPRECATED — Legacy transparent contracts (real code, not mocks)

These are **real** (transparent, non-private) implementations — *not* mocks. They remain only
because they are deployed (`deployments-sepolia-final.json`) and **no app flow uses them**. New
work should target the confidential suite above.

- Root: `PoolManager.sol`, `LoanEngine.sol`, `CreditOracle.sol`, `CreditVault.sol`,
  `ScoreManager.sol`, `LiquidityVault.sol`, `ProtocolFunds.sol`, `InsurancePool.sol`,
  `MerchantRouter.sol`, and the superseded `Private*.sol` (early FHE attempt — replaced by `confidential/`).
- `AMMPool*.sol` (4), `LendingPool*.sol` (4).

These need real ERC-20s to operate; on testnet that means any mintable ERC-20 (the canonical
layer's `ConfidentialToken` is itself a real, mintable FHERC-20 — not a stand-in).
