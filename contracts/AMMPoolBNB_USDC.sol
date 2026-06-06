// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AMMPoolBNB_USDC is ERC20 {
    IERC20 public immutable token0; // BNB
    IERC20 public immutable token1; // USDC
    
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public constant FEE = 3; // 0.3% fee
    
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    
    constructor(address _token0, address _token1) ERC20("BNB-USDC LP", "BNB-USDC-LP") {
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }
    
    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        require(amount0 > 0 && amount1 > 0, "Amounts must be > 0");
        
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);
        
        uint256 _totalSupply = totalSupply();
        
        if (_totalSupply == 0) {
            liquidity = sqrt(amount0 * amount1);
        } else {
            liquidity = min(
                (amount0 * _totalSupply) / reserve0,
                (amount1 * _totalSupply) / reserve1
            );
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        
        _mint(msg.sender, liquidity);
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        
        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }
    
    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        require(liquidity > 0, "Liquidity must be > 0");
        require(balanceOf(msg.sender) >= liquidity, "Insufficient LP tokens");
        
        uint256 _totalSupply = totalSupply();
        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;
        
        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");
        
        _burn(msg.sender, liquidity);
        token0.transfer(msg.sender, amount0);
        token1.transfer(msg.sender, amount1);
        
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        
        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }
    
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");
        
        bool isToken0 = tokenIn == address(token0);
        (IERC20 _tokenIn, IERC20 _tokenOut, uint256 reserveIn, uint256 reserveOut) = isToken0
            ? (token0, token1, reserve0, reserve1)
            : (token1, token0, reserve1, reserve0);
        
        _tokenIn.transferFrom(msg.sender, address(this), amountIn);
        
        uint256 amountInWithFee = (amountIn * (1000 - FEE)) / 1000;
        amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
        
        require(amountOut > 0, "Insufficient output amount");
        
        _tokenOut.transfer(msg.sender, amountOut);
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        
        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }
    
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");
        
        bool isToken0 = tokenIn == address(token0);
        (uint256 reserveIn, uint256 reserveOut) = isToken0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        
        uint256 amountInWithFee = (amountIn * (1000 - FEE)) / 1000;
        amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
    }
    
    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
    }
    
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
    
    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }
}
