// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/access/Ownable.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/utils/Pausable.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/token/ERC20/IERC20.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/token/ERC20/utils/SafeERC20.sol";
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.2.0/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Rug Pull Run Payments
 * @notice Handles on-chain payments for paid games (ETH) and coin purchases (USDC).
 *         All payments emit events for backend indexing (no backend polling needed).
 * @dev    Funds stay in the contract until owner calls withdraw*. Idempotent via nonce.
 */
contract RugPullRunPayments is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // USDC on Base mainnet
    IERC20 public immutable usdc;

    // Paid game price in wei (owner can update)
    uint256 public paidGamePriceWei;

    // Price per coin in USDC (6 decimals)
    uint256 public usdcPerCoin;

    // Package-specific overrides (e.g. discounted 5000-pack). 0 = use default price.
    mapping(uint256 => uint256) public coinPackagePrice;

    // Per-user monotonic nonce prevents replay/accidental double-credit on retry
    mapping(address => uint256) public userNonce;

    // ============================================
    // Events — indexed for backend/Dune queries
    // ============================================

    /// @notice Emitted when user pays ETH to play a single paid run.
    event PaidGame(address indexed player, uint256 value, uint256 nonce, uint256 timestamp);

    /// @notice Emitted when user buys coins with USDC.
    event CoinsPurchased(
        address indexed buyer,
        uint256 coinsAmount,
        uint256 usdcAmount,
        uint256 nonce,
        uint256 timestamp
    );

    /// @notice Emitted when owner withdraws contract balance.
    event Withdrawn(address indexed to, uint256 ethAmount, uint256 usdcAmount);

    /// @notice Emitted when admin params update.
    event PriceUpdated(string kind, uint256 newValue);

    constructor(
        address _usdc,
        uint256 _paidGamePriceWei,
        uint256 _usdcPerCoin
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "USDC zero");
        usdc = IERC20(_usdc);
        paidGamePriceWei = _paidGamePriceWei;
        usdcPerCoin = _usdcPerCoin;
    }

    // ============================================
    // User-facing payment functions
    // ============================================

    /**
     * @notice Pay ETH to unlock one paid game run.
     * @dev Emits PaidGame. Overpayment is kept in contract (for future withdrawal).
     *      Builder Code attribution happens via calldata suffix — untouched here.
     */
    function playPaidGame() external payable whenNotPaused nonReentrant {
        require(msg.value >= paidGamePriceWei, "Insufficient payment");
        uint256 nonce = ++userNonce[msg.sender];
        emit PaidGame(msg.sender, msg.value, nonce, block.timestamp);
    }

    /**
     * @notice Buy an in-game coin package with USDC.
     * @param coinsAmount Number of coins to credit (backend trusts the event).
     * @param usdcAmount  USDC (6-decimal) being paid.
     * @dev Caller must approve USDC to this contract first.
     *      Validates amount matches either the package override or the default price.
     */
    function buyCoins(uint256 coinsAmount, uint256 usdcAmount)
        external
        whenNotPaused
        nonReentrant
    {
        require(coinsAmount > 0, "Zero coins");
        uint256 expected = coinPackagePrice[coinsAmount];
        if (expected == 0) expected = usdcPerCoin * coinsAmount;
        require(usdcAmount >= expected, "Insufficient USDC");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        uint256 nonce = ++userNonce[msg.sender];
        emit CoinsPurchased(msg.sender, coinsAmount, usdcAmount, nonce, block.timestamp);
    }

    // ============================================
    // Owner / admin
    // ============================================

    /// @notice Withdraw all ETH to a given address.
    function withdrawETH(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
        emit Withdrawn(to, bal, 0);
    }

    /// @notice Withdraw all USDC to a given address.
    function withdrawUSDC(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "No USDC");
        usdc.safeTransfer(to, bal);
        emit Withdrawn(to, 0, bal);
    }

    function setPaidGamePriceWei(uint256 wei_) external onlyOwner {
        paidGamePriceWei = wei_;
        emit PriceUpdated("paidGamePriceWei", wei_);
    }

    function setUsdcPerCoin(uint256 v) external onlyOwner {
        usdcPerCoin = v;
        emit PriceUpdated("usdcPerCoin", v);
    }

    /// @notice Set a custom USDC price for a specific coin-pack size (e.g. 5000-pack discount).
    ///         Set to 0 to revert to default formula.
    function setCoinPackagePrice(uint256 coinsAmount, uint256 usdcAmount) external onlyOwner {
        coinPackagePrice[coinsAmount] = usdcAmount;
        emit PriceUpdated(
            string(abi.encodePacked("package_", _u2s(coinsAmount))),
            usdcAmount
        );
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ============================================
    // Internal
    // ============================================

    function _u2s(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 len;
        while (tmp != 0) { len++; tmp /= 10; }
        bytes memory buf = new bytes(len);
        while (v != 0) { len--; buf[len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    // Allow contract to receive ETH directly (rare, but keep funds safe)
    receive() external payable {}
}
