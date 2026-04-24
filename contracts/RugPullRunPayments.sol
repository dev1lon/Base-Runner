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

// ============================================
// Minimal access / safety primitives (no external deps — BaseScan friendly)
// ============================================

abstract contract Ownable {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    error NotOwner();
    error ZeroOwner();

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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        address old = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
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
// Rug Pull Run Payments
// ============================================

/**
 * @title Rug Pull Run Payments
 * @notice Handles on-chain payments for paid games (ETH) and coin purchases (USDC).
 *         All payments emit events for backend indexing (no transfer-topic scraping).
 * @dev    Funds stay in the contract until owner calls withdraw*. Per-user nonce.
 */
contract RugPullRunPayments is Ownable, Pausable, ReentrancyGuard {
    IERC20 public immutable usdc;

    // Paid game price in wei (owner updatable)
    uint256 public paidGamePriceWei;

    // Default USDC price per coin (6 decimals)
    uint256 public usdcPerCoin;

    // Package-specific USDC prices (0 = use default formula)
    mapping(uint256 => uint256) public coinPackagePrice;

    // Per-user monotonic counter — replay/retry dedupe on backend
    mapping(address => uint256) public userNonce;

    // Custom errors (gas-efficient)
    error InsufficientPayment();
    error ZeroCoins();
    error InsufficientUSDC();
    error ZeroAddress();
    error NoBalance();
    error EthTransferFailed();
    error USDCTransferFailed();

    // Events — indexed for backend / Dune / Base Analytics
    event PaidGame(address indexed player, uint256 value, uint256 nonce, uint256 timestamp);
    event CoinsPurchased(
        address indexed buyer,
        uint256 coinsAmount,
        uint256 usdcAmount,
        uint256 nonce,
        uint256 timestamp
    );
    event Withdrawn(address indexed to, uint256 ethAmount, uint256 usdcAmount);
    event PriceUpdated(string kind, uint256 newValue);

    constructor(
        address _usdc,
        uint256 _paidGamePriceWei,
        uint256 _usdcPerCoin
    ) Ownable(msg.sender) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        paidGamePriceWei = _paidGamePriceWei;
        usdcPerCoin = _usdcPerCoin;
    }

    // ============================================
    // User payments
    // ============================================

    function playPaidGame() external payable whenNotPaused nonReentrant {
        if (msg.value < paidGamePriceWei) revert InsufficientPayment();
        uint256 nonce = ++userNonce[msg.sender];
        emit PaidGame(msg.sender, msg.value, nonce, block.timestamp);
    }

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

    function withdrawETH(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal == 0) revert NoBalance();
        (bool ok, ) = to.call{value: bal}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(to, bal, 0);
    }

    function withdrawUSDC(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) revert NoBalance();
        bool ok = usdc.transfer(to, bal);
        if (!ok) revert USDCTransferFailed();
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

    function setCoinPackagePrice(uint256 coinsAmount, uint256 usdcAmount) external onlyOwner {
        coinPackagePrice[coinsAmount] = usdcAmount;
        emit PriceUpdated("coinPackagePrice", usdcAmount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
