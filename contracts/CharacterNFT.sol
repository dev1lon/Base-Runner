// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/token/ERC721/ERC721.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/access/Ownable.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/utils/Strings.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/utils/cryptography/ECDSA.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title Rug Pull Run Character NFT (Soulbound)
 * @notice ERC-721 NFT collection for Rug Pull Run game characters
 * @dev Soulbound (non-transferable). Purchases verified via backend signature.
 *      Check-in enforced on-chain (24h cooldown). Streak tracked on backend.
 */
contract CharacterNFT is ERC721, ERC721Enumerable, Ownable {
    using Strings for uint256;
    using ECDSA for bytes32;

    // ============================================
    // Types
    // ============================================

    enum Rarity { COMMON, RARE, EPIC, LEGENDARY }

    struct CharacterType {
        string name;
        Rarity rarity;
        string metadataURI;
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

    uint256 private _nextTokenId;
    string private _baseTokenURI;

    address public trustedSigner;

    mapping(uint256 => CharacterData) public characters;
    mapping(address => bool) public hasClaimedFreeMint;
    mapping(address => mapping(uint8 => bool)) public ownsCharacterType;
    mapping(uint8 => CharacterType) public characterTypes;
    mapping(bytes32 => bool) public usedNonces;

    // Check-in
    uint256 public constant CHECKIN_COOLDOWN = 24 hours;
    mapping(address => uint256) public lastCheckin;

    uint8 public maxCharacterType;
    uint8 public freeCharacterId;

    // ============================================
    // Events
    // ============================================

    event CharacterMinted(address indexed owner, uint256 indexed tokenId, uint8 characterType, Rarity rarity);
    event CharacterTypeAdded(uint8 indexed characterType, string name, Rarity rarity);
    event TrustedSignerUpdated(address indexed newSigner);
    event CheckedIn(address indexed user, uint256 timestamp);

    // ============================================
    // Errors
    // ============================================

    error SoulboundToken();
    error AlreadyClaimedFreeMint();
    error AlreadyOwnsCharacterType();
    error InvalidCharacterType();
    error FreeCharacterNotSet();
    error InvalidSignature();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error CheckinTooEarly(uint256 nextCheckinAt);

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address _trustedSigner,
        string memory baseURI
    ) ERC721("Rug Pull Run Characters", "RPRCHAR") Ownable(msg.sender) {
        trustedSigner = _trustedSigner;
        _baseTokenURI = baseURI;
    }

    // ============================================
    // Check-in
    // ============================================

    function checkIn() external {
        uint256 nextAllowed = lastCheckin[msg.sender] + CHECKIN_COOLDOWN;
        if (block.timestamp < nextAllowed) revert CheckinTooEarly(nextAllowed);
        lastCheckin[msg.sender] = block.timestamp;
        emit CheckedIn(msg.sender, block.timestamp);
    }

    function canCheckIn(address wallet) external view returns (bool) {
        return block.timestamp >= lastCheckin[wallet] + CHECKIN_COOLDOWN;
    }

    // ============================================
    // Mint Functions
    // ============================================

    function mintFreeCharacter() external {
        if (!characterTypes[freeCharacterId].exists) revert FreeCharacterNotSet();
        if (hasClaimedFreeMint[msg.sender]) revert AlreadyClaimedFreeMint();
        if (ownsCharacterType[msg.sender][freeCharacterId]) revert AlreadyOwnsCharacterType();

        hasClaimedFreeMint[msg.sender] = true;
        _mintCharacter(msg.sender, freeCharacterId);
    }

    function mintWithSignature(
        uint8 characterType,
        bytes32 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (block.timestamp > expiry) revert SignatureExpired();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        if (ownsCharacterType[msg.sender][characterType]) revert AlreadyOwnsCharacterType();

        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            uint256(characterType),
            nonce,
            expiry,
            block.chainid,
            address(this)
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, signature);
        if (recovered != trustedSigner) revert InvalidSignature();

        usedNonces[nonce] = true;
        _mintCharacter(msg.sender, characterType);
    }

    // ============================================
    // View Functions
    // ============================================

    function canClaimFreeMint(address wallet) external view returns (bool) {
        return !hasClaimedFreeMint[wallet]
            && characterTypes[freeCharacterId].exists
            && !ownsCharacterType[wallet][freeCharacterId];
    }

    function ownsCharacter(address wallet, uint8 characterType) external view returns (bool) {
        if (!characterTypes[characterType].exists) return false;
        return ownsCharacterType[wallet][characterType];
    }

    function getOwnedCharacterList(address wallet) external view returns (uint8[] memory) {
        uint8 count = 0;
        for (uint8 i = 0; i <= maxCharacterType; i++) {
            if (ownsCharacterType[wallet][i]) count++;
        }
        uint8[] memory owned = new uint8[](count);
        uint8 index = 0;
        for (uint8 i = 0; i <= maxCharacterType; i++) {
            if (ownsCharacterType[wallet][i]) owned[index++] = i;
        }
        return owned;
    }

    function getCharacter(uint256 tokenId) external view returns (
        uint8 characterType,
        string memory name,
        Rarity rarity,
        uint256 mintedAt
    ) {
        CharacterData memory data = characters[tokenId];
        CharacterType memory charType = characterTypes[data.characterType];
        return (data.characterType, charType.name, data.rarity, data.mintedAt);
    }

    function getCharacterTypes() external view returns (
        uint8[] memory ids,
        string[] memory names,
        Rarity[] memory rarities
    ) {
        uint8 count = maxCharacterType + 1;
        ids = new uint8[](count);
        names = new string[](count);
        rarities = new Rarity[](count);
        for (uint8 i = 0; i < count; i++) {
            ids[i] = i;
            names[i] = characterTypes[i].name;
            rarities[i] = characterTypes[i].rarity;
        }
    }

    // ============================================
    // Admin Functions
    // ============================================

    function setTrustedSigner(address _signer) external onlyOwner {
        trustedSigner = _signer;
        emit TrustedSignerUpdated(_signer);
    }

    function addCharacterType(
        uint8 id,
        string memory name,
        Rarity rarity,
        string memory metadataURI
    ) external onlyOwner {
        require(!characterTypes[id].exists, "Character type already exists");
        _addCharacterType(id, name, rarity, metadataURI);
    }

    function setCharacterMetadataURI(uint8 characterType, string memory metadataURI) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        characterTypes[characterType].metadataURI = metadataURI;
    }

    function updateCharacterName(uint8 characterType, string memory name) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        characterTypes[characterType].name = name;
    }

    function setFreeCharacter(uint8 characterType) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        freeCharacterId = characterType;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function adminMint(address to, uint8 characterType) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        require(!ownsCharacterType[to][characterType], "Already owns this character");
        _mintCharacter(to, characterType);
    }

    // ============================================
    // Internal
    // ============================================

    function _addCharacterType(
        uint8 id,
        string memory name,
        Rarity rarity,
        string memory metadataURI
    ) internal {
        characterTypes[id] = CharacterType({
            name: name,
            rarity: rarity,
            metadataURI: metadataURI,
            exists: true
        });
        if (id > maxCharacterType) maxCharacterType = id;
        emit CharacterTypeAdded(id, name, rarity);
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
    // Soulbound Overrides
    // ============================================

    function _update(address to, uint256 tokenId, address auth)
        internal virtual override(ERC721, ERC721Enumerable) returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundToken();
        }
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 amount)
        internal virtual override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ERC721, ERC721Enumerable) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);
        CharacterData memory data = characters[tokenId];
        CharacterType memory charType = characterTypes[data.characterType];
        if (bytes(charType.metadataURI).length > 0) return charType.metadataURI;
        string memory baseURI = _baseURI();
        return bytes(baseURI).length > 0
            ? string(abi.encodePacked(baseURI, uint256(data.characterType).toString()))
            : "";
    }
}
