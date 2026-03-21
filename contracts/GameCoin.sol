// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// For Remix - use GitHub URLs
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.0/contracts/token/ERC20/ERC20.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.0/contracts/access/Ownable.sol";

/**
 * @title GameCoin
 * @notice Soulbound ERC-20 token for Base Runner game
 * @dev Includes: coins + check-in + buy with ETH
 */
contract GameCoin is ERC20, Ownable {
    
    // ============================================
    // Constants
    // ============================================
    
    uint256 public constant CHECKIN_COOLDOWN = 24 hours;
    uint256 public constant STREAK_TIMEOUT = 36 hours;
    
    // ============================================
    // State - Minting
    // ============================================
    
    mapping(address => bool) public minters;
    mapping(address => bool) public approvedSpenders;
    address public serverSigner;
    bool public paused;
    uint256 public maxMintAmount = 100;
    uint256 public dailyMintLimit = 500;
    mapping(address => uint256) public dailyMinted;
    mapping(address => uint256) public lastMintDay;
    
    // ============================================
    // State - Check-in
    // ============================================
    
    mapping(address => uint256) public lastCheckin;
    mapping(address => uint256) public checkinCount;
    mapping(address => uint256) public currentStreak;
    uint256 public baseReward = 1;
    uint256 public streakBonusEvery = 5;
    uint256 public streakBonusAmount = 1;
    
    // ============================================
    // State - Buy with ETH
    // ============================================
    
    uint256 public coinPriceUSD = 0.5 ether;
    uint256 public ethPriceUSD = 2500 ether;
    address public treasury;
    bool public saleEnabled = true;
    
    // ============================================
    // Events
    // ============================================
    
    event MinterUpdated(address indexed minter, bool status);
    event SpenderUpdated(address indexed spender, bool status);
    event CoinsMinted(address indexed to, uint256 amount);
    event CoinsBurned(address indexed from, uint256 amount);
    event CoinsPurchased(address indexed buyer, uint256 ethAmount, uint256 coinAmount);
    event CheckedIn(address indexed user, uint256 streak, uint256 reward);
    
    // ============================================
    // Errors
    // ============================================
    
    error SoulboundToken();
    error NotAuthorizedMinter();
    error NotApprovedSpender();
    error ZeroAddress();
    error ZeroAmount();
    error ContractPaused();
    error ExceedsMaxMint();
    error ExceedsDailyLimit();
    error SaleNotEnabled();
    error InsufficientETH();
    error TreasuryNotSet();
    error TransferFailed();
    error TooEarlyToCheckin();
    
    // ============================================
    // Modifiers
    // ============================================
    
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }
    
    // ============================================
    // Constructor
    // ============================================
    
    constructor() ERC20("Base Runner Coins", "BRCOIN") Ownable(msg.sender) {}
    
    // ============================================
    // Check-in Functions
    // ============================================
    
    /**
     * @notice Daily check-in - mints coins in same transaction
     */
    function checkin() external whenNotPaused {
        uint256 lastTime = lastCheckin[msg.sender];
        
        // Check cooldown
        if (lastTime > 0 && block.timestamp < lastTime + CHECKIN_COOLDOWN) {
            revert TooEarlyToCheckin();
        }
        
        // Calculate streak
        uint256 newStreak;
        if (lastTime == 0) {
            newStreak = 1;
        } else if (block.timestamp > lastTime + STREAK_TIMEOUT) {
            newStreak = 1; // Streak broken
        } else {
            newStreak = currentStreak[msg.sender] + 1;
        }
        
        // Calculate reward
        uint256 reward = baseReward;
        if (newStreak % streakBonusEvery == 0) {
            reward += streakBonusAmount;
        }
        
        // Update state
        lastCheckin[msg.sender] = block.timestamp;
        checkinCount[msg.sender] += 1;
        currentStreak[msg.sender] = newStreak;
        
        // Mint coins
        _mint(msg.sender, reward);
        
        emit CheckedIn(msg.sender, newStreak, reward);
    }
    
    /**
     * @notice Check if user can check in now
     */
    function canCheckin(address user) external view returns (bool) {
        uint256 lastTime = lastCheckin[user];
        return lastTime == 0 || block.timestamp >= lastTime + CHECKIN_COOLDOWN;
    }
    
    /**
     * @notice Get time until next check-in (seconds)
     */
    function timeUntilNextCheckin(address user) external view returns (uint256) {
        uint256 lastTime = lastCheckin[user];
        if (lastTime == 0) return 0;
        uint256 nextTime = lastTime + CHECKIN_COOLDOWN;
        if (block.timestamp >= nextTime) return 0;
        return nextTime - block.timestamp;
    }
    
    /**
     * @notice Preview reward for next check-in
     */
    function previewReward(address user) external view returns (uint256) {
        uint256 lastTime = lastCheckin[user];
        uint256 nextStreak;
        
        if (lastTime == 0 || block.timestamp > lastTime + STREAK_TIMEOUT) {
            nextStreak = 1;
        } else {
            nextStreak = currentStreak[user] + 1;
        }
        
        uint256 reward = baseReward;
        if (nextStreak % streakBonusEvery == 0) {
            reward += streakBonusAmount;
        }
        return reward;
    }
    
    /**
     * @notice Get user check-in stats
     */
    function getCheckinStats(address user) external view returns (
        uint256 lastCheckinTime,
        uint256 totalCheckins,
        uint256 streak,
        bool canCheckinNow,
        uint256 nextReward
    ) {
        lastCheckinTime = lastCheckin[user];
        totalCheckins = checkinCount[user];
        streak = currentStreak[user];
        canCheckinNow = lastCheckinTime == 0 || block.timestamp >= lastCheckinTime + CHECKIN_COOLDOWN;
        
        uint256 nextStreak;
        if (lastCheckinTime == 0 || block.timestamp > lastCheckinTime + STREAK_TIMEOUT) {
            nextStreak = 1;
        } else {
            nextStreak = streak + 1;
        }
        nextReward = baseReward;
        if (nextStreak % streakBonusEvery == 0) {
            nextReward += streakBonusAmount;
        }
    }
    
    // ============================================
    // Buy with ETH
    // ============================================
    
    /**
     * @notice Buy coins with ETH
     */
    function buyWithETH(uint256 minCoins) external payable whenNotPaused {
        if (!saleEnabled) revert SaleNotEnabled();
        if (treasury == address(0)) revert TreasuryNotSet();
        if (msg.value == 0) revert ZeroAmount();
        
        uint256 coinsToMint = (msg.value * ethPriceUSD) / coinPriceUSD;
        
        if (coinsToMint == 0) revert InsufficientETH();
        if (coinsToMint < minCoins) revert InsufficientETH();
        
        (bool success, ) = treasury.call{value: msg.value}("");
        if (!success) revert TransferFailed();
        
        _mint(msg.sender, coinsToMint);
        
        emit CoinsPurchased(msg.sender, msg.value, coinsToMint);
    }
    
    function calculateCoinsForETH(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * ethPriceUSD) / coinPriceUSD;
    }
    
    function calculateETHForCoins(uint256 coinAmount) external view returns (uint256) {
        return (coinAmount * coinPriceUSD) / ethPriceUSD;
    }
    
    // ============================================
    // Mint Functions (backend only)
    // ============================================
    
    /**
     * @notice Direct mint by authorized minter (for score rewards)
     */
    function mint(address to, uint256 amount) external whenNotPaused {
        if (!minters[msg.sender]) revert NotAuthorizedMinter();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > maxMintAmount) revert ExceedsMaxMint();
        
        _checkAndUpdateDailyLimit(to, amount);
        
        _mint(to, amount);
        emit CoinsMinted(to, amount);
    }
    
    // ============================================
    // Spend / Burn
    // ============================================
    
    function spend(address spender, uint256 amount) external {
        if (!approvedSpenders[spender]) revert NotApprovedSpender();
        if (amount == 0) revert ZeroAmount();
        _transfer(msg.sender, spender, amount);
    }
    
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit CoinsBurned(msg.sender, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit CoinsBurned(from, amount);
    }
    
    // ============================================
    // Soulbound Override
    // ============================================
    
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0)) {
            super._update(from, to, value);
            return;
        }
        if (to == address(0)) {
            super._update(from, to, value);
            return;
        }
        if (approvedSpenders[to]) {
            super._update(from, to, value);
            return;
        }
        revert SoulboundToken();
    }
    
    // ============================================
    // Admin Functions
    // ============================================
    
    function setMinter(address minter, bool status) external onlyOwner {
        minters[minter] = status;
        emit MinterUpdated(minter, status);
    }
    
    function setApprovedSpender(address spender, bool status) external onlyOwner {
        approvedSpenders[spender] = status;
        emit SpenderUpdated(spender, status);
    }
    
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
    
    function setMaxMintAmount(uint256 _max) external onlyOwner {
        maxMintAmount = _max;
    }
    
    function setDailyMintLimit(uint256 _limit) external onlyOwner {
        dailyMintLimit = _limit;
    }
    
    function setEthPrice(uint256 _price) external onlyOwner {
        ethPriceUSD = _price;
    }
    
    function setCoinPrice(uint256 _price) external onlyOwner {
        coinPriceUSD = _price;
    }
    
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }
    
    function setSaleEnabled(bool _enabled) external onlyOwner {
        saleEnabled = _enabled;
    }
    
    function setCheckinRewards(uint256 _base, uint256 _bonusEvery, uint256 _bonusAmount) external onlyOwner {
        baseReward = _base;
        streakBonusEvery = _bonusEvery;
        streakBonusAmount = _bonusAmount;
    }
    
    // ============================================
    // Internal
    // ============================================
    
    function _checkAndUpdateDailyLimit(address to, uint256 amount) internal {
        uint256 today = block.timestamp / 1 days;
        if (lastMintDay[to] < today) {
            dailyMinted[to] = 0;
            lastMintDay[to] = today;
        }
        if (dailyMinted[to] + amount > dailyMintLimit) {
            revert ExceedsDailyLimit();
        }
        dailyMinted[to] += amount;
    }
    
    // ============================================
    // View Functions
    // ============================================
    
    function decimals() public pure override returns (uint8) {
        return 0;
    }
    
    function getRemainingDailyMint(address account) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (lastMintDay[account] < today) return dailyMintLimit;
        if (dailyMinted[account] >= dailyMintLimit) return 0;
        return dailyMintLimit - dailyMinted[account];
    }
}
