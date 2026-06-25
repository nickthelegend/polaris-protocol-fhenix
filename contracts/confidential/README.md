# Polaris Confidential Suite (end-to-end encrypted)

A coherent, custody-backed confidential lending protocol built on Fhenix CoFHE. This
replaces the old `Private*` contracts and the leaky `PoolManager`/`LoanEngine` "hybrid"
path that the audit flagged. Every amount stays encrypted (`euint64`), and balances are
backed by **real** confidential-token custody.

## Contracts

| Contract | Role |
|---|---|
| `ConfidentialToken` | ERC-7984-style FHERC20. Encrypted balances, operators (no allowances), `confidentialTransfer`/`From`, mint/burn, zero-replacement, opt-in disclosure. `balanceOf` returns a wallet-compat indicator; `confidentialBalanceOf` returns the real encrypted balance. |
| `ConfidentialScoreManager` | Encrypted credit score (`euint32`, 300–850) + encrypted credit limit (`euint64`). Only the user can decrypt theirs; only authorized protocol contracts can mutate. |
| `ConfidentialCollateralVault` | Custodies a confidential collateral token. Deposit/withdraw move real cTokens; `seizeAll` (auth-only) for liquidation. |
| `ConfidentialLendingPool` | The money market for one borrowable cToken. supply / withdraw / borrow / repay with real custody; borrow gated by encrypted health factor **and** encrypted credit limit. |
| `ConfidentialLiquidationEngine` | Two-phase liquidation: `auditHealth` exposes only an encrypted "unhealthy" bool → reveal → `resolveAudit` seizes collateral, clears debt, penalizes score. |
| `ConfidentialMerchantEscrow` | Private merchant settlement — pay a merchant with an **encrypted** amount; the tx reveals only that an order was paid. |
| `AuthorizedManagers` | Owner-gated ACL registry shared by the suite (the access-control fix). |

## Tests (12 passing across 4 suites)

- `test/ConfidentialEncryption.test.ts` — encrypt → `decryptForView` (permit) round-trip + deny-path + public disclosure.
- `test/ConfidentialSuite.test.ts` — custody, borrow gating (health + credit limit), repay + score bump, full liquidation.
- `test/ConfidentialMerchantEscrow.test.ts` — encrypted-amount payment + double-pay/unknown-merchant guards.
- `test/PrivateCollateralVault.test.ts` — legacy vault sanity.

## Frontend wiring (core app)

- `lib/confidential.ts` — addresses (`NEXT_PUBLIC_CONF_*`) + ABIs + `operatorExpiry()` helper.
- `hooks/use-confidential-lending.ts` — encrypt → operator grant → supply/withdraw/deposit/borrow/repay → `decryptForView` positions.
- Wired pages: `app/borrow`, `app/positions` (+ manage modal), `app/page.tsx` (home widget).
- Merchant SDK: `components/sdk/PayWithPolarisConfidential.tsx` (encrypted checkout).

## How the audit findings were fixed

- **H-1 (permissionless privacy fns):** all `authorizeManager` / admin / reveal calls are `onlyOwner` / `onlyAuthorized`.
- **H-2 (missing ACL wiring):** `deploy-confidential-suite.js` performs every cross-contract `authorizeManager` grant; tests assert the wired flows work.
- **H-3 (no custody):** supply/deposit/borrow/repay all move real `ConfidentialToken` balances via `confidentialTransfer`/`confidentialTransferFrom`.
- **M-1 (plaintext leakage):** no plaintext `clearAmount` anywhere — amounts are `euint64` end to end.
- **M-2 (two implementations):** this is now the single canonical suite.

## Critical CoFHE rule used throughout

`FHE.asEuint64(InEuint64)` must run in the contract the **EOA calls directly** (the input
proof is bound to `msg.sender`). So entry contracts decode the input themselves, then pass
the resulting `euint64` handle to the token with `FHE.allowTransient(handle, token)`. Never
forward a raw `InEuint64` into a sub-called contract.

## Frontend integration (per user action)

Because the token uses operators instead of allowances, a user must grant a short operator
window before any pull-based action:

```ts
// Supply liquidity (cUSDC):
await cUSDC.setOperator(poolAddr, Math.floor(Date.now()/1000) + 600); // 10 min
const [enc] = await client.encryptInputs([Encryptable.uint64(amount)]).execute();
await pool.supply(enc);

// Deposit collateral (cWETH): setOperator(vault) then vault.deposit(enc)
// Repay (cUSDC):              setOperator(pool)  then pool.repay(enc)
// Borrow / withdraw:          no operator needed (pool/vault sends to the user)
```

Read a private value with `client.decryptForView(handle, FheTypes.Uint64)` (+ self permit);
read a publicly-revealed value (liquidation flag, disclosure) with
`client.decryptForTx(handle).withoutPermit()`.

## Deploy & test

```bash
npx hardhat test test/ConfidentialSuite.test.ts
npx hardhat run scripts/deploy-confidential-suite.js --network <net>   # writes deployments-confidential.json
```

## Known simplifications (intentional, documented)

- `vault.withdraw` is not solvency-gated (the pool/engine gate risk); a production build
  should check the borrower's health before releasing collateral.
- Liquidation seizes **all** collateral to the pool (no partial close / liquidator bonus).
- The faucet `mint(to, amount)` takes a plaintext amount (a faucet entry point); user
  balances and all transfers remain encrypted.
- Credit limits are set by the owner (`setCreditLimit`); deriving them from score history
  on-chain is future work.
