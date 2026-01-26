// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Checkin {
    event CheckedIn(address indexed user, uint256 timestamp);

    mapping(address => uint256) public lastCheckIn;

    function checkIn() external {
        _checkIn(msg.sender);
    }

    receive() external payable {
        _checkIn(msg.sender);
    }

    fallback() external payable {
        _checkIn(msg.sender);
    }

    function _checkIn(address user) internal {
        lastCheckIn[user] = block.timestamp;
        emit CheckedIn(user, block.timestamp);
    }
}
