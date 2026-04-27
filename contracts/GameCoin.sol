// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GameCoin
 * @notice ERC-20 on-chain token for Rug Pull Run.
 *         Players mint GC themselves to upgrade characters.
 *         1 in-game coin = 5 GC (reference rate, enforced in UI).
 *         GC is burned by CharacterUpgrade when player upgrades.
 */
contract GameCoin {

    string public constant name     = "GameCoin";
    string public constant symbol   = "GC";
    uint8  public constant decimals = 0;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previous, address indexed next);

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Public mint — player calls this themselves ───────────────────────────
    function mint(uint256 amount) external {
        require(amount > 0, "Zero amount");
        totalSupply           += amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(0), msg.sender, amount);
    }

    // ─── ERC-20 ───────────────────────────────────────────────────────────────
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

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Transfer to zero");
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }

    // ─── Burn (used by CharacterUpgrade) ─────────────────────────────────────
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply           -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function burnFrom(address from, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "Allowance exceeded");
            allowance[from][msg.sender] = allowed - amount;
        }
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        totalSupply     -= amount;
        emit Transfer(from, address(0), amount);
    }
}
