// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GameCoin
 * @notice Soulbound (non-transferable) ERC-20 token for Base Runner game
 * @dev Coins can only be:
 *      - Minted by authorized minters (game backend)
 *      - Spent (transferred) to approved spender contracts (NFT shop)
 *      - Burned
 */
contract GameCoin is ERC20, Ownable {
    
    // ============================================
    // State
    // ============================================
    
    /// @notice Addresses allowed to mint coins (backend signer)
    mapping(address => bool) public minters;
    
    /// @notice Addresses allowed to receive coins (NFT contracts, etc.)
    mapping(address => bool) public approvedSpenders;
    
    /// @notice Nonces to prevent replay attacks on minting
    mapping(bytes32 => bool) public usedNonces;
    
    /// @notice Server signer address for mint signatures
    address public serverSigner;
    
    // ============================================
    // Events
    // ============================================
    
    event MinterUpdated(address indexed minter, bool status);
    event SpenderUpdated(address indexed spender, bool status);
    event CoinsMinted(address indexed to, uint256 amount, bytes32 nonce);
    event CoinsBurned(address indexed from, uint256 amount);
    event CoinsSpent(address indexed from, address indexed spender, uint256 amount);
    
    // ============================================
    // Errors
    // ============================================
    
    error SoulboundToken();
    error NotAuthorizedMinter();
    error NotApprovedSpender();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error SignatureExpired();
    error ZeroAddress();
    error ZeroAmount();
    
    // ============================================
    // Constructor
    // ============================================
    
    constructor(
        address _serverSigner
    ) ERC20("Base Runner Coins", "BRCOIN") Ownable(msg.sender) {
        if (_serverSigner == address(0)) revert ZeroAddress();
        serverSigner = _serverSigner;
    }
    
    // ============================================
    // Mint Functions
    // ============================================
    
    /**
     * @notice Mint coins with server signature (main method)
     * @param to Recipient address
     * @param amount Amount of coins to mint
     * @param nonce Unique nonce to prevent replay
     * @param expiry Signature expiration timestamp
     * @param signature Server signature
     */
    function mintWithSignature(
        address to,
        uint256 amount,
        bytes32 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        
        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            to,
            amount,
            nonce,
            expiry,
            block.chainid,
            address(this)
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));
        
        address recovered = _recoverSigner(ethSignedHash, signature);
        if (recovered != serverSigner) revert InvalidSignature();
        
        usedNonces[nonce] = true;
        _mint(to, amount);
        
        emit CoinsMinted(to, amount, nonce);
    }
    
    /**
     * @notice Direct mint by authorized minter (for batch operations)
     */
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert NotAuthorizedMinter();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        
        _mint(to, amount);
        emit CoinsMinted(to, amount, bytes32(0));
    }
    
    // ============================================
    // Spend Functions (for NFT purchases)
    // ============================================
    
    /**
     * @notice Spend coins to an approved spender (NFT contract)
     * @dev Called by user, transfers to spender then spender can burn or hold
     */
    function spend(address spender, uint256 amount) external {
        if (!approvedSpenders[spender]) revert NotApprovedSpender();
        if (amount == 0) revert ZeroAmount();
        
        _transfer(msg.sender, spender, amount);
        emit CoinsSpent(msg.sender, spender, amount);
    }
    
    /**
     * @notice Burn coins (anyone can burn their own)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit CoinsBurned(msg.sender, amount);
    }
    
    // ============================================
    // Soulbound Override
    // ============================================
    
    /**
     * @notice Override transfer to make token soulbound
     * @dev Only allows:
     *      - Minting (from = address(0))
     *      - Burning (to = address(0))
     *      - Spending to approved spenders
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override {
        // Allow minting
        if (from == address(0)) {
            super._update(from, to, value);
            return;
        }
        
        // Allow burning
        if (to == address(0)) {
            super._update(from, to, value);
            return;
        }
        
        // Allow transfer to approved spenders only
        if (approvedSpenders[to]) {
            super._update(from, to, value);
            return;
        }
        
        // Block all other transfers
        revert SoulboundToken();
    }
    
    // ============================================
    // Admin Functions
    // ============================================
    
    function setServerSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        serverSigner = _signer;
    }
    
    function setMinter(address minter, bool status) external onlyOwner {
        minters[minter] = status;
        emit MinterUpdated(minter, status);
    }
    
    function setApprovedSpender(address spender, bool status) external onlyOwner {
        approvedSpenders[spender] = status;
        emit SpenderUpdated(spender, status);
    }
    
    // ============================================
    // Internal
    // ============================================
    
    function _recoverSigner(
        bytes32 hash,
        bytes calldata signature
    ) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        
        if (v < 27) v += 27;
        
        return ecrecover(hash, v, r, s);
    }
    
    // ============================================
    // View Functions
    // ============================================
    
    function decimals() public pure override returns (uint8) {
        return 0; // Whole coins only, no decimals
    }
}
