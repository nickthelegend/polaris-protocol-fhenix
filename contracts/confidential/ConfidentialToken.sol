// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, InEuint64, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ConfidentialToken
 * @notice An ERC-7984-style confidential fungible token built directly on Fhenix CoFHE.
 *
 *         Balances and transfer amounts are encrypted `euint64`. The token stays
 *         wallet/explorer compatible through the ERC-7984 "indicator" system:
 *         `balanceOf` returns a non-confidential 0–9999 activity indicator (NOT the
 *         real balance) and `balanceOfIsIndicator()` returns true. The real balance
 *         is read with `confidentialBalanceOf` and decrypted client-side via the SDK.
 *
 *         Key properties (per fhenix-confidential-erc20 skill):
 *           - Zero-replacement: transferring more than you hold moves 0 (never reverts),
 *             so balances are never leaked by revert behaviour. Always trust the returned
 *             `transferred` handle, never the requested amount.
 *           - Inline ACL: every balance write re-grants `allowThis` + `allow(user)`.
 *           - Operators replace allowances (no amount leakage), auto-expiring by timestamp.
 *           - The legacy ERC20 mutators (transfer/approve/transferFrom/allowance) revert.
 */
contract ConfidentialToken is Ownable {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    // The real, encrypted balances and supply.
    mapping(address => euint64) private _balances;
    euint64 private _totalSupply;

    // Non-confidential activity indicator (ERC-7984 wallet compatibility).
    mapping(address => uint16) private _indicated;
    uint16 private constant INDICATOR_INIT = 7984;

    // Operators: holder => spender => expiry (unix seconds). Replaces ERC20 allowances.
    mapping(address => mapping(address => uint48)) private _operatorExpiry;

    // Faucet/protocol minters.
    mapping(address => bool) public isMinter;

    event Transfer(address indexed from, address indexed to, uint16 indicatorTick);
    event ConfidentialTransfer(address indexed from, address indexed to);
    event OperatorSet(address indexed holder, address indexed spender, uint48 until);
    event MinterSet(address indexed minter, bool enabled);
    event BalanceDiscloseRequested(address indexed holder, bytes32 handle);
    event BalanceDisclosed(address indexed holder, uint64 amount);

    error FHERC20IncompatibleFunction();
    error FHERC20UnauthorizedSpender(address from, address spender);
    error FHERC20UnauthorizedUseOfEncryptedAmount();
    error FHERC20InvalidReceiver(address to);
    error NotMinter();

    constructor(string memory _name, string memory _symbol, uint8 _decimals) Ownable(msg.sender) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        _totalSupply = FHE.asEuint64(0);
        FHE.allowThis(_totalSupply);
        isMinter[msg.sender] = true;
        emit MinterSet(msg.sender, true);
    }

    // ─────────────────────────── Minter management ───────────────────────────

    function setMinter(address minter, bool enabled) external onlyOwner {
        isMinter[minter] = enabled;
        emit MinterSet(minter, enabled);
    }

    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    // ───────────────────────── ERC20 compatibility shims ─────────────────────

    function balanceOfIsIndicator() external pure returns (bool) {
        return true;
    }

    /// @notice Non-confidential activity indicator (0–9999), NOT the real balance.
    function balanceOf(address account) external view returns (uint16) {
        return _indicated[account];
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert FHERC20IncompatibleFunction();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert FHERC20IncompatibleFunction();
    }

    function allowance(address, address) external pure returns (uint256) {
        revert FHERC20IncompatibleFunction();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert FHERC20IncompatibleFunction();
    }

    // ───────────────────────────── Confidential views ────────────────────────

    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    function confidentialTotalSupply() external view returns (euint64) {
        return _totalSupply;
    }

    // ─────────────────────────────── Operators ───────────────────────────────

    /// @notice Grant/extend/revoke an operator. `until` is a unix-seconds expiry.
    ///         Use SHORT windows; an operator can move your entire balance until it lapses.
    function setOperator(address spender, uint48 until) external {
        _operatorExpiry[msg.sender][spender] = until;
        emit OperatorSet(msg.sender, spender, until);
    }

    function isOperator(address holder, address spender) public view returns (bool) {
        return _operatorExpiry[holder][spender] >= block.timestamp && _operatorExpiry[holder][spender] != 0;
    }

    // ────────────────────────────── Mint / Burn ──────────────────────────────

    /// @notice Faucet/protocol mint from a plaintext amount (mint amount is public, balances stay private).
    function mint(address to, uint64 amount) external onlyMinter {
        _mint(to, FHE.asEuint64(uint256(amount)));
    }

    /// @notice Mint from an already-encrypted amount (caller must be ACL-authorized for it).
    function confidentialMint(address to, euint64 amount) external onlyMinter {
        if (!FHE.isAllowed(amount, msg.sender)) revert FHERC20UnauthorizedUseOfEncryptedAmount();
        _mint(to, amount);
    }

    function burn(uint64 amount) external {
        _burn(msg.sender, FHE.asEuint64(uint256(amount)));
    }

    function _mint(address to, euint64 amount) internal {
        if (to == address(0)) revert FHERC20InvalidReceiver(to);
        euint64 bal = _ensureBalance(to);
        euint64 newBal = FHE.add(bal, amount);
        _balances[to] = newBal;
        _totalSupply = FHE.add(_totalSupply, amount);

        FHE.allowThis(newBal);
        FHE.allow(newBal, to);
        FHE.allowThis(_totalSupply);

        _bumpIndicator(to, true);
        emit Transfer(address(0), to, _tick());
    }

    function _burn(address from, euint64 amount) internal {
        euint64 bal = _ensureBalance(from);
        ebool canBurn = FHE.lte(amount, bal);
        euint64 burned = FHE.select(canBurn, amount, FHE.asEuint64(0));
        euint64 newBal = FHE.sub(bal, burned);
        _balances[from] = newBal;
        _totalSupply = FHE.sub(_totalSupply, burned);

        FHE.allowThis(newBal);
        FHE.allow(newBal, from);
        FHE.allowThis(_totalSupply);

        _bumpIndicator(from, false);
        emit Transfer(from, address(0), _tick());
    }

    // ───────────────────────── Confidential transfers ────────────────────────

    /// @notice Transfer from a freshly encrypted user input.
    function confidentialTransfer(address to, InEuint64 calldata enc) external returns (euint64) {
        return _transfer(msg.sender, to, FHE.asEuint64(enc));
    }

    /// @notice Contract-to-contract transfer of an existing handle (caller must be ACL-authorized for it).
    function confidentialTransfer(address to, euint64 amount) external returns (euint64) {
        if (!FHE.isAllowed(amount, msg.sender)) revert FHERC20UnauthorizedUseOfEncryptedAmount();
        return _transfer(msg.sender, to, amount);
    }

    /// @notice Operator-driven transfer from an encrypted user input.
    function confidentialTransferFrom(address from, address to, InEuint64 calldata enc) external returns (euint64) {
        if (!isOperator(from, msg.sender)) revert FHERC20UnauthorizedSpender(from, msg.sender);
        return _transfer(from, to, FHE.asEuint64(enc));
    }

    /// @notice Operator-driven transfer of an existing handle.
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64) {
        if (!isOperator(from, msg.sender)) revert FHERC20UnauthorizedSpender(from, msg.sender);
        if (!FHE.isAllowed(amount, msg.sender)) revert FHERC20UnauthorizedUseOfEncryptedAmount();
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, euint64 amount) internal returns (euint64 transferred) {
        if (to == address(0)) revert FHERC20InvalidReceiver(to);

        euint64 fromBal = _ensureBalance(from);
        euint64 toBal = _ensureBalance(to);

        // Zero-replacement: move min(amount, balance) so an over-send reveals nothing.
        ebool canSend = FHE.lte(amount, fromBal);
        transferred = FHE.select(canSend, amount, FHE.asEuint64(0));

        euint64 newFrom = FHE.sub(fromBal, transferred);
        euint64 newTo = FHE.add(toBal, transferred);
        _balances[from] = newFrom;
        _balances[to] = newTo;

        // Inline ACL — without this the balances become unreadable in later txs.
        FHE.allowThis(newFrom);
        FHE.allow(newFrom, from);
        FHE.allowThis(newTo);
        FHE.allow(newTo, to);

        // The caller (operator/pool/vault) and both parties may use the returned `transferred`.
        FHE.allowThis(transferred);
        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
        FHE.allow(transferred, msg.sender);

        _bumpIndicator(from, false);
        _bumpIndicator(to, true);

        emit ConfidentialTransfer(from, to);
        emit Transfer(from, to, _tick());
    }

    // ───────────────────── Opt-in balance disclosure (reveal) ────────────────

    /// @notice Holder opts to make their own balance publicly decryptable.
    function requestDiscloseBalance() external {
        euint64 bal = _ensureBalance(msg.sender);
        FHE.allowPublic(bal);
        emit BalanceDiscloseRequested(msg.sender, euint64.unwrap(bal));
    }

    /// @notice Finalize a disclosure with the MPC-signed cleartext + proof.
    function finalizeDiscloseBalance(address holder, uint64 cleartext, bytes calldata signature) external {
        FHE.publishDecryptResult(_balances[holder], cleartext, signature);
        emit BalanceDisclosed(holder, cleartext);
    }

    // ────────────────────────────── Internals ────────────────────────────────

    function _ensureBalance(address account) internal returns (euint64) {
        if (!FHE.isInitialized(_balances[account])) {
            euint64 zero = FHE.asEuint64(0);
            _balances[account] = zero;
            FHE.allowThis(zero);
            FHE.allow(zero, account);
        }
        return _balances[account];
    }

    function _bumpIndicator(address account, bool received) internal {
        uint16 cur = _indicated[account];
        if (cur == 0) cur = INDICATOR_INIT;
        if (received) {
            cur = cur >= 9999 ? 1 : cur + 1;
        } else {
            cur = cur <= 1 ? 9999 : cur - 1;
        }
        _indicated[account] = cur;
    }

    function _tick() internal view returns (uint16) {
        if (decimals < 4) return 1;
        uint256 t = 10 ** (uint256(decimals) - 4);
        return t > type(uint16).max ? type(uint16).max : uint16(t);
    }
}
