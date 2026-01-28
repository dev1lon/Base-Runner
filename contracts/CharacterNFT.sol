// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title Base Runner Character NFT (Soulbound)
 * @notice ERC-721 NFT collection for Base Runner game characters
 * @dev All NFTs are soulbound (non-transferable) except by admin
 * @dev New characters can be added by admin
 * @dev Minting requires server signature (anti-cheat)
 */
contract CharacterNFT is ERC721, ERC721Enumerable, Ownable {
    using Strings for uint256;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============================================
    // Types
    // ============================================

    enum Rarity {
        COMMON,     // 0
        UNCOMMON,   // 1
        RARE,       // 2
        EPIC,       // 3
        LEGENDARY   // 4
    }

    struct CharacterType {
        string name;
        Rarity rarity;
        uint256 price;      // Price in game coins (display only, backend handles actual deduction)
        bool exists;
    }

    struct CharacterData {
        uint8 characterType;
        Rarity rarity;
        uint256 mintedAt;
    }

    // ============================================
    // State Variables
    // ============================================

    // Token ID counter
    uint256 private _nextTokenId;

    // Base URI for metadata
    string private _baseTokenURI;

    // Character data for each token
    mapping(uint256 => CharacterData) public characters;

    // Track free mint per wallet (only first character is free)
    mapping(address => bool) public hasClaimedFreeMint;

    // Track which character types each wallet owns
    mapping(address => mapping(uint8 => bool)) public ownsCharacterType;

    // Character types registry
    mapping(uint8 => CharacterType) public characterTypes;

    // Maximum character type ID
    uint8 public maxCharacterType;

    // Free character type ID
    uint8 public freeCharacterId;

    // Server signer address
    address public serverSigner;

    // Used nonces (prevent replay)
    mapping(bytes32 => bool) public usedNonces;

    // ============================================
    // Events
    // ============================================

    event CharacterMinted(
        address indexed owner,
        uint256 indexed tokenId,
        uint8 characterType,
        Rarity rarity
    );

    event CharacterTypeAdded(
        uint8 indexed characterType,
        string name,
        Rarity rarity,
        uint256 price
    );

    event ServerSignerUpdated(address indexed newSigner);

    // ============================================
    // Errors
    // ============================================

    error SoulboundToken();
    error AlreadyClaimedFreeMint();
    error AlreadyOwnsCharacterType();
    error InvalidCharacterType();
    error InvalidSignature();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error FreeCharacterNotSet();

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address _serverSigner,
        string memory baseURI
    ) ERC721("Base Runner Characters", "BRCHAR") Ownable(msg.sender) {
        serverSigner = _serverSigner;
        _baseTokenURI = baseURI;

        // Initialize default characters
        // Price is for display only - actual coin deduction happens on backend
        _addCharacterType(0, "Vitalik", Rarity.COMMON, 0);       // Free starter
        _addCharacterType(1, "Trump", Rarity.LEGENDARY, 50);     // 50 coins

        // Set Vitalik as free character (required for new players)
        freeCharacterId = 0;
    }

    // ============================================
    // Mint Functions
    // ============================================

    /**
     * @notice Mint free starter character
     * @dev Limited to 1 per wallet, no signature required
     */
    function mintFreeCharacter() external {
        if (freeCharacterId > maxCharacterType) revert FreeCharacterNotSet();
        if (hasClaimedFreeMint[msg.sender]) revert AlreadyClaimedFreeMint();

        hasClaimedFreeMint[msg.sender] = true;
        _mintCharacter(msg.sender, freeCharacterId);
    }

    /**
     * @notice Mint character with server signature (paid with game coins)
     * @param characterType The type of character to mint
     * @param nonce Unique nonce from backend
     * @param expiry Timestamp after which signature expires
     * @param signature Server signature authorizing this mint
     */
    function mintWithSignature(
        uint8 characterType,
        bytes32 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        // Check expiry
        if (block.timestamp > expiry) revert SignatureExpired();

        // Check nonce not used
        if (usedNonces[nonce]) revert NonceAlreadyUsed();

        // Validate character type
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();

        // Check if user already owns this character type
        if (ownsCharacterType[msg.sender][characterType]) revert AlreadyOwnsCharacterType();

        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            characterType,
            nonce,
            expiry,
            block.chainid,
            address(this)
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        if (recoveredSigner != serverSigner) revert InvalidSignature();

        // Mark nonce as used
        usedNonces[nonce] = true;

        // Mint the character
        _mintCharacter(msg.sender, characterType);
    }

    // ============================================
    // View Functions
    // ============================================

    /**
     * @notice Check if wallet can claim free mint
     */
    function canClaimFreeMint(address wallet) external view returns (bool) {
        return !hasClaimedFreeMint[wallet] && freeCharacterId <= maxCharacterType;
    }

    /**
     * @notice Check if wallet owns a specific character type
     */
    function ownsCharacter(address wallet, uint8 characterType) external view returns (bool) {
        if (!characterTypes[characterType].exists) return false;
        return ownsCharacterType[wallet][characterType];
    }

    /**
     * @notice Get all character types owned by wallet as a bitmask
     */
    function getOwnedCharacterTypes(address wallet) external view returns (uint256) {
        uint256 mask = 0;
        for (uint8 i = 0; i <= maxCharacterType; i++) {
            if (ownsCharacterType[wallet][i]) {
                mask |= uint256(1 << i);
            }
        }
        return mask;
    }

    /**
     * @notice Get list of owned character type IDs
     */
    function getOwnedCharacterList(address wallet) external view returns (uint8[] memory) {
        uint8 count = 0;
        for (uint8 i = 0; i <= maxCharacterType; i++) {
            if (ownsCharacterType[wallet][i]) count++;
        }

        uint8[] memory owned = new uint8[](count);
        uint8 index = 0;
        for (uint8 i = 0; i <= maxCharacterType; i++) {
            if (ownsCharacterType[wallet][i]) {
                owned[index++] = i;
            }
        }
        return owned;
    }

    /**
     * @notice Get all token IDs owned by address
     */
    function getOwnedTokenIds(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        return tokenIds;
    }

    /**
     * @notice Get character data for a token
     */
    function getCharacter(uint256 tokenId) external view returns (
        uint8 characterType,
        Rarity rarity,
        string memory name,
        uint256 mintedAt
    ) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        CharacterData memory data = characters[tokenId];
        CharacterType memory charType = characterTypes[data.characterType];
        return (data.characterType, data.rarity, charType.name, data.mintedAt);
    }

    /**
     * @notice Get character type info
     */
    function getCharacterTypeInfo(uint8 characterType) external view returns (
        string memory name,
        Rarity rarity,
        uint256 price,
        bool exists
    ) {
        CharacterType memory ct = characterTypes[characterType];
        return (ct.name, ct.rarity, ct.price, ct.exists);
    }

    /**
     * @notice Get total number of character types
     */
    function getCharacterTypeCount() external view returns (uint8) {
        return maxCharacterType + 1;
    }

    /**
     * @notice Get token URI for metadata
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        CharacterData memory data = characters[tokenId];
        return string(abi.encodePacked(
            _baseTokenURI,
            uint256(data.characterType).toString(),
            "/",
            tokenId.toString()
        ));
    }

    // ============================================
    // Admin Functions
    // ============================================

    /**
     * @notice Add a new character type
     */
    function addCharacterType(
        string calldata name,
        Rarity rarity,
        uint256 price
    ) external onlyOwner {
        uint8 newType = maxCharacterType + 1;
        _addCharacterType(newType, name, rarity, price);
    }

    /**
     * @notice Update character type name
     */
    function updateCharacterName(uint8 characterType, string calldata name) external onlyOwner {
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        characterTypes[characterType].name = name;
    }

    /**
     * @notice Update character type price
     */
    function updateCharacterPrice(uint8 characterType, uint256 price) external onlyOwner {
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        characterTypes[characterType].price = price;
    }

    /**
     * @notice Set free character ID
     */
    function setFreeCharacter(uint8 characterType) external onlyOwner {
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        freeCharacterId = characterType;
    }

    /**
     * @notice Set base URI for metadata
     */
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    /**
     * @notice Update server signer address
     */
    function setServerSigner(address newSigner) external onlyOwner {
        serverSigner = newSigner;
        emit ServerSignerUpdated(newSigner);
    }

    /**
     * @notice Admin mint (bypasses signature)
     */
    function adminMint(address to, uint8 characterType) external onlyOwner {
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        _mintCharacter(to, characterType);
    }

    /**
     * @notice Admin transfer (only way to transfer soulbound)
     */
    function adminTransfer(address from, address to, uint256 tokenId) external onlyOwner {
        CharacterData memory data = characters[tokenId];
        ownsCharacterType[from][data.characterType] = false;
        ownsCharacterType[to][data.characterType] = true;
        _transfer(from, to, tokenId);
    }

    // ============================================
    // Internal Functions
    // ============================================

    function _addCharacterType(
        uint8 typeId,
        string memory name,
        Rarity rarity,
        uint256 price
    ) internal {
        characterTypes[typeId] = CharacterType({
            name: name,
            rarity: rarity,
            price: price,
            exists: true
        });

        if (typeId > maxCharacterType) {
            maxCharacterType = typeId;
        }

        emit CharacterTypeAdded(typeId, name, rarity, price);
    }

    function _mintCharacter(address to, uint8 characterType) internal {
        uint256 tokenId = _nextTokenId++;
        CharacterType memory charType = characterTypes[characterType];

        characters[tokenId] = CharacterData({
            characterType: characterType,
            rarity: charType.rarity,
            mintedAt: block.timestamp
        });

        ownsCharacterType[to][characterType] = true;

        _safeMint(to, tokenId);

        emit CharacterMinted(to, tokenId, characterType, charType.rarity);
    }

    // ============================================
    // Soulbound Override - Block transfers
    // ============================================

    /**
     * @dev Override to make tokens soulbound
     * Only minting and admin transfers allowed
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);

        // Allow minting (from == address(0))
        // Allow burning (to == address(0))
        // Block regular transfers
        if (from != address(0) && to != address(0)) {
            if (auth != owner()) {
                revert SoulboundToken();
            }
        }

        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
