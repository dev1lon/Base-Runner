// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Rug Pull Run - Run Recorder
 * @notice Records game run results on-chain. Lightweight standalone contract.
 * @dev Gas is sponsored via CDP Paymaster so players pay nothing.
 */
contract RunRecorder {

    // ============================================
    // State
    // ============================================

    mapping(address => uint256) public bestScore;
    mapping(address => uint256) public totalRuns;

    // ============================================
    // Events
    // ============================================

    event RunRecorded(address indexed player, uint256 score, uint256 timestamp);

    // ============================================
    // Functions
    // ============================================

    function recordRun(uint256 score) external {
        totalRuns[msg.sender]++;
        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
        }
        emit RunRecorded(msg.sender, score, block.timestamp);
    }

    function getStats(address player) external view returns (uint256 best, uint256 runs) {
        return (bestScore[player], totalRuns[player]);
    }
}
