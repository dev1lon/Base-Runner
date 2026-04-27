// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title XPToken
 * @notice Soul-bound experience token for Rug Pull Run characters.
 *         Minted exclusively by CharacterUpgrade when a player burns GC.
 *         Non-transferable: XP stays with the wallet that earned it.
 */
contract XPToken {

    // ─── ERC-20 state ────────────────────────────────────────────────────────
    string public constant name     = "Rug Pull Run XP";
    string public constant symbol   = "XP";
    uint8  public constant decimals = 0;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    // ─── Access control ──────────────────────────────────────────────────────
    address public owner;
    address public upgradeContract;   // only address allowed to mint

    // ─── Events ──────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event UpgradeContractSet(address indexed upgradeContract_);
    event OwnershipTransferred(address indexed previous, address indexed next);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner()   { require(msg.sender == owner,           "Not owner");    _; }
    modifier onlyUpgrade() { require(msg.sender == upgradeContract, "Not upgrader"); _; }

    // ─── Ownership ───────────────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setUpgradeContract(address upgradeContract_) external onlyOwner {
        require(upgradeContract_ != address(0), "Zero address");
        upgradeContract = upgradeContract_;
        emit UpgradeContractSet(upgradeContract_);
    }

    // ─── Mint (only CharacterUpgrade) ────────────────────────────────────────
    function mint(address to, uint256 amount) external onlyUpgrade {
        require(to != address(0), "Zero address");
        totalSupply      += amount;
        balanceOf[to]    += amount;
        emit Transfer(address(0), to, amount);
    }

    // ─── ERC-20 transfers disabled (soul-bound) ──────────────────────────────
    function transfer(address, uint256) external pure returns (bool) {
        revert("XP is non-transferable");
    }

    function approve(address, uint256) external pure returns (bool) {
        revert("XP is non-transferable");
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("XP is non-transferable");
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }
}
