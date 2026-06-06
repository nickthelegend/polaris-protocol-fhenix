// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockWBTC is ERC20, Ownable {
    uint256 public constant MAX_FAUCET = 100_000_000 * 10 ** 8; // 10% of 1B = 100M max per call

    constructor() ERC20("Wrapped Bitcoin", "WBTC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Request a custom amount, capped at 100M WBTC
    function faucet(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(amount <= MAX_FAUCET, "Exceeds 10% max (100M WBTC)");
        _mint(msg.sender, amount);
    }
}
