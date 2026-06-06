// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title InsurancePool
 * @dev Staked CTC acts as a buffer for BNPL defaults.
 */
contract InsurancePool is Ownable {
    mapping(address => uint256) public stakedCTC;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Slashed(uint256 amount);

    constructor() Ownable(msg.sender) {}

    function stakeCTC(uint256 amount) external {
        // Mock transfer from user
        stakedCTC[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function slashInsurance(uint256 amount) external onlyOwner {
        require(totalStaked >= amount, "Insufficient insurance");
        totalStaked -= amount;
        emit Slashed(amount);
    }
}
