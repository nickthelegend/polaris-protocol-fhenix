// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, euint32, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuthorizedManagers
 * @notice Shared access-control base for the confidential lending suite.
 *
 *         CoFHE ciphertext handles are permissioned per-address (the ACL). When a
 *         protocol contract (e.g. the lending pool) needs to read and compute on a
 *         handle that another contract produced (e.g. a user's collateral), that
 *         producing contract must `FHE.allow(handle, manager)`.
 *
 *         This base provides an owner-gated registry of authorized manager contracts
 *         plus helpers to re-grant ACL access to all of them whenever a handle is
 *         (re)created. This is the fix for the previous suite's two security gaps:
 *           1. `authorizeContract` was permissionless (anyone could grant access).
 *           2. The deploy script never wired the cross-contract grants at all.
 */
abstract contract AuthorizedManagers is Ownable {
    mapping(address => bool) public isAuthorizedManager;
    address[] internal _managerList;

    event ManagerAuthorized(address indexed manager);
    event ManagerRevoked(address indexed manager);

    constructor() Ownable(msg.sender) {}

    /// @notice Owner authorizes a protocol contract to use this contract's handles in FHE ops.
    function authorizeManager(address manager) external onlyOwner {
        require(manager != address(0), "zero manager");
        if (!isAuthorizedManager[manager]) {
            isAuthorizedManager[manager] = true;
            _managerList.push(manager);
            emit ManagerAuthorized(manager);
        }
    }

    /// @notice Owner revokes a manager (does not retroactively remove handle grants).
    function revokeManager(address manager) external onlyOwner {
        if (isAuthorizedManager[manager]) {
            isAuthorizedManager[manager] = false;
            for (uint256 i = 0; i < _managerList.length; i++) {
                if (_managerList[i] == manager) {
                    _managerList[i] = _managerList[_managerList.length - 1];
                    _managerList.pop();
                    break;
                }
            }
            emit ManagerRevoked(manager);
        }
    }

    function authorizedManagers() external view returns (address[] memory) {
        return _managerList;
    }

    modifier onlyAuthorized() {
        require(isAuthorizedManager[msg.sender] || msg.sender == owner(), "not authorized");
        _;
    }

    /// @dev Grant every authorized manager FHE access to a freshly created euint64 handle.
    function _grantManagers(euint64 handle) internal {
        uint256 len = _managerList.length;
        for (uint256 i = 0; i < len; i++) {
            FHE.allow(handle, _managerList[i]);
        }
    }

    /// @dev euint32 variant (used by the score manager).
    function _grantManagers32(euint32 handle) internal {
        uint256 len = _managerList.length;
        for (uint256 i = 0; i < len; i++) {
            FHE.allow(handle, _managerList[i]);
        }
    }
}
