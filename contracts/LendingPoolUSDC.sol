// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LendingPoolUSDC is ERC20, Ownable {
    IERC20 public immutable asset;
    
    uint256 public totalBorrowed;
    uint256 public constant COLLATERAL_RATIO = 120; // Lower for stablecoin
    uint256 public constant INTEREST_RATE = 3; // 3% APR
    
    mapping(address => uint256) public borrowed;
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public lastBorrowTime;
    
    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event CollateralAdded(address indexed user, uint256 amount);
    
    constructor(address _asset) ERC20("LP USDC", "lpUSDC") Ownable(msg.sender) {
        asset = IERC20(_asset);
    }
    
    function deposit(uint256 amount) external returns (uint256 shares) {
        require(amount > 0, "Amount must be > 0");
        
        uint256 totalAssets = asset.balanceOf(address(this)) - totalBorrowed;
        uint256 supply = totalSupply();
        
        shares = supply == 0 ? amount : (amount * supply) / totalAssets;
        
        asset.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);
        
        emit Deposited(msg.sender, amount, shares);
    }
    
    function withdraw(uint256 shares) external returns (uint256 amount) {
        require(shares > 0, "Shares must be > 0");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");
        
        uint256 totalAssets = asset.balanceOf(address(this)) - totalBorrowed;
        amount = (shares * totalAssets) / totalSupply();
        
        _burn(msg.sender, shares);
        asset.transfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount, shares);
    }
    
    function addCollateral(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        asset.transferFrom(msg.sender, address(this), amount);
        collateral[msg.sender] += amount;
        emit CollateralAdded(msg.sender, amount);
    }
    
    function borrow(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        
        uint256 maxBorrow = (collateral[msg.sender] * 100) / COLLATERAL_RATIO;
        require(borrowed[msg.sender] + amount <= maxBorrow, "Insufficient collateral");
        require(asset.balanceOf(address(this)) >= totalBorrowed + amount, "Insufficient liquidity");
        
        borrowed[msg.sender] += amount;
        totalBorrowed += amount;
        lastBorrowTime[msg.sender] = block.timestamp;
        
        asset.transfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }
    
    function repay(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(borrowed[msg.sender] >= amount, "Repay exceeds debt");
        
        asset.transferFrom(msg.sender, address(this), amount);
        borrowed[msg.sender] -= amount;
        totalBorrowed -= amount;
        
        emit Repaid(msg.sender, amount);
    }
    
    function getDebt(address user) external view returns (uint256) {
        if (borrowed[user] == 0) return 0;
        
        uint256 timeElapsed = block.timestamp - lastBorrowTime[user];
        uint256 interest = (borrowed[user] * INTEREST_RATE * timeElapsed) / (365 days * 100);
        return borrowed[user] + interest;
    }
}
