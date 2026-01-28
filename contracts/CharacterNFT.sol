// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title Base Runner Character NFT (Soulbound)
 * @notice ERC-721 NFT collection for Base Runner game characters
 * @dev All NFTs are soulbound (non-transferable) except by admin
 * @dev Purchases are paid with GameCoin (soulbound ERC-20)
 */

interface IGameCoin {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

contract CharacterNFT is ERC721, ERC721Enumerable, Ownable {
    using Strings for uint256;

    // ============================================
    // Types
    // ============================================

    enum Rarity {
        COMMON,     // 0
        RARE,       // 1
        EPIC,       // 2
        LEGENDARY   // 3
    }

    struct CharacterType {
        string name;
        Rarity rarity;
        uint256 price;      // Price in GameCoins (0 = free)
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

    // GameCoin contract
    IGameCoin public gameCoin;

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

    // Total coins burned (stats)
    uint256 public totalCoinsBurned;

    // ============================================
    // Events
    // ============================================

    event CharacterMinted(
        address indexed owner,
        uint256 indexed tokenId,
        uint8 characterType,
        Rarity rarity,
        uint256 pricePaid
    );

    event CharacterTypeAdded(
        uint8 indexed characterType,
        string name,
        Rarity rarity,
        uint256 price
    );

    event CharacterTypeUpdated(
        uint8 indexed characterType,
        string name,
        uint256 price
    );

    event GameCoinUpdated(address indexed newCoin);

    // ============================================
    // Errors
    // ============================================

    error SoulboundToken();
    error AlreadyClaimedFreeMint();
    error AlreadyOwnsCharacterType();
    error InvalidCharacterType();
    error InsufficientCoins();
    error FreeCharacterNotSet();
    error GameCoinNotSet();
    error TransferFailed();

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address _gameCoin,
        string memory baseURI
    ) ERC721("Base Runner Characters", "BRCHAR") Ownable(msg.sender) {
        gameCoin = IGameCoin(_gameCoin);
        _baseTokenURI = baseURI;

        // Initialize default characters
        _addCharacterType(0, "Vitalik", Rarity.COMMON, 0);       // Free starter
        _addCharacterType(1, "Trump", Rarity.LEGENDARY, 50);     // 50 coins

        // Set Vitalik as free character (required for new players)
        freeCharacterId = 0;
    }

    // ============================================
    // Mint Functions
    // ============================================

    /**
     * @notice Mint free starter character (Vitalik)
     * @dev Limited to 1 per wallet, no coins required
     */
    function mintFreeCharacter() external {
        if (freeCharacterId > maxCharacterType) revert FreeCharacterNotSet();
        if (hasClaimedFreeMint[msg.sender]) revert AlreadyClaimedFreeMint();

        hasClaimedFreeMint[msg.sender] = true;
        _mintCharacter(msg.sender, freeCharacterId, 0);
    }

    /**
     * @notice Mint character by paying with GameCoins
     * @param characterType The type of character to mint
     * @dev User must have approved this contract as spender in GameCoin
     *      OR GameCoin must have this contract as approvedSpender
     */
    function mintWithCoins(uint8 characterType) external {
        // Validate character type
        if (!characterTypes[characterType].exists) revert InvalidCharacterType();
        
        // Check if user already owns this character type
        if (ownsCharacterType[msg.sender][characterType]) revert AlreadyOwnsCharacterType();

        uint256 price = characterTypes[characterType].price;

        // If free, just check they haven't claimed free mint already (unless it's a different free char)
        if (price == 0) {
            // Free characters can only be minted once total via mintFreeCharacter
            // This prevents minting free chars via mintWithCoins
            revert InsufficientCoins();
        }

        // Check GameCoin is set
        if (address(gameCoin) == address(0)) revert GameCoinNotSet();

        // Check user has enough coins
        if (gameCoin.balanceOf(msg.sender) < price) revert InsufficientCoins();

        // Transfer coins to this contract (GameCoin.spend or transferFrom)
        bool success = gameCoin.transferFrom(msg.sender, address(this), price);
        if (!success) revert TransferFailed();

        // Burn the coins
        gameCoin.burn(price);
        totalCoinsBurned += price;

        // Mint the character
        _mintCharacter(msg.sender, characterType, price);
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
     * @notice Get character price
     */
    function getCharacterPrice(uint8 characterType) external view returns (uint256) {
        if (!characterTypes[characterType].exists) return 0;
        return characterTypes[characterType].price;
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
     * @notice Get character info for a token
     */
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

    /**
     * @notice Get all available character types
     */
    function getCharacterTypes() external view returns (
        uint8[] memory ids,
        string[] memory names,
        Rarity[] memory rarities,
        uint256[] memory prices
    ) {
        uint8 count = maxCharacterType + 1;
        ids = new uint8[](count);
        names = new string[](count);
        rarities = new Rarity[](count);
        prices = new uint256[](count);

        for (uint8 i = 0; i < count; i++) {
            ids[i] = i;
            names[i] = characterTypes[i].name;
            rarities[i] = characterTypes[i].rarity;
            prices[i] = characterTypes[i].price;
        }
    }

    // ============================================
    // Admin Functions
    // ============================================

    /**
     * @notice Add new character type
     */
    function addCharacterType(
        string memory name,
        Rarity rarity,
        uint256 price
    ) external onlyOwner {
        uint8 newId = maxCharacterType + 1;
        _addCharacterType(newId, name, rarity, price);
    }

    /**
     * @notice Update character name
     */
    function updateCharacterName(uint8 characterType, string memory name) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        characterTypes[characterType].name = name;
        emit CharacterTypeUpdated(characterType, name, characterTypes[characterType].price);
    }

    /**
     * @notice Update character price
     */
    function updateCharacterPrice(uint8 characterType, uint256 price) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        characterTypes[characterType].price = price;
        emit CharacterTypeUpdated(characterType, characterTypes[characterType].name, price);
    }

    /**
     * @notice Set free character type
     */
    function setFreeCharacter(uint8 characterType) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        freeCharacterId = characterType;
    }

