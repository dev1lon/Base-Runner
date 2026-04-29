// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGameCoinV2 {
    function burnFrom(address from, uint256 amount) external;
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IXPTokenV2 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title CharacterUpgradeV2
 * @notice Burns real GC from the player and records character XP.
 *         `upgradeWithPermit` is a one-transaction user flow: permit + burn + XP.
 */
contract CharacterUpgradeV2 {
    address public owner;
    IGameCoinV2 public gameCoin;
    IXPTokenV2 public xpToken;

    uint256[6] private XP_THRESHOLDS = [0, 100, 400, 1100, 2600, 5600];
    mapping(address => mapping(uint256 => uint256)) public characterXP;

    event CharacterUpgraded(
        address indexed player,
        uint256 indexed characterId,
        uint256 gcBurned,
        uint256 xpTotal,
        uint256 level
    );
    event ContractsSet(address gameCoin, address xpToken);
    event OwnershipTransferred(address indexed previous, address indexed next);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(address gameCoin_, address xpToken_) {
        owner = msg.sender;
        gameCoin = IGameCoinV2(gameCoin_);
        xpToken = IXPTokenV2(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setContracts(address gameCoin_, address xpToken_) external onlyOwner {
        require(gameCoin_ != address(0) && xpToken_ != address(0), "Zero address");
        gameCoin = IGameCoinV2(gameCoin_);
        xpToken = IXPTokenV2(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    function upgrade(uint256 characterId, uint256 gcAmount) public {
        require(gcAmount > 0, "Zero GC amount");
        gameCoin.burnFrom(msg.sender, gcAmount);
        _recordUpgrade(msg.sender, characterId, gcAmount);
    }

    function upgradeWithPermit(
        uint256 characterId,
        uint256 gcAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(gcAmount > 0, "Zero GC amount");
        gameCoin.permit(msg.sender, address(this), gcAmount, deadline, v, r, s);
        gameCoin.burnFrom(msg.sender, gcAmount);
        _recordUpgrade(msg.sender, characterId, gcAmount);
    }

    function _recordUpgrade(address player, uint256 characterId, uint256 gcAmount) internal {
        xpToken.mint(player, gcAmount);
        characterXP[player][characterId] += gcAmount;
        uint256 totalXP = characterXP[player][characterId];
        uint256 lvl = getLevel(totalXP);
        emit CharacterUpgraded(player, characterId, gcAmount, totalXP, lvl);
    }

    function getLevel(uint256 xp) public view returns (uint256) {
        for (uint256 i = 5; i > 0; i--) {
            if (xp >= XP_THRESHOLDS[i]) return i;
        }
        return 0;
    }

    function getCharacterInfo(address player, uint256 characterId)
        external
        view
        returns (uint256 lvl, uint256 xp, uint256 xpNext, uint256 xpPrev)
    {
        xp = characterXP[player][characterId];
        lvl = getLevel(xp);
        xpPrev = XP_THRESHOLDS[lvl];
        xpNext = lvl < 5 ? XP_THRESHOLDS[lvl + 1] : 0;
    }

    function getCharacterLevels(address player, uint256[] calldata characterIds)
        external
        view
        returns (uint256[] memory levels, uint256[] memory xps)
    {
        levels = new uint256[](characterIds.length);
        xps = new uint256[](characterIds.length);
        for (uint256 i = 0; i < characterIds.length; i++) {
            xps[i] = characterXP[player][characterIds[i]];
            levels[i] = getLevel(xps[i]);
        }
    }
}
