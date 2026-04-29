// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGameCoinV3 {
    function burnFromByBurner(address from, uint256 amount) external;
}

interface IXPTokenV3 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title CharacterUpgradeV3
 * @notice One-call character upgrade. The contract burns GC through GameCoinV3 burner role.
 */
contract CharacterUpgradeV3 {
    address public owner;
    IGameCoinV3 public gameCoin;
    IXPTokenV3 public xpToken;

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
        require(gameCoin_ != address(0) && xpToken_ != address(0), "Zero address");
        owner = msg.sender;
        gameCoin = IGameCoinV3(gameCoin_);
        xpToken = IXPTokenV3(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setContracts(address gameCoin_, address xpToken_) external onlyOwner {
        require(gameCoin_ != address(0) && xpToken_ != address(0), "Zero address");
        gameCoin = IGameCoinV3(gameCoin_);
        xpToken = IXPTokenV3(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    function upgrade(uint256 characterId, uint256 gcAmount) external {
        require(gcAmount > 0, "Zero GC amount");
        gameCoin.burnFromByBurner(msg.sender, gcAmount);
        xpToken.mint(msg.sender, gcAmount);
        characterXP[msg.sender][characterId] += gcAmount;

        uint256 totalXP = characterXP[msg.sender][characterId];
        uint256 lvl = getLevel(totalXP);
        emit CharacterUpgraded(msg.sender, characterId, gcAmount, totalXP, lvl);
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
