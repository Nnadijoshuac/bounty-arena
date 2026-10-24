# Bounty Arena security audit

Scope: `contracts/contracts/BountyArena.sol` (780 lines) and `contracts/contracts/ArenaTextStore.sol` (32 lines), with their OpenZeppelin 5 imports (`Ownable`, `ReentrancyGuard`, `SafeERC20`). Read against `README.md` and the Arc brief. The agent SDK and verifier were read only where the contracts depend on how they're used (deliverable publishing and verifier checks).

Date: 2026-10-23. Commit state: working tree as found. No contract was changed.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 2 |
| Info | 2 |

The accounting is sound. On every path I traced, the contract's balance equals open escrow plus held stakes, bonds, `claimable` and `feesAccrued`, and there's no reentrancy or admin path into escrow. The problems are in the game rules. On verified bounties, a deliverable isn't tied to the address that wrote it, so a watcher can copy a published solution and get paid for it. On winner-takes-all and top 3 bounties, a poster can't turn junk down, so whoever fills the 50 entry slots is guaranteed the escrow. Several dispute paths can be gamed by timing or by a silent arbiter.

Every finding has a test in `contracts/test/Audit.test.ts` that states the correct behaviour and fails today:

```bash
cd arena/contracts
npx hardhat test test/Audit.test.ts     # 12 failing, one per finding
npm test                                # 57 existing tests still pass, plus the 12 audit failures
```

## High

### H-1. A copied deliverable takes the reward on verified bounties

- **Location:** `submit` (line 309), `verifyAndAward` (lines 345 to 372), and the publish-then-submit flow in `agent-sdk/src/index.ts` `submit` (lines 366 to 372).
- **Impact:** Theft of the full reward from the hunter who solved the task. On a verified bounty that's the whole point of the product, and agents running in a loop are the easiest victims.
- **Scenario:** Alice's agent publishes her solution to `ArenaTextStore` (tx 1), which emits `Published(hash, 1, alice, text)`, then calls `submit(id, hash)` (tx 2). Mallory watches `Published` with `kind = 1` and calls `submit(id, hash)` between the two transactions. Her entry gets the lower index. The verifier checks in index order, runs the identical text, passes entry 0 and pays Mallory 950 USDC. Alice's entry is never reached. Nothing onchain binds a deliverable hash to its submitter, duplicate hashes are allowed on the same bounty, and the verifier doesn't compare `Published.author` with `sub.hunter`. Even a hunter who submits before publishing loses if the copier front-runs tx 2 itself.
- **Proof:** `H-1: a copied deliverable cannot take the reward from the hunter who wrote it`
- **Fix:** Bind entries to their sender. Have hunters submit `commitment = keccak256(abi.encode(id, msg.sender, keccak256(text)))` and publish the text only after the submission is mined. The verifier reads the text, recomputes the commitment for `sub.hunter` and fails any mismatch. A copier can then only enter after the original, with a later index. Rejecting a second entry with the same `deliverableHash` on a bounty is a cheap extra guard, but it isn't enough alone because the copier can still get there first.

### H-2. Sybils who fill every slot of a winner-takes-all or top 3 bounty are guaranteed the escrow

- **Location:** `submit` (`MAX_SUBMISSIONS`, line 319), `reject` (FirstValid only, line 380), `reclaim` (zero entries only, line 447), `settleTimeout` and `_ghostSplit` (lines 440, 717).
- **Impact:** Theft of 95% of any poster-judged bounty that isn't FirstValid, and honest hunters are locked out. The cost is gas for 50 `register` and 50 `submit` calls and no stake. (The README notes that sybils are cheap, but not that they can force a payout.)
- **Scenario:** A poster escrows 1,000 USDC in a winner-takes-all bounty. An attacker's script sees `BountyCreated` and submits junk from 50 fresh wallets. Alice's `submit` reverts with `BadState`. The poster can't reject in this mode and `reclaim` needs zero entries, so the only options are to award a junk entry or let the review window lapse. At `reviewEnd` anyone calls `settleTimeout`, the escrow ghost-splits across the 50 sybils, and the attacker collects 950 USDC. The same works with one junk entry on a quiet bounty.
- **Proof:** `H-2: sybils filling every slot of a winner-takes-all bounty cannot capture the escrow`
- **Fix:** Let posters reject entries in every poster-judged mode, with each rejection open to dispute (see M-2), and have the ghost split skip rejected entries, which it already does. Add an optional entry stake to poster-judged bounties, as verified ones have. Consider a per-bounty `maxEntries` the poster sets, or reserving slots so one funder can't fill the cap in the first block.

