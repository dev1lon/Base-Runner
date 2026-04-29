// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GameCoinV3
 * @notice GC token with restricted backend minting and burner roles for one-call upgrades.
 */
contract GameCoinV3 {
    string public constant name = "Rug Pull Run GameCoin";
    string public constant symbol = "GC";
    uint8 public constant decimals = 0;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public minters;
    mapping(address => bool) public burners;

    address public owner;
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event MinterSet(address indexed minter, bool enabled);
    event BurnerSet(address indexed burner, bool enabled);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previous, address indexed next);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyMinter() { require(minters[msg.sender], "Not minter"); _; }
    modifier onlyBurner() { require(burners[msg.sender], "Not burner"); _; }
    modifier whenNotPaused() { require(!paused, "Paused"); _; }

    constructor() {
        owner = msg.sender;
        minters[msg.sender] = true;
        emit MinterSet(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMinter(address minter, bool enabled) external onlyOwner {
        minters[minter] = enabled;
        emit MinterSet(minter, enabled);
    }

    function setBurner(address burner, bool enabled) external onlyOwner {
        burners[burner] = enabled;
        emit BurnerSet(burner, enabled);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function getRemainingDailyMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function mint(address to, uint256 amount) external onlyMinter whenNotPaused {
        require(to != address(0), "Zero address");
        require(amount > 0, "Zero amount");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "Allowance exceeded");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function burnFrom(address from, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "Allowance exceeded");
            allowance[from][msg.sender] = allowed - amount;
        }
        _burn(from, amount);
    }

    function burnFromByBurner(address from, uint256 amount) external onlyBurner whenNotPaused {
        _burn(from, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
