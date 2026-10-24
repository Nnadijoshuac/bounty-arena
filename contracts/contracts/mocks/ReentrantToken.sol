// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IArenaWithdraw {
    function withdraw() external;
}

/// @notice Test-only token that tries to call back into the arena while a transfer is in flight.
contract ReentrantToken is ERC20 {
    address public victim;
    bool public armed;

    constructor() ERC20("Reentrant", "RENT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address arena) external {
        victim = arena;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == victim) {
            armed = false;
            IArenaWithdraw(victim).withdraw();
        }
    }
}