## Medium

### M-1. Any entrant can freeze a verified bounty at any time, and a silent arbiter makes it free

- **Location:** `dispute`, verified branch (lines 462 to 464), and `settleStaleDispute` (lines 517 to 532).
- **Impact:** Denial of service on the instant payout, and a cheap way for a poster to claw back the reward. A frozen bounty takes no new entries and the verifier can't post results. If the arbiter doesn't rule within 14 days, the poster is refunded, the passing hunter gets nothing, and the disputer's bond comes back.
- **Scenario:** Mallory (or the poster's second wallet) submits junk. Alice submits a correct solution. Before the verifier even checks Mallory's entry, and two days before the deadline, Mallory calls `dispute`. The branch only requires that her entry hasn't passed, and an unchecked entry hasn't. `verifyAndAward` now reverts with `BadState` for every entry. A passing hunter depends entirely on the arbiter running the check by hand.
- **Proof:** `M-1: one entrant's dispute does not stop the verifier from judging and paying a passing entry`
- **Fix:** Only allow a verified dispute once the disputer's own entry has a failed result, or once `reviewEnd` has passed with it unchecked. Don't move the bounty to `Disputed`. Record the challenge per entry so the verifier can keep judging later entries. On arbiter timeout, forfeit the bond instead of returning it, or at least don't refund the poster over an unresolved dispute when a later entry passed.

### M-2. A rejection or failed check at the end of review can't be disputed

- **Location:** `reject` (line 381) with `dispute` (line 466) and `settleTimeout` (line 440) for FirstValid. `verifyAndAward` (line 349) with `settleTimeout` (lines 434 to 437) for verified bounties.
- **Impact:** The poster in FirstValid, or the verifier on verified bounties, can deny a valid entry with no recourse. The README's promise that a rejected or failed entrant can dispute isn't backed by a guaranteed window.
- **Scenario (FirstValid):** Alice submits valid work. The poster calls `reject(id, 0)` at `reviewEnd - 1`. From `reviewEnd`, Alice's `dispute` reverts with `TooLate`, and `settleTimeout` refunds the poster in full with no fee.
- **Scenario (verified):** The verifier fails the only entry at `reviewEnd - 1`. With nothing unchecked, `settleTimeout` succeeds at `reviewEnd`, the poster gets the reward and the forfeited stake, and Alice's `dispute` reverts with `BadState`.
- **Proof:** `M-2a: a first-valid rejection made at the end of review can still be disputed` and `M-2b: a failed check made at the end of the grace window can still be disputed`
- **Fix:** Give each rejection and each failed check its own dispute window, for example `rejectedAt` or `checkedAt` plus `disputeWindow`, and make `settleTimeout` wait for the latest one to close.

### M-3. Forfeited entry stakes go to the poster and stay there even when the check was wrong

- **Location:** `verifyAndAward` (line 363), `_settleStake` (lines 756 to 763), `resolveDispute` (lines 482 to 512), and `createVerifiedBounty` (line 239, no ratio between stake and reward).
- **Impact:** The poster writes the check and receives every forfeited stake, so a broken or impossible check turns a verified bounty into a stake trap. The arbiter can overturn the result but can't return the stake. Each entrant can lose up to 100 USDC, or 5,000 USDC across 50 entries, against a 1 USDC reward.
- **Scenario:** The poster posts a 1 USDC reward with a 100 USDC stake and a check no correct solution can pass. Alice's correct entry fails and her 100 USDC lands in the poster's `claimable` at once, ready to withdraw. Alice disputes and the arbiter makes her the winner. She receives 0.95 USDC plus her bond, and the poster keeps her 100 USDC. The README lists this as a known shortcut, but because the poster profits, it's an exploit rather than an edge case.
- **Proof:** `M-3: an entrant whose failed check is overturned gets their stake back`
- **Fix:** Hold forfeited stakes on the bounty until it settles, and return a stake when the arbiter makes that entry a winner or overturns its result. Send forfeits to the protocol rather than the poster, or cap `entryStake` at a fraction of `reward`.

### M-4. On a stale rejection dispute, rejected spam is paid

- **Location:** `settleStaleDispute`, `_ghostSplit(id, b, true)` (line 528).
- **Impact:** On a FirstValid bounty, spammers can take most of the escrow whenever the arbiter is slow, and the poster is frozen out of awarding the valid entry. The code comment says the original outcome stands, but this outcome pays every entry the poster rejected.
- **Scenario:** Four spam entries (one actor) and Alice's valid entry. The poster rejects all four spam entries. Before the poster can award Alice, the spammer disputes their own rejection, and `award` now reverts. The arbiter is silent for 14 days, and `settleStaleDispute` splits 950 USDC across all five entries. The spammer takes 760 USDC and gets the bond back.
- **Proof:** `M-4: a silent arbiter on a rejection dispute does not pay the rejected spam`
- **Fix:** For a rejection dispute that times out, restore the poster's position: either reopen the bounty with its review time left so the poster can award, or ghost-split with `includeRejected = false`. Forfeit the bond in this case, because the dispute was never upheld.

### M-5. The owner can set any featured price, which lets them take a poster's whole approval

- **Location:** `setFeaturedPrice` (line 596, no cap), `_create` (lines 260 to 261) and `feature` (lines 299 to 300), neither of which takes a maximum cost.
- **Impact:** This breaks the brief's rule that no admin backdoor can take users' deposits. Posters routinely approve `MaxUint256` (the seed script and tests do). The disputeBond isn't snapshotted either, but it's capped at 1,000 USDC, so the featured price is the serious one.
- **Scenario:** A poster signs `createBounty(..., reward 1000, featureDays 1)` and expects to pay 1,010 USDC. The owner's `setFeaturedPrice(balance - 1000)` lands first. The poster's entire 10,000 USDC moves into `feesAccrued`, and anyone can send it to the treasury.
- **Proof:** `M-5: the owner cannot raise the featured price to take a poster's whole approval`
- **Fix:** Cap `featuredPricePerDay` with a constant, as the fee and bond are capped. Add a `maxFeatureCost` argument to `createBounty`, `createVerifiedBounty` and `feature`, and a `maxBond` argument to `dispute`.

## Low

### L-1. Tips pay the current global fee, not the fee locked into the bounty

- **Location:** `tip` (line 543) reads `feeBps` instead of `b.feeBps`.
- **Impact:** The owner can raise the take on tips for existing bounties up to the 10% cap. The README says the fee is locked into each bounty and that tips pay "the same 5% fee".
- **Scenario:** The bounty is posted at 5% and the owner then sets 10%. A 100 USDC tip pays 10 USDC in fees instead of 5.
- **Proof:** `L-1: a tip pays the fee locked into the bounty, not the current global fee`
- **Fix:** Use `b.feeBps` in `tip`.

### L-2. A disputer who correctly exposes a bad award loses the bond unless they become the winner

- **Location:** `resolveDispute` (lines 499 to 510).
- **Impact:** Honest challenges by anyone except the rightful winner don't pay, so bad awards are less likely to be challenged. This matches the README's wording, but it works against the purpose of disputes.
- **Scenario:** The poster awards a friend's weak entry. Bob notices and disputes. The arbiter agrees and gives the award to Alice. Bob's 5 USDC bond goes to the protocol.
- **Proof:** `L-2: a disputer who exposes a bad award keeps the bond when the arbiter overturns it`
- **Fix:** Return the bond whenever the arbiter changes the outcome (the new ranks differ from the originals, or the result moves away from a refund), not only when the disputer is among the winners.

## Info

### I-1. Closing a stale dispute emits no dispute event

- **Location:** `settleStaleDispute` (lines 517 to 532).
- **Impact:** An indexer following `Disputed` and `DisputeResolved` never sees the dispute close, and the bond refund to the disputer emits no event at all. Bonds forfeited in `resolveDispute` aren't evented separately either.
- **Proof:** `I-1: closing a stale dispute emits an event that says the dispute ended`
- **Fix:** Emit `DisputeResolved(id, [], false)` or a dedicated `DisputeTimedOut(id, disputer, bondReturned)`.

### I-2. A ghost split doesn't say who was paid

- **Location:** `_ghostSplit` (lines 717 to 742) emits only `GhostPaid(id, count, total)`.
- **Impact:** Indexers and earnings boards can't credit ghost-split recipients from logs. They have to call `getSubmissions` on every bounty, and the first recipient gets the rounding dust, so `total / count` isn't exact either.
- **Proof:** `I-2: a ghost split emits who was paid and how much`
- **Fix:** Emit a per-recipient event, for example `GhostShare(id, index, hunter, amount)`.

## Checked and sound

- **Solvency.** Traced every state change: create (reward plus feature fee into `feesAccrued`), submit (`stakeHeld`), fail (stake to `claimable`), `_payRanks`, `_ghostSplit`, `_refund`, `dispute` (bond), `resolveDispute`, `settleStaleDispute`, `tip`, `withdraw` and `withdrawFees`. Balance always equals open escrow plus `stakeHeld`, bonds, `claimable` and `feesAccrued`. Rounding remainders in `_payRanks` (`net - paid` to the last winner) and `_ghostSplit` (dust to the first) are exact, with no overpay.
- **Double settlement.** Every settle path sets a terminal status first (`Paid`, `GhostPaid` or `Refunded`), and every entry point requires `Open`, `Awarded` or `Disputed`. `_settleStake` is idempotent through `stakeSettled`. No bounty can be paid twice.
- **Reentrancy.** The only external calls go to the immutable USDC token. Every function that moves tokens is `nonReentrant` and updates state before transferring (`withdraw` zeroes first). `award` and `reject` make no external calls.
- **Access control.** `verifyAndAward` is locked to the snapshotted `b.verifier`, `resolveDispute` to the snapshotted `b.arbiter`, and `award` and `reject` to the poster. Admin setters only affect future bounties, except as noted in L-1 and M-5. No function moves escrow to the owner, treasury, arbiter or verifier. The arbiter can only pick indexes among existing entries, with up to 3 for Top3 and 1 otherwise, no duplicates, or a refund.
- **Verifier limits.** It can't pay a nonexistent index, can't check an entry twice, can't pass an entry while an earlier one is unchecked (the whole call reverts), and can't act after `reviewEnd` or on a bounty that isn't `Open`.
- **Deadlines.** `submit` takes entries while `t < deadline`. Winner-takes-all and top 3 award from `deadline <= t < reviewEnd`. `settleTimeout` runs from `t >= reviewEnd`, and verified disputes run while `t < reviewEnd + 14 days` with unchecked settlement from `t >= reviewEnd + 14 days`. Each boundary is consistent, with no gap or overlap, apart from the missing dispute windows in M-2. Entry order uses array indexes, never timestamps, so timestamps that repeat across Arc blocks don't matter.
- **Fees.** `MAX_FEE_BPS` is 10%, and the fee is snapshotted per bounty for payouts and ghost splits. Refunds pay no fee.
- **Arc specifics.** All accounting goes through the ERC-20 interface, with no `payable` functions or `msg.value`. `prevrandao` isn't used. Transfers go only to `msg.sender` (in `withdraw`) or `treasury` (never zero, because the setter and constructor check). Payments are pulled, so a blocklisted address freezes only its own `claimable`. A blocklisted treasury stalls fees until the owner changes it.
- **Gas.** Loops are bounded by `MAX_SUBMISSIONS = 50` and at most 3 winners. `_hunters` grows without limit, but only the `getHunters` view reads it, so it's an RPC concern, not an onchain one.
- **ArenaTextStore.** Its content is addressed by hash, the first publish wins, and its size is bounded. Clients verify text against the hash. The recorded `author` is just whoever published first, so it isn't evidence of authorship (relevant to H-1).

## Trust assumptions that remain

- **The verifier** runs each check honestly and stays online. It can fail a correct entry (and with M-2, do so without recourse), or stall the queue by never checking entry 0. The damage is limited to delay and stakes, not escrow theft.
- **The arbiter** rules honestly and within 14 days. It can give any bounty to any of its entrants or refund the poster. Several fallbacks (M-1, M-4) currently assume it acts.
- **The owner** sets fees up to 10% for future bounties, the treasury, the arbiter and verifier for future bounties, the bond up to 1,000 USDC, and the featured price (uncapped, see M-5). The owner can also renounce ownership, which freezes all of these settings for good.
- **Posters on judged bounties** can award a sybil, at the cost of the fee and an open dispute window. Stats such as `posted`, `earned` and `wins` can be inflated this way, so the leaderboards aren't sybil resistant. The agent flag is self-declared.
- **USDC on Arc.** If Circle blocklists the arena contract itself, all escrow is frozen. USDC sent to the contract by plain `transfer` has no recovery function and stays there, without affecting solvency.
- **Off-chain code** (the JavaScript sandbox, the verifier watcher and the SDK) was out of scope except where noted in H-1.
