// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {FHE, euint64, InEuint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title CreditOracle
 * @dev Stores attested external loan data (Aave, Morpho, Compound) privately using Fhenix CoFHE.
 */
contract CreditOracle is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct CreditProfile {
        euint64 totalCollateralUsd;
        euint64 totalDebtUsd;
        uint256 lastUpdate;
        uint256 nonce;
    }

    address public attester;
    mapping(address => CreditProfile) public profiles;

    event ProfileUpdated(address indexed user);
    event AttesterChanged(address indexed oldAttester, address indexed newAttester);
    event DebtProfileRequested(address indexed user, bytes32 collateralHandle, bytes32 debtHandle);
    event DebtProfileRevealed(address indexed user, uint64 collateral, uint64 debt);

    constructor(address _attester) Ownable(msg.sender) {
        attester = _attester;
    }

    function setAttester(address _attester) external {
        // Allow owner check
        // For simplicity and since Ownable handles owner, we can use owner() check or onlyOwner modifier
        require(msg.sender == owner(), "Not owner");
        emit AttesterChanged(attester, _attester);
        attester = _attester;
    }

    /**
     * @dev Updates a user's credit profile using a signed attestation from the trusted attester.
     * @notice The collateral and debt are provided as encrypted handles.
     */
    function updateProfile(
        address user,
        InEuint64 calldata collateralHandle,
        InEuint64 calldata debtHandle,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        require(timestamp > block.timestamp - 1 hours, "Attestation expired");
        
        // Note: We hash the metadata and handles to ensure integrity.
        bytes32 messageHash = keccak256(abi.encodePacked(
            user,
            collateralHandle.ctHash,
            debtHandle.ctHash,
            timestamp,
            profiles[user].nonce
        ));
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        
        require(signer == attester, "Invalid signature");

        euint64 collateral = FHE.asEuint64(collateralHandle);
        euint64 debt = FHE.asEuint64(debtHandle);

        profiles[user].totalCollateralUsd = collateral;
        profiles[user].totalDebtUsd = debt;
        profiles[user].lastUpdate = block.timestamp;
        profiles[user].nonce++;

        // Allow user and this contract to see the data
        FHE.allow(collateral, user);
        FHE.allow(debt, user);
        FHE.allowThis(collateral);
        FHE.allowThis(debt);

        emit ProfileUpdated(user);
    }

    /**
     * @notice Get encrypted net value and sign
     * @param user The user address
     */
    function getEncryptedNetValue(address user) external returns (euint64 netValue, ebool isPositive) {
        CreditProfile storage p = profiles[user];
        if (p.lastUpdate == 0 || p.lastUpdate < block.timestamp - 7 days) {
            netValue = FHE.asEuint64(0);
            isPositive = FHE.asEbool(true);
            FHE.allow(netValue, msg.sender);
            FHE.allow(isPositive, msg.sender);
            FHE.allowThis(netValue);
            FHE.allowThis(isPositive);
            return (netValue, isPositive);
        }
        
        isPositive = FHE.gte(p.totalCollateralUsd, p.totalDebtUsd);
        netValue = FHE.select(isPositive, 
            FHE.sub(p.totalCollateralUsd, p.totalDebtUsd), 
            FHE.sub(p.totalDebtUsd, p.totalCollateralUsd)
        );
        
        FHE.allow(netValue, msg.sender);
        FHE.allow(isPositive, msg.sender);
        FHE.allowThis(netValue);
        FHE.allowThis(isPositive);
    }

    /**
     * @notice Request to reveal a user's debt profile publicly (Step 1)
     */
    function requestPublicDebtProfile(address user) external {
        CreditProfile storage p = profiles[user];
        require(p.lastUpdate != 0, "No profile");

        FHE.allowPublic(p.totalCollateralUsd);
        FHE.allowPublic(p.totalDebtUsd);
        
        ebool isDebtHigher = FHE.gt(p.totalDebtUsd, p.totalCollateralUsd);
        FHE.allowThis(isDebtHigher);
        FHE.allowPublic(isDebtHigher);

        emit DebtProfileRequested(user, euint64.unwrap(p.totalCollateralUsd), euint64.unwrap(p.totalDebtUsd));
    }

    /**
     * @notice Finalize the reveal with KMS signatures (Step 2)
     */
    function finalizePublicDebtProfile(
        address user,
        uint64 totalCollateralUsd,
        bytes calldata collateralSig,
        uint64 totalDebtUsd,
        bytes calldata debtSig,
        bool isDebtHigher,
        bytes calldata isDebtHigherSig
    ) external returns (uint64, uint64, bool) {
        CreditProfile storage p = profiles[user];
        require(p.lastUpdate != 0, "No profile");

        FHE.publishDecryptResult(p.totalCollateralUsd, totalCollateralUsd, collateralSig);
        FHE.publishDecryptResult(p.totalDebtUsd, totalDebtUsd, debtSig);

        ebool isDebtHigherEnc = FHE.gt(p.totalDebtUsd, p.totalCollateralUsd);
        FHE.publishDecryptResult(isDebtHigherEnc, isDebtHigher, isDebtHigherSig);

        emit DebtProfileRevealed(user, totalCollateralUsd, totalDebtUsd);
        return (totalCollateralUsd, totalDebtUsd, isDebtHigher);
    }
}
