// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GameCoin
 * @notice In-game ERC-20 token for Rug Pull Run.
 *         Players convert off-chain coins to GC via a backend-signed voucher.
 *         1 off-chain coin = 5 GC.  GC is burned by CharacterUpgrade on upgrade.
 */
contract GameCoin {

    // ─── ERC-20 state ────────────────────────────────────────────────────────
    string public constant name     = "GameCoin";
    string public constant symbol   = "GC";
    uint8  public constant decimals = 0;          // whole tokens only

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─── Access control ──────────────────────────────────────────────────────
    address public owner;
    address public signer;          // backend wallet that signs mint vouchers

    // ─── Replay protection ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedVouchers;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event Minted(address indexed to, uint256 amount, bytes32 voucherHash);
    event Burned(address indexed from, uint256 amount);
    event SignerUpdated(address indexed newSigner);
    event OwnershipTransferred(address indexed previous, address indexed next);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address signer_) {
        owner  = msg.sender;
        signer = signer_;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    // ─── Ownership ───────────────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Zero address");
        signer = newSigner;
        emit SignerUpdated(newSigner);
    }

    // ─── ERC-20 core ─────────────────────────────────────────────────────────
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
        totalSupply;
        emit Transfer(from, to, amount);
    }

    // ─── Voucher mint (called by player, authorized by backend signature) ────
    /**
     * @param to       Recipient (must equal msg.sender to prevent front-running)
     * @param amount   GC tokens to mint
     * @param nonce    Unique nonce from backend (one-time use)
     * @param v,r,s    ECDSA signature by `signer` over keccak256(to, amount, nonce, chainId, address(this))
     */
    function mintWithVoucher(
        address to,
        uint256 amount,
        uint256 nonce,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        require(to == msg.sender, "Must mint to self");
        require(amount > 0, "Zero amount");

        bytes32 hash = keccak256(abi.encodePacked(to, amount, nonce, block.chainid, address(this)));
        require(!usedVouchers[hash], "Voucher already used");

        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = ecrecover(ethHash, v, r, s);
        require(recovered != address(0) && recovered == signer, "Invalid signature");

        usedVouchers[hash] = true;
        totalSupply        += amount;
        balanceOf[to]      += amount;
        emit Transfer(address(0), to, amount);
        emit Minted(to, amount, hash);
    }

    // ─── Burn (called by CharacterUpgrade via transferFrom + burnFrom) ───────
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply           -= amount;
        emit Transfer(msg.sender, address(0), amount);
        emit Burned(msg.sender, amount);
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
        emit Burned(from, amount);
    }
}
