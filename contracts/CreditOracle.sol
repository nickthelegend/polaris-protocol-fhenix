// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {FhenixEthereumConfig} from "@fhevm/solidity/config/FhenixConfig.sol";

/**
 * @title CreditOracle
 * @dev Stores attested external loan data (Aave, Morpho, Compound) privately using Fhenix FHEVM.
 */
contract CreditOracle is Ownable, FhenixEthereumConfig {
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

    constructor(address _attester) Ownable(msg.sender) {
        attester = _attester;
    }

    function setAttester(address _attester) external onlyOwner {
        emit AttesterChanged(attester, _attester);
        attester = _attester;
    }

    /**
     * @dev Updates a user's credit profile using a signed attestation from the trusted attester.
     * @notice The collateral and debt are provided as encrypted handles.
     */
    function updateProfile(
        address user,
        externalEuint64 collateralHandle,
        bytes calldata collateralProof,
        externalEuint64 debtHandle,
        bytes calldata debtProof,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        require(timestamp > block.timestamp - 1 hours, "Attestation expired");
        
        // Note: We hash the metadata and handles to ensure integrity.
        // In a production FHEVM app, the attester would sign the encrypted values.
        bytes32 messageHash = keccak256(abi.encodePacked(
            user,
            externalEuint64.unwrap(collateralHandle),
            externalEuint64.unwrap(debtHandle),
            timestamp,
            profiles[user].nonce
        ));
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        
        require(signer == attester, "Invalid signature");

        euint64 collateral = FHE.fromExternal(collateralHandle, collateralProof);
        euint64 debt = FHE.fromExternal(debtHandle, debtProof);

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
        
        isPositive = FHE.ge(p.totalCollateralUsd, p.totalDebtUsd);
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

        FHE.makePubliclyDecryptable(p.totalCollateralUsd);
        FHE.makePubliclyDecryptable(p.totalDebtUsd);
        
        ebool isDebtHigher = FHE.gt(p.totalDebtUsd, p.totalCollateralUsd);
        FHE.allowThis(isDebtHigher);
        FHE.makePubliclyDecryptable(isDebtHigher);
    }

    /**
     * @notice Finalize the reveal with KMS signatures (Step 2)
     */
    function finalizePublicDebtProfile(
        address user,
        bytes memory abiEncodedClearTexts,
        bytes memory decryptionProof
    ) external returns (uint64 totalCollateralUsd, uint64 totalDebtUsd, bool isDebtHigher) {
        CreditProfile storage p = profiles[user];
        
        bytes32[] memory handles = new bytes32[](3);
        handles[0] = FHE.toBytes32(p.totalCollateralUsd);
        handles[1] = FHE.toBytes32(p.totalDebtUsd);
        
        ebool isDebtHigherEnc = FHE.gt(p.totalDebtUsd, p.totalCollateralUsd);
        handles[2] = FHE.toBytes32(isDebtHigherEnc);

        FHE.checkSignatures(handles, abiEncodedClearTexts, decryptionProof);

        (totalCollateralUsd, totalDebtUsd, isDebtHigher) = abi.decode(abiEncodedClearTexts, (uint64, uint64, bool));
    }
}

