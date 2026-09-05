// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================
// Minimal interfaces
// ============================================

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Chainlink AggregatorV3 (only what we read).
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

// ============================================
// Minimal access / safety primitives (no external deps — BaseScan friendly)
// ============================================

abstract contract Ownable2Step {
    address private _owner;
    address private _pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroOwner();
    error NotPendingOwner();

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroOwner();
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotOwner();
        _;
    }

    function owner() public view returns (address) { return _owner; }
    function pendingOwner() public view returns (address) { return _pendingOwner; }

    /// @notice Step 1 — nominate. Ownership only moves once `newOwner` accepts,
    ///         so a typo can never brick the contract.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    /// @notice Step 2 — the nominee claims ownership.
    function acceptOwnership() external {
        if (msg.sender != _pendingOwner) revert NotPendingOwner();
        address old = _owner;
        _owner = msg.sender;
        _pendingOwner = address(0);
        emit OwnershipTransferred(old, msg.sender);
    }
}

abstract contract Pausable {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);
    error IsPaused();
    error NotPaused();

    modifier whenNotPaused() {
        if (_paused) revert IsPaused();
        _;
    }

    function paused() public view returns (bool) { return _paused; }

    function _pause() internal {
        if (_paused) revert IsPaused();
        _paused = true;
        emit Paused(msg.sender);
    }

    function _unpause() internal {
        if (!_paused) revert NotPaused();
        _paused = false;
        emit Unpaused(msg.sender);
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    error Reentrant();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrant();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// ============================================
// Rug Pull Run Payments V3
// ============================================

/**
 * @title Rug Pull Run Payments V3
 * @notice Single payment entry point for the game. Same surface as V2
 *         (0xd2c7739c702032E4Fb505081Ceb81d7832f5694D) plus USD-pegged ETH pricing:
 *           - playPaidGame()          ETH  — paid run ($1.00 by default)
 *           - saveLeaderboard(score)  ETH  — leaderboard record ($0.10 by default)
 *           - buyCoins(...)           USDC — coin packages (already USD, no oracle)
 *
 * @dev    WHY V3: in V2 the ETH prices were fixed wei amounts duplicated in three
 *         places (contract storage, backend env, frontend fallback constant). Every
 *         ETH move silently changed the real USD price, and any of the three copies
 *         drifting out of sync makes wallets revert with InsufficientPayment.
 *         V3 stores prices in USD cents and converts to wei on-chain through the
 *         Chainlink ETH/USD feed, so the contract is the single source of truth:
 *           frontend  → quotePaidGameWei()  (exact value to send)
 *           backend   → the emitted event, with the quote only as a sanity floor
 *
 *         Oracle safety:
 *           - a non-positive answer, an incomplete round or an answer older than
 *             `maxPriceAgeSec` is treated as unusable;
 *           - the quote then comes from `fallbackWei`, so a feed outage degrades to
 *             fixed pricing instead of bricking the game (owner can also pause);
 *           - every quote is clamped to [minQuoteWei, maxQuoteWei], so a broken feed
 *             can never demand an absurd amount from a player;
 *           - `toleranceBps` accepts slightly less than the live quote, so a price
 *             tick between the wallet's estimate and inclusion does not revert the
 *             player's transaction.
 *
 *         Every payment emits an indexed event carrying both the value paid and the
 *         price required at execution, so the backend can verify a tx from its
 *         receipt alone. Non-indexed fields stay uint256 → the backend decoder is a
 *         plain defaultAbiCoder.decode over log data.
 */
contract RugPullRunPaymentsV3 is Ownable2Step, Pausable, ReentrancyGuard {
    IERC20 public immutable usdc;

    // ---- USD-pegged ETH pricing ----------------------------------------

    /// @notice Chainlink ETH/USD feed. Base mainnet: 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
    ///         (8 decimals). address(0) = oracle disabled, fallback prices are used.
    AggregatorV3Interface public ethUsdFeed;

    /// @notice Price of one paid run, in USD cents (100 = $1.00).
    uint256 public paidGamePriceUsdCents;

    /// @notice Price of one leaderboard record, in USD cents (10 = $0.10).
    uint256 public saveLeaderboardPriceUsdCents;

    /// @notice Wei prices used when the feed is unset, stale or reverting.
    uint256 public paidGameFallbackWei;
    uint256 public saveLeaderboardFallbackWei;

    /// @notice Max age of a feed answer before it counts as stale (Base ETH/USD
    ///         heartbeat is 20 min — 1 h leaves room without accepting junk).
    uint256 public maxPriceAgeSec;

    /// @notice Accepted underpayment vs the live quote, in basis points (200 = 2%).
    ///         Absorbs the ETH move between the wallet quoting and the tx landing.
    uint256 public toleranceBps;

    /// @notice Hard clamps on any quote — protection against a misbehaving feed.
    uint256 public minQuoteWei;
    uint256 public maxQuoteWei;

    // ---- USDC pricing (no oracle needed) --------------------------------

    /// @notice Default USDC price per coin (6 decimals).
    uint256 public usdcPerCoin;

    /// @notice Package-specific USDC prices (0 = use default formula).
    mapping(uint256 => uint256) public coinPackagePrice;

    // ---- Bookkeeping ----------------------------------------------------

    /// @notice Per-user monotonic counter — replay/retry dedupe on backend.
    mapping(address => uint256) public userNonce;

    // Custom errors (gas-efficient)
    error InsufficientPayment();
    error ZeroCoins();
    error ZeroScore();
    error InsufficientUSDC();
    error ZeroAddress();
    error NoBalance();
    error EthTransferFailed();
    error USDCTransferFailed();
    error BadPriceConfig();
    error AmountTooHigh();

    // Events — indexed for backend / Dune / Base Analytics
    event PaidGame(address indexed player, uint256 value, uint256 priceWei, uint256 nonce, uint256 timestamp);
    event LeaderboardSaved(
        address indexed player,
        uint256 score,
        uint256 value,
        uint256 priceWei,
        uint256 nonce,
        uint256 timestamp
    );
    event CoinsPurchased(
        address indexed buyer,
        uint256 coinsAmount,
        uint256 usdcAmount,
        uint256 nonce,
        uint256 timestamp
    );
    event Withdrawn(address indexed to, uint256 ethAmount, uint256 usdcAmount);
    event Rescued(address indexed token, address indexed to, uint256 amount);
    event DirectDeposit(address indexed from, uint256 amount);
    event PriceUpdated(string kind, uint256 newValue);
    event FeedUpdated(address indexed feed);

    /**
     * @param _usdc                         USDC token (Base mainnet 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
     * @param _ethUsdFeed                   Chainlink ETH/USD feed, or address(0) to run on fallback wei prices
     * @param _paidGamePriceUsdCents        e.g. 100 → $1.00 per paid run
     * @param _saveLeaderboardPriceUsdCents e.g. 10  → $0.10 per leaderboard save
     * @param _paidGameFallbackWei          wei charged if the feed is unusable (set near the current USD value)
     * @param _saveLeaderboardFallbackWei   same, for leaderboard saves
     * @param _usdcPerCoin                  default USDC (6 dec) per in-game coin, e.g. 100000 = $0.10
     */
    constructor(
        address _usdc,
        address _ethUsdFeed,
        uint256 _paidGamePriceUsdCents,
        uint256 _saveLeaderboardPriceUsdCents,
        uint256 _paidGameFallbackWei,
        uint256 _saveLeaderboardFallbackWei,
        uint256 _usdcPerCoin
    ) Ownable2Step(msg.sender) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        ethUsdFeed = AggregatorV3Interface(_ethUsdFeed); // address(0) allowed = fallback mode
        paidGamePriceUsdCents = _paidGamePriceUsdCents;
        saveLeaderboardPriceUsdCents = _saveLeaderboardPriceUsdCents;
        paidGameFallbackWei = _paidGameFallbackWei;
        saveLeaderboardFallbackWei = _saveLeaderboardFallbackWei;
        usdcPerCoin = _usdcPerCoin;

        maxPriceAgeSec = 3600;     // 1 hour
        toleranceBps = 200;        // accept 2% under the live quote
        minQuoteWei = 1;           // never charge 0
        maxQuoteWei = 0.05 ether;  // sanity ceiling — no feed glitch can exceed it
    }

    // ============================================
    // Pricing views (single source of truth for frontend + backend)
    // ============================================

    /// @notice Latest ETH/USD from the feed, normalised to 8 decimals.
    /// @return price ETH price with 8 decimals (0 when unusable)
    /// @return updatedAt feed timestamp (0 when unusable)
    function ethUsdPrice() public view returns (uint256 price, uint256 updatedAt) {
        if (address(ethUsdFeed) == address(0)) return (0, 0);
        try ethUsdFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 answerUpdatedAt,
            uint80 answeredInRound
        ) {
            if (answer <= 0) return (0, 0);
            if (answeredInRound < roundId) return (0, 0);                          // incomplete round
            if (answerUpdatedAt == 0) return (0, 0);
            if (block.timestamp > answerUpdatedAt + maxPriceAgeSec) return (0, 0); // stale
            uint8 dec = 8;
            try ethUsdFeed.decimals() returns (uint8 d) { dec = d; } catch { }
            uint256 raw = uint256(answer);
            if (dec > 8) raw = raw / (10 ** (uint256(dec) - 8));
            else if (dec < 8) raw = raw * (10 ** (8 - uint256(dec)));
            return (raw, answerUpdatedAt);
        } catch {
            return (0, 0);
        }
    }

    /// @notice Convert a USD-cent amount to wei at the live ETH price.
    /// @dev Falls back to `fallbackWei` when the feed is unusable, then clamps.
    function _quoteWei(uint256 usdCents, uint256 fallbackWei) internal view returns (uint256 weiAmount) {
        (uint256 price, ) = ethUsdPrice();
        if (price == 0 || usdCents == 0) {
            weiAmount = fallbackWei;
        } else {
            // cents → wei:  cents * 1e18 * 1e8 / (100 * price8)
            weiAmount = (usdCents * 1e18 * 1e8) / (100 * price);
        }
        if (weiAmount < minQuoteWei) weiAmount = minQuoteWei;
        if (weiAmount > maxQuoteWei) weiAmount = maxQuoteWei;
    }

    /// @notice Exact wei a wallet should send for a paid run right now.
    function quotePaidGameWei() public view returns (uint256) {
        return _quoteWei(paidGamePriceUsdCents, paidGameFallbackWei);
    }

    /// @notice Exact wei a wallet should send to register a leaderboard score.
    function quoteSaveLeaderboardWei() public view returns (uint256) {
        return _quoteWei(saveLeaderboardPriceUsdCents, saveLeaderboardFallbackWei);
    }

    /// @notice Everything the frontend needs in one call.
    /// @return paidGameWei    current price of a paid run
    /// @return leaderboardWei current price of a leaderboard save
    /// @return ethUsd8        ETH/USD with 8 decimals (0 = running on fallback)
    /// @return feedUpdatedAt  feed timestamp (0 = running on fallback)
    /// @return isPaused       whether payments are paused
    function getPrices()
        external
        view
        returns (uint256 paidGameWei, uint256 leaderboardWei, uint256 ethUsd8, uint256 feedUpdatedAt, bool isPaused)
    {
        (ethUsd8, feedUpdatedAt) = ethUsdPrice();
        paidGameWei = quotePaidGameWei();
        leaderboardWei = quoteSaveLeaderboardWei();
        isPaused = paused();
    }

    /// @dev Minimum accepted value = quote minus `toleranceBps`.
    function _minAccepted(uint256 quote) internal view returns (uint256) {
        return (quote * (10_000 - toleranceBps)) / 10_000;
    }

    // ============================================
    // User payments
    // ============================================

    /// @notice Pay for a run. Overpayment is accepted and kept.
    function playPaidGame() external payable whenNotPaused {
        uint256 price = quotePaidGameWei();
        if (msg.value < _minAccepted(price)) revert InsufficientPayment();
        uint256 nonce = ++userNonce[msg.sender];
        emit PaidGame(msg.sender, msg.value, price, nonce, block.timestamp);
    }

    /// @notice Pay to register a run score on the leaderboard.
    /// @param score Score being submitted. The backend cross-checks this against
    ///        the session it recorded before writing the leaderboard row, so the
    ///        contract only needs to bind the score to the payment.
    function saveLeaderboard(uint256 score) external payable whenNotPaused {
        if (score == 0) revert ZeroScore();
        uint256 price = quoteSaveLeaderboardWei();
        if (msg.value < _minAccepted(price)) revert InsufficientPayment();
        uint256 nonce = ++userNonce[msg.sender];
        emit LeaderboardSaved(msg.sender, score, msg.value, price, nonce, block.timestamp);
    }

    /// @notice Buy coin packages with USDC. This is the game's "top up" path.
    ///         USDC is already USD — no oracle involved.
    function buyCoins(uint256 coinsAmount, uint256 usdcAmount)
        external
        whenNotPaused
        nonReentrant
    {
        if (coinsAmount == 0) revert ZeroCoins();
        uint256 expected = coinPackagePrice[coinsAmount];
        if (expected == 0) expected = usdcPerCoin * coinsAmount;
        if (usdcAmount < expected) revert InsufficientUSDC();

        bool ok = usdc.transferFrom(msg.sender, address(this), usdcAmount);
        if (!ok) revert USDCTransferFailed();

        uint256 nonce = ++userNonce[msg.sender];
        emit CoinsPurchased(msg.sender, coinsAmount, usdcAmount, nonce, block.timestamp);
    }

    // ============================================
    // Owner / admin
    // ============================================

    /// @notice Withdraw the whole ETH balance.
    function withdrawETH(address payable to) external onlyOwner nonReentrant {
        _withdrawETH(to, address(this).balance);
    }

    /// @notice Withdraw part of the ETH balance.
    function withdrawETHAmount(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > address(this).balance) revert AmountTooHigh();
        _withdrawETH(to, amount);
    }

    function _withdrawETH(address payable to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert NoBalance();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(to, amount, 0);
    }

    function withdrawUSDC(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) revert NoBalance();
        bool ok = usdc.transfer(to, bal);
        if (!ok) revert USDCTransferFailed();
        emit Withdrawn(to, 0, bal);
    }

    /// @notice Recover any ERC-20 accidentally sent to the contract.
    function rescueERC20(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0) || token == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert NoBalance();
        if (!IERC20(token).transfer(to, bal)) revert USDCTransferFailed();
        emit Rescued(token, to, bal);
    }

    // ---- Price administration -------------------------------------------

    function setEthUsdFeed(address feed) external onlyOwner {
        ethUsdFeed = AggregatorV3Interface(feed); // address(0) = fallback mode
        emit FeedUpdated(feed);
    }

    function setPaidGamePriceUsdCents(uint256 cents) external onlyOwner {
        paidGamePriceUsdCents = cents;
        emit PriceUpdated("paidGamePriceUsdCents", cents);
    }

    function setSaveLeaderboardPriceUsdCents(uint256 cents) external onlyOwner {
        saveLeaderboardPriceUsdCents = cents;
        emit PriceUpdated("saveLeaderboardPriceUsdCents", cents);
    }

    function setFallbackWei(uint256 paidGameWei_, uint256 leaderboardWei_) external onlyOwner {
        paidGameFallbackWei = paidGameWei_;
        saveLeaderboardFallbackWei = leaderboardWei_;
        emit PriceUpdated("paidGameFallbackWei", paidGameWei_);
        emit PriceUpdated("saveLeaderboardFallbackWei", leaderboardWei_);
    }

    function setMaxPriceAgeSec(uint256 seconds_) external onlyOwner {
        if (seconds_ < 60) revert BadPriceConfig(); // below a heartbeat = permanent fallback
        maxPriceAgeSec = seconds_;
        emit PriceUpdated("maxPriceAgeSec", seconds_);
    }

    function setToleranceBps(uint256 bps) external onlyOwner {
        if (bps > 1000) revert BadPriceConfig(); // never give away more than 10%
        toleranceBps = bps;
        emit PriceUpdated("toleranceBps", bps);
    }

    function setQuoteBounds(uint256 minWei, uint256 maxWei) external onlyOwner {
        if (minWei == 0 || maxWei < minWei) revert BadPriceConfig();
        minQuoteWei = minWei;
        maxQuoteWei = maxWei;
        emit PriceUpdated("minQuoteWei", minWei);
        emit PriceUpdated("maxQuoteWei", maxWei);
    }

    function setUsdcPerCoin(uint256 v) external onlyOwner {
        usdcPerCoin = v;
        emit PriceUpdated("usdcPerCoin", v);
    }

    function setCoinPackagePrice(uint256 coinsAmount, uint256 usdcAmount) external onlyOwner {
        coinPackagePrice[coinsAmount] = usdcAmount;
        emit PriceUpdated("coinPackagePrice", usdcAmount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Plain ETH sends are logged so a stray transfer stays traceable.
    receive() external payable {
        emit DirectDeposit(msg.sender, msg.value);
    }
}
