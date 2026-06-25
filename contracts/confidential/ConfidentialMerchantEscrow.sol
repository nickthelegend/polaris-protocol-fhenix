// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, InEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ConfidentialToken } from "./ConfidentialToken.sol";

/**
 * @title ConfidentialMerchantEscrow
 * @notice Private merchant settlement. A customer pays a merchant in confidential tokens
 *         with an ENCRYPTED amount — the on-chain payment reveals only that an order was
 *         paid (an event with the orderId + parties), never the amount.
 *
 *         Flow (per payment):
 *           1. customer: token.setOperator(escrow, shortExpiry)
 *           2. customer: escrow.settlePayment(orderId, merchant, encAmount)
 *              -> escrow pulls min(amount, balance) cTokens customer -> merchant
 *              -> accumulates the merchant's encrypted lifetime total (merchant-decryptable)
 *              -> bumps a NON-confidential payment counter for merchant analytics
 *
 *         Analytics note: the *count* of payments is public (it leaks nothing about amounts),
 *         which lets a merchant show "N payments received" without decrypting anything. The
 *         encrypted lifetime total stays private and is only readable by the merchant.
 */
contract ConfidentialMerchantEscrow is Ownable {
    ConfidentialToken public immutable token;

    mapping(address => bool) public isMerchant;
    mapping(address => euint64) private _received;      // encrypted lifetime received, per merchant
    mapping(bytes32 => bool) public orderPaid;

    // ── Public analytics (counts only — no amounts) ──
    mapping(address => uint256) public paymentCount;    // payments received per merchant
    mapping(address => uint256) public lastPaymentTime; // unix ts of the merchant's last payment
    mapping(bytes32 => address) public orderPayer;      // orderId -> who paid it
    uint256 public totalMerchants;
    uint256 public totalPayments;

    event MerchantRegistered(address indexed merchant);
    event PaymentSettled(bytes32 indexed orderId, address indexed payer, address indexed merchant, uint256 count, uint256 timestamp);

    constructor(address _token) Ownable(msg.sender) {
        token = ConfidentialToken(_token);
    }

    /// @notice A merchant self-registers their payout address.
    function registerMerchant() external {
        if (!isMerchant[msg.sender]) {
            isMerchant[msg.sender] = true;
            totalMerchants += 1;
            emit MerchantRegistered(msg.sender);
        }
    }

    /**
     * @notice Settle an order privately. The caller (payer) must first call
     *         `token.setOperator(thisEscrow, expiry)`.
     * @param orderId  Unique order identifier (e.g. keccak256 of the merchant's order ref).
     * @param merchant The payout address (a registered merchant).
     * @param encAmount Encrypted payment amount (InEuint64).
     */
    function settlePayment(bytes32 orderId, address merchant, InEuint64 calldata encAmount) external {
        require(isMerchant[merchant], "Unknown merchant");
        require(!orderPaid[orderId], "Order already paid");

        // Decode the input HERE (msg.sender == payer) so the input proof verifies.
        euint64 amount = FHE.asEuint64(encAmount);
        FHE.allowThis(amount);
        FHE.allowTransient(amount, address(token));

        // Move confidential tokens payer -> merchant. Zero-replaces if the payer is short.
        euint64 moved = token.confidentialTransferFrom(msg.sender, merchant, amount);

        // Accumulate the merchant's encrypted lifetime total (only the merchant can read it).
        euint64 prev = FHE.isInitialized(_received[merchant]) ? _received[merchant] : FHE.asEuint64(0);
        euint64 total = FHE.add(prev, moved);
        _received[merchant] = total;
        FHE.allowThis(total);
        FHE.allow(total, merchant);

        // Public analytics (no amount leaked).
        orderPaid[orderId] = true;
        orderPayer[orderId] = msg.sender;
        paymentCount[merchant] += 1;
        lastPaymentTime[merchant] = block.timestamp;
        totalPayments += 1;

        emit PaymentSettled(orderId, msg.sender, merchant, paymentCount[merchant], block.timestamp);
    }

    /// @notice Encrypted lifetime total received by a merchant (merchant-decryptable).
    function getReceived(address merchant) external view returns (euint64) {
        return _received[merchant];
    }

    /// @notice Public analytics snapshot for a merchant (count + last payment time).
    function getMerchantStats(address merchant)
        external
        view
        returns (bool registered, uint256 payments, uint256 lastPayment)
    {
        return (isMerchant[merchant], paymentCount[merchant], lastPaymentTime[merchant]);
    }
}
