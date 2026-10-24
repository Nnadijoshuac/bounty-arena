# What we picked from Arc Studio

We asked Arc Studio, Circle's AI coding agent, to build the same product we were building: a USDC bounty arena where humans and AI agents compete for work. It wrote a 649-line contract, a design document and 76 Foundry tests, and deployed it to Arc testnet at `0x59303aafc75e1d961393f32e782ed8012594980a`.

We then reviewed Studio's version line by line, as an independent auditor would, and compared it with ours. This page is the honest result. It covers what we took from Studio, where each idea lives in Studio's code, and what we looked at and chose not to use, with the reason.

## What we reviewed

- `contracts/BountyArena.sol`, the whole contract.
- `contracts/BountyArena-design.md`, the design document.
- All six Foundry test files, plus the test helpers and the deploy script.
- The deployed contract. Its runtime bytecode on Arc testnet matches the source exactly, apart from the metadata hash, and it points at the real Arc USDC.

The full review is in `studio-arena/AUDIT.md`. It found 1 Critical, 3 High, 4 Medium and 3 Low issues, each with a Hardhat proof test in `studio-arena/hh/`. Those findings shaped the "not used" list below, but they don't take away from the parts Studio got right, and several of those are better than what we had.

## What we picked

Status: these are agreed picks. They go into our code once the current round of audit fixes in `arena/contracts` lands, so that the two changes don't collide.

### 1. A solvency invariant test

- **What it is:** a stateful test that throws random sequences of actions at the contract and checks after every step that the USDC it holds equals everything it owes: escrow, stakes and credits.
- **Where in Studio:** `contracts/test/BountyArena.Invariant.t.sol`, `invariant_TotalAccountingBalanced`, with its handler contract.
- **Why it's better than ours:** our audit checked solvency by reading every path by hand, and our tests only spot-check the balance in a single scenario. A randomized check catches the drift a reviewer misses, and it keeps catching it after every future change.
- **How we port it:** Hardhat has no invariant runner, so we write a seeded random walk in TypeScript. Each step picks an action (create, submit, reveal, verify, reject, award, finalize, dispute, resolve, settle, tip, withdraw or a time jump) with random actors and amounts. After each step it asserts that the contract's USDC balance equals open rewards plus `stakeHeld` plus held bonds plus every actor's `claimable` plus `feesAccrued`. We go further than Studio's handler, which never used stakes, disputes, top 3 awards or fee changes, and which summed credits over a fixed list of 7 actors.

### 2. Terminal-state checks inside that invariant

- **What it is:** two extra assertions. A settled bounty holds no escrow, and once its last window has closed it holds no stake either.
- **Where in Studio:** the same file, `invariant_TerminalStateEscrowIsZero` and `invariant_NoStakeHeldAfterTerminalAward`.
- **Why:** they pin down "money can't be left behind in a finished bounty", which is a different bug from a balance mismatch.
- **How we port it:** in the random walk, for every bounty in `Paid`, `GhostPaid` or `Refunded`, assert that its reward has been credited out, and assert `stakeHeld == 0` and `bond == 0` once every challenge and dispute window for it has passed. Our stakes can settle later than the payout, so the check waits for those windows rather than firing at the moment of payout as Studio's does.

### 3. Two-step ownership transfer

- **What it is:** OpenZeppelin's `Ownable2Step`. A new owner has to accept the role before it moves.
- **Where in Studio:** `BountyArena.sol` lines 6 and 10.
- **Why it's better than ours:** we use plain `Ownable`, where one wrong address in `transferOwnership` loses the admin keys for good. That would freeze the treasury, the verifier and the arbiter settings forever.
- **How we port it:** import `Ownable2Step`, declare `contract BountyArena is Ownable2Step, ReentrancyGuard`, and keep the `Ownable(msg.sender)` constructor call. We'll check the size afterwards, because our contract is close to the 24 KB limit.

### 4. A conservation fuzz on every payout

- **What it is:** a test that runs payouts over many random amounts and fee rates and asserts that what the winners get plus the fee equals the reward exactly, with nobody overpaid.
- **Where in Studio:** `contracts/test/BountyArena.Fuzz.t.sol`, `testFuzz_Award_TopThree_ValidSplits` and `testFuzz_FeeBps_FeeCalculation`.
- **Why:** our 50/30/20 weights renormalize when there are fewer winners, and the last winner takes the rounding remainder. That's the kind of arithmetic that breaks on odd amounts such as 1,000,001 units, and our tests only use round numbers.
- **How we port it:** a TypeScript loop over a few hundred seeded cases. It varies the reward (1 USDC up to 1,000,000 USDC, including odd unit counts), the snapshotted fee from 0 to 1,000 bps, one to three winners, and ghost splits across 1 to 50 entries. It sums the `WinnerPaid` and `GhostShare` events plus the fee taken and asserts that the total equals the reward.

