// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBNB is ERC20 {
    constructor() ERC20("Binance Coin", "BNB") {
        _mint(msg.sender, 1000000 * 10**18); // 1M BNB
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
