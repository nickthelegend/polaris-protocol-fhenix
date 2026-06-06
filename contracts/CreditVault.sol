// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CreditVault
 * @dev Manages user credit limits on Creditcoin.
 */
contract CreditVault is Ownable {
    struct UserCredit {
        uint256 collateralValue;
        uint256 lockedCredit;
    }

    mapping(address => UserCredit) public userCredits;
    uint256 public ltv = 80; // 80%
    uint256 public creditMultiplier = 1;

    event CreditLimitUpdated(address indexed user, uint256 newLimit);

    constructor() Ownable(msg.sender) {}

    function updateCollateral(address user, uint256 value) external onlyOwner {
        userCredits[user].collateralValue = value;
    }

    function getAvailableCredit(address user) public view returns (uint256) {
        UserCredit memory uc = userCredits[user];
        uint256 totalLimit = (uc.collateralValue * ltv * creditMultiplier) / 100;
        if (totalLimit <= uc.lockedCredit) return 0;
        return totalLimit - uc.lockedCredit;
    }

    function lockCredit(address user, uint256 amount) external {
        // Only BNPL engine should be able to lock
        require(getAvailableCredit(user) >= amount, "Insufficient credit limit");
        userCredits[user].lockedCredit += amount;
    }

    function unlockCredit(address user, uint256 amount) external {
        userCredits[user].lockedCredit -= amount;
    }
}