### 5. A token that refuses transfers, to test Arc's blocklist

- **What it is:** a mock ERC-20 that reverts transfers for one chosen address.
- **Where in Studio:** `contracts/test/BountyArena.Attack.t.sol`, `RefusingToken`.
- **Why:** on Arc, any USDC transfer to or from a blocklisted address reverts. Our audit argues that pull payments contain the damage, but no test proves it. Studio had the right tool, though it only used it in one test.
- **How we port it:** a `BlocklistUSDC` mock in `contracts/mocks/` that reverts any transfer to or from a listed address, as Arc does. Then three tests: a blocklisted winner can't withdraw but every other winner can, a blocklisted treasury stalls `withdrawFees` and nothing else, and a blocklisted entrant's stake doesn't block settlement for the others.

### 6. A flow-of-funds table and a watch list for the docs

- **What it is:** a table of every step that moves money with the invariant it keeps, and a table of onchain events worth alerting on, with thresholds.
- **Where in Studio:** `contracts/BountyArena-design.md`, section 9 ("Flow of Funds") and section 22 ("Monitoring & Alerting").
- **Why:** our README explains the rules but not the money paths in one place, and it says nothing about what to watch once we're live. Both help a reviewer, and the watch list helps whoever runs the arena.
- **How we port it:** add "Where the money goes" and "What to watch onchain" sections to `arena/README.md`, written for our own events (`Disputed`, `DisputeTimedOut`, `BondSettled`, `StakeSettled` with `forfeited`, `ConfigChanged` and others).

### Already in ours, and Studio had it first

- **Naming every recipient of a ghost split.** Studio's `GhostFallback` event lists every entrant paid. Our first version emitted only a count and a total. We fixed that with a `GhostShare` event per recipient, and the fix came from our own audit (finding I-2), but Studio got there first.

## What we reviewed and didn't use

| Studio's choice | Why we left it out |
|---|---|
| The arbiter's bond is pulled from the arbiter when an entrant disputes (`disputeBounty`) | A poster can name any address as arbiter and pull that address's approved USDC into a bounty, then take it. That's Critical finding C-1 in the Studio audit. In ours, the disputer posts the bond themselves. |
| The poster picks the verifier and the arbiter for each bounty | A poster can be their own verifier and take every entry stake (M-2), and an arbiter can be anyone. Ours snapshots a protocol verifier and arbiter at creation. |
| Rejecting a second entry with the same deliverable hash | Without binding the hash to the sender, it hands the slot to whoever copies it first and locks the real author out (H-1). Ours uses commit and reveal, and refuses a second reveal of the same content instead. |
| Awards that pay out at once | No bad award can be disputed (M-1). Ours keeps a dispute window, then a `finalize` call. |
| Even split across every entrant when nobody passes a verified check, or when the arbiter is silent | Junk entries get paid (H-2, H-3). Ours refunds the poster when nothing passes and excludes rejected entries from any split. |
| A queue-and-execute timelock on fee changes | A good pattern, but ours snapshots the fee into each bounty at creation. A posted bounty can't be affected by a later change, which protects posters more directly, and new posters see the current fee before they post. It isn't worth the bytecode near our size limit. |
| Measuring every deposit by balance delta | Solid defence against fee-on-transfer tokens. The arena only ever takes Arc USDC, which isn't one, and the extra code doesn't fit our size budget. |
| 25 specific custom errors (`DeadlinePassed`, `NotEntrant` and so on) | Clearer for integrators than our `BadState` and `BadInput`. We'd like this, but not at our current contract size. For now, integrators decode the general errors from the ABI. We'll revisit if the contract is split. |
| A 100-entry cap | We keep 50, which halves the worst-case loop cost for the same purpose. |
| Studio's reentrancy test with `MaliciousToken` | It can't fail, because the token re-enters as itself rather than as the hunter. We keep our own reentrant-token mock. |
| Splitting tests into happy, revert, attack, fuzz and invariant files | Tidy, but our tests are already grouped by behaviour, and our audit proofs have their own file. Not worth the churn. |

## In short

Studio produced a working, careful baseline fast: pull payments, reentrancy guards, capped fees, two-step ownership and a real invariant test. The game rules and the dispute design needed more thought than one pass gave them. We're taking its testing discipline and its ownership pattern, and leaving its dispute and verifier design behind.
