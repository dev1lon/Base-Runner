// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Burnable {
    function burnFrom(address from, uint256 amount) external;
    function burn(uint256 amount) external;
    function mint(uint256 amount) external;
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface IXPToken {
    function mint(address to, uint256 amount) external;
}

/**
 * @title CharacterUpgrade
 * @notice Players burn GC tokens to earn XP for their characters.
 *         XP accumulates per (wallet, characterId) pair and determines level.
 *
 * Conversion: 1 GC burned → 1 XP earned (1:1)
 *
 * Per-level XP cost  →  Cumulative XP threshold for level
 *   Lv1: 100   →   100 XP  (+1 coin/1k pts, ×1.1 score)
 *   Lv2: 300   →   400 XP  (+2 coins,       ×1.2)
 *   Lv3: 700   → 1 100 XP  (+3 coins,       ×1.3)
 *   Lv4: 1500  → 2 600 XP  (+4 coins,       ×1.5)
 *   Lv5: 3000  → 5 600 XP  (+5 coins,       ×2.0)
 */
contract CharacterUpgrade {

    // ─── Config ──────────────────────────────────────────────────────────────
    address public owner;
    IERC20Burnable public gameCoin;
    IXPToken       public xpToken;

    // Level thresholds (cumulative XP required)
    uint256[6] private XP_THRESHOLDS = [0, 100, 400, 1100, 2600, 5600];

    // ─── State ───────────────────────────────────────────────────────────────
    // wallet → characterId → total XP earned
    mapping(address => mapping(uint256 => uint256)) public characterXP;

    // ─── Events ──────────────────────────────────────────────────────────────
    event CharacterUpgraded(
        address indexed player,
        uint256 indexed characterId,
        uint256 gcBurned,
        uint256 xpTotal,
        uint256 level
    );
    event ContractsSet(address gameCoin_, address xpToken_);
    event OwnershipTransferred(address indexed previous, address indexed next);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address gameCoin_, address xpToken_) {
        owner    = msg.sender;
        gameCoin = IERC20Burnable(gameCoin_);
        xpToken  = IXPToken(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    // ─── Ownership ───────────────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setContracts(address gameCoin_, address xpToken_) external onlyOwner {
        require(gameCoin_ != address(0) && xpToken_ != address(0), "Zero address");
        gameCoin = IERC20Burnable(gameCoin_);
        xpToken  = IXPToken(xpToken_);
        emit ContractsSet(gameCoin_, xpToken_);
    }

    // ─── Core: upgrade ───────────────────────────────────────────────────────
    /**
     * @param characterId  In-game character ID (0-based)
     * @param gcAmount     How many GC tokens to burn (= XP gained, 1:1)
     *
     * Caller must have approved this contract to spend gcAmount GC beforehand.
     */
    function upgrade(uint256 characterId, uint256 gcAmount) external {
        require(gcAmount > 0, "Zero GC amount");
        require(
            gameCoin.allowance(msg.sender, address(this)) >= gcAmount,
            "Approve GC first"
        );

        // Burn GC from caller
        gameCoin.burnFrom(msg.sender, gcAmount);

        // Mint XP to caller (1:1)
        xpToken.mint(msg.sender, gcAmount);

        // Record XP on this character
        characterXP[msg.sender][characterId] += gcAmount;
        uint256 totalXP = characterXP[msg.sender][characterId];
        uint256 lvl     = getLevel(totalXP);

        emit CharacterUpgraded(msg.sender, characterId, gcAmount, totalXP, lvl);
    }

    /**
     * @notice One-shot upgrade: mints fresh GC, burns it, mints XP, records level.
     *         No prior approval needed. Heavier gas (~200-250k) — single tx for player.
     */
    function mintAndUpgrade(uint256 characterId, uint256 gcAmount) external {
        require(gcAmount > 0, "Zero GC amount");

        // 1. Mint GC into this contract (consumes gas: storage write + event)
        gameCoin.mint(gcAmount);

        // 2. Burn the GC immediately (more gas: storage write + event)
        gameCoin.burn(gcAmount);

        // 3. Mint XP to caller (gas: storage write + event)
        xpToken.mint(msg.sender, gcAmount);

        // 4. Record XP on this character
        characterXP[msg.sender][characterId] += gcAmount;
        uint256 totalXP = characterXP[msg.sender][characterId];
        uint256 lvl     = getLevel(totalXP);

        emit CharacterUpgraded(msg.sender, characterId, gcAmount, totalXP, lvl);
    }

    // ─── View helpers ────────────────────────────────────────────────────────
    function getLevel(uint256 xp) public view returns (uint256) {
        for (uint256 i = 5; i >= 1; i--) {
            if (xp >= XP_THRESHOLDS[i]) return i;
        }
        return 0;
    }

    /**
     * @return lvl      Current level (0-5)
     * @return xp       XP accumulated for this character
     * @return xpNext   XP required for next level (0 if max level)
     * @return xpPrev   XP threshold of current level
     */
    function getCharacterInfo(address player, uint256 characterId)
        external
        view
        returns (uint256 lvl, uint256 xp, uint256 xpNext, uint256 xpPrev)
    {
        xp   = characterXP[player][characterId];
        lvl  = getLevel(xp);
        xpPrev = XP_THRESHOLDS[lvl];
        xpNext = lvl < 5 ? XP_THRESHOLDS[lvl + 1] : 0;
    }

    /**
     * @notice Batch-read levels for multiple characters.
     */
    function getCharacterLevels(address player, uint256[] calldata characterIds)
        external
        view
        returns (uint256[] memory levels, uint256[] memory xps)
    {
        levels = new uint256[](characterIds.length);
        xps    = new uint256[](characterIds.length);
        for (uint256 i = 0; i < characterIds.length; i++) {
            xps[i]    = characterXP[player][characterIds[i]];
            levels[i] = getLevel(xps[i]);
        }
    }
}
