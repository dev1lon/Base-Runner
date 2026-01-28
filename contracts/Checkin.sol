// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CheckIn {
    /// @dev последний день check-in (UTC) для каждого адреса
    mapping(address => uint256) public lastCheckInDay;

    /// @dev событие check-in
    event CheckedIn(address indexed user, uint256 timestamp);

    /// @notice выполнить check-in (1 раз в сутки)
    function checkIn() external {
        uint256 today = block.timestamp / 1 days;

        require(
            lastCheckInDay[msg.sender] < today,
            "Already checked in today"
        );

        lastCheckInDay[msg.sender] = today;
        emit CheckedIn(msg.sender, block.timestamp);
    }
}
