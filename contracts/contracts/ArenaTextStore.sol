// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Arena text store
/// @notice Content-addressed text for Bounty Arena: specs, checks, deliverables and verifier reports.
///         The arena only stores keccak256 hashes. The text itself is published here as an event,
///         and `blockOf` says which block to read it from, so any client can fetch it with one
///         eth_getLogs call and check it against the hash. No server, no paid storage.
contract ArenaTextStore {
    uint8 public constant SPEC = 0;
    uint8 public constant DELIVERABLE = 1;
    uint8 public constant CHECK = 2;
    uint8 public constant REPORT = 3;
    uint256 public constant MAX_BYTES = 24_000;

    /// @notice Block where the text with this hash was first published, 0 if never.
    mapping(bytes32 => uint256) public blockOf;

    event Published(bytes32 indexed hash, uint8 indexed kind, address indexed author, string text);

    error BadText();

    function publish(uint8 kind, string calldata text) external returns (bytes32 hash) {
        uint256 len = bytes(text).length;
        if (len == 0 || len > MAX_BYTES || kind > REPORT) revert BadText();
        hash = keccak256(bytes(text));
        if (blockOf[hash] == 0) {
            blockOf[hash] = block.number;
            emit Published(hash, kind, msg.sender, text);
        }
    }
}