    /**
     * @notice Set base URI for metadata
     */
    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    /**
     * @notice Set GameCoin contract address
     */
    function setGameCoin(address _gameCoin) external onlyOwner {
        gameCoin = IGameCoin(_gameCoin);
        emit GameCoinUpdated(_gameCoin);
    }

    /**
     * @notice Admin mint (for airdrops, promotions)
     */
    function adminMint(address to, uint8 characterType) external onlyOwner {
        require(characterTypes[characterType].exists, "Character type does not exist");
        require(!ownsCharacterType[to][characterType], "Already owns this character");
        _mintCharacter(to, characterType, 0);
    }

    /**
     * @notice Admin transfer (bypass soulbound)
     */
    function adminTransfer(address from, address to, uint256 tokenId) external onlyOwner {
        _transfer(from, to, tokenId);
    }

    // ============================================
    // Internal Functions
    // ============================================

    function _addCharacterType(
        uint8 id,
        string memory name,
        Rarity rarity,
        uint256 price
    ) internal {
        characterTypes[id] = CharacterType({
            name: name,
            rarity: rarity,
            price: price,
            exists: true
        });

        if (id > maxCharacterType) {
            maxCharacterType = id;
        }

        emit CharacterTypeAdded(id, name, rarity, price);
    }

    function _mintCharacter(address to, uint8 characterType, uint256 pricePaid) internal {
        uint256 tokenId = _nextTokenId++;
        
        CharacterType memory charType = characterTypes[characterType];
        
        characters[tokenId] = CharacterData({
            characterType: characterType,
            rarity: charType.rarity,
            mintedAt: block.timestamp
        });
        
        ownsCharacterType[to][characterType] = true;
        
        _safeMint(to, tokenId);
        
        emit CharacterMinted(to, tokenId, characterType, charType.rarity, pricePaid);
    }

    // ============================================
    // Soulbound Override
    // ============================================

    /**
     * @notice Override to make tokens soulbound
     * @dev Only owner can transfer (via adminTransfer)
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override(ERC721, ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from = address(0))
        if (from == address(0)) {
            return super._update(to, tokenId, auth);
        }
        
        // Allow burning (to = address(0))
        if (to == address(0)) {
            return super._update(to, tokenId, auth);
        }
        
        // Only owner can transfer
        if (msg.sender != owner()) {
            revert SoulboundToken();
        }
        
        return super._update(to, tokenId, auth);
    }

    // ============================================
    // Required Overrides
    // ============================================

    function _increaseBalance(
        address account,
        uint128 amount
    ) internal virtual override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);
        
        CharacterData memory data = characters[tokenId];
        string memory baseURI = _baseURI();
        
        // URI format: baseURI/characterType/tokenId
        return bytes(baseURI).length > 0
            ? string(abi.encodePacked(baseURI, uint256(data.characterType).toString(), "/", tokenId.toString()))
            : "";
    }
}
