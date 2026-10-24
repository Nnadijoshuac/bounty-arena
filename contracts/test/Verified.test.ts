import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

let saltN = 0;
/** Enters a bounty the way the SDK does: submit a commitment, then reveal the content hash and salt. */
async function enter(arena: any, who: any, id: bigint | number, text: string) {
  const content = ethers.keccak256(ethers.toUtf8Bytes(text));
  const salt = ethers.zeroPadValue(ethers.toBeHex(++saltN), 32);
  const commitment = await arena.commitmentFor(id, who.address, content, salt);
  await (await arena.connect(who).submit(id, commitment)).wait();
  const index = (await arena.getSubmissions(id)).length - 1;
  await (await arena.connect(who).reveal(id, index, content, salt)).wait();
  return index;
}

const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const h = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
const REPORT = h("report");

const Status = { Open: 0n, Awarded: 1n, Disputed: 2n, Paid: 3n, GhostPaid: 4n, Refunded: 5n };

async function deploy() {
  const [owner, treasury, arbiter, verifier, poster, alice, bob, agent, outsider] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC");
  const arena = await ethers.deployContract("BountyArena", [await usdc.getAddress(), treasury.address, arbiter.address, verifier.address]);
  const arenaAddr = await arena.getAddress();
  for (const s of [poster, alice, bob, agent, outsider]) {
    await usdc.mint(s.address, USDC(10_000));
    await usdc.connect(s).approve(arenaAddr, ethers.MaxUint256);
  }
  await arena.connect(alice).register("alice", false);
  await arena.connect(bob).register("bob", false);
  await arena.connect(agent).register("orca", true);
  await arena.connect(outsider).register("outsider", false);

  async function postVerified(opts: { reward?: bigint; stake?: bigint } = {}) {
    const deadline = (await time.latest()) + 2 * DAY;
    await arena
      .connect(poster)
      .createVerifiedBounty("isValidIban", h("spec"), h("check"), 0, opts.reward ?? USDC(1000), deadline, 0, USDC(1000), opts.stake ?? 0n, 0);
    return { id: (await arena.bountyCount()) - 1n, deadline };
  }

  async function expectSolvent() {
    let owed = await arena.feesAccrued();
    const n = await arena.bountyCount();
    for (let i = 0n; i < n; i++) {
      const b = await arena.getBounty(i);
      if (b.status <= Status.Disputed) owed += b.reward;
      owed += b.bond + b.stakeHeld;
    }
    for (const s of [owner, treasury, arbiter, verifier, poster, alice, bob, agent, outsider]) owed += await arena.claimable(s.address);
    expect(await usdc.balanceOf(arenaAddr)).to.equal(owed);
  }

  return { owner, treasury, arbiter, verifier, poster, alice, bob, agent, outsider, usdc, arena, postVerified, expectSolvent };
}

describe("Verified bounties", () => {
  it("stores the check hash, the verifier and a short grace window", async () => {
    const { arena, verifier, postVerified } = await loadFixture(deploy);
    const { id, deadline } = await postVerified({ stake: USDC(2) });
    const b = await arena.getBounty(id);
    expect(b.mode).to.equal(3);
    expect(b.checkHash).to.equal(h("check"));
    expect(b.verifier).to.equal(verifier.address);
    expect(b.entryStake).to.equal(USDC(2));
    expect(b.reviewEnd).to.equal(BigInt(deadline + HOUR));
  });

  it("rejects bad verified bounties and verified mode through createBounty", async () => {
    const { arena, poster } = await loadFixture(deploy);
    const dl = (await time.latest()) + DAY;
    await expect(
      arena.connect(poster).createVerifiedBounty("t", h("s"), ethers.ZeroHash, 0, USDC(5), dl, 0, USDC(1000), 0, 0),
    ).to.be.revertedWithCustomError(arena, "BadInput");
    await expect(
      arena.connect(poster).createVerifiedBounty("t", h("s"), h("c"), 0, USDC(5), dl, 0, USDC(1000), USDC(101), 0),
    ).to.be.revertedWithCustomError(arena, "BadInput");
    await expect(arena.connect(poster).createBounty("t", h("s"), 0, 3, USDC(5), dl, 0, USDC(1000), 0, 0)).to.be.revertedWithCustomError(arena, "BadInput");
  });

  it("pays the first passing entry instantly, minus the fee", async () => {
    const { arena, alice, agent, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
    const { id } = await postVerified({ reward: USDC(1000) });
    await enter(arena, alice, id, "buggy");
    await enter(arena, agent, id, "solution");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    expect((await arena.getBounty(id)).status).to.equal(Status.Open);
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT))
      .to.emit(arena, "WinnerPaid")
      .withArgs(id, agent.address, 1, USDC(950));
    const b = await arena.getBounty(id);
    expect(b.status).to.equal(Status.Paid);
    expect(b.settledAt).to.be.greaterThan(0);
    expect(await arena.claimable(agent.address)).to.equal(USDC(950));
    expect(await arena.feesAccrued()).to.equal(USDC(50));
    const subs = await arena.getSubmissions(id);
    expect(subs[0].checked && !subs[0].passed).to.equal(true);
    expect(subs[1].passed).to.equal(true);
    expect(subs[1].reportHash).to.equal(REPORT);
    expect((await arena.getStats(agent.address)).wins).to.equal(1);
    await expectSolvent();
  });

  it("blocks anyone but the verifier, including the poster and the arbiter", async () => {
    const { arena, alice, poster, arbiter, owner, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await enter(arena, alice, id, "a");
    for (const s of [poster, arbiter, owner, alice]) {
      await expect(arena.connect(s).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "NotVerifier");
    }
    await expect(arena.connect(poster).award(id, [0])).to.be.revertedWithCustomError(arena, "BadState");
  });

  it("can only pay an existing entrant, never a stranger", async () => {
    const { arena, alice, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await expect(arena.connect(verifier).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "BadInput");
    await enter(arena, alice, id, "a");
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT)).to.be.revertedWithCustomError(arena, "BadInput");
    await expect(arena.connect(verifier).verifyAndAward(id, 0, true, ethers.ZeroHash)).to.be.revertedWithCustomError(arena, "BadInput");
    expect(await arena.claimable(verifier.address)).to.equal(0);
  });

  it("blocks double awards and double checks", async () => {
    const { arena, alice, bob, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await enter(arena, alice, id, "a");
    await enter(arena, bob, id, "b");
    await arena.connect(verifier).verifyAndAward(id, 0, true, REPORT);
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT)).to.be.revertedWithCustomError(arena, "BadState");
    await expect(arena.connect(verifier).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "BadState");
    await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "BadState");
  });

  it("refuses to re-check an entry that already failed", async () => {
    const { arena, alice, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await enter(arena, alice, id, "a");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await expect(arena.connect(verifier).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "BadState");
  });

  it("judges entries in order: a later pass waits for every earlier result", async () => {
    const { arena, alice, agent, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await enter(arena, alice, id, "a");
    await enter(arena, agent, id, "b");
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT)).to.be.revertedWithCustomError(arena, "FirstValidOrder");
    // a fail can be posted out of order
    await arena.connect(verifier).verifyAndAward(id, 1, false, REPORT);
  });

  it("accepts a late check inside the grace window and refuses one after it", async () => {
    const { arena, alice, bob, verifier, postVerified } = await loadFixture(deploy);
    const { id, deadline } = await postVerified();
    await enter(arena, alice, id, "a");
    await enter(arena, bob, id, "b");
    await time.increaseTo(deadline + 10 * 60);
    await expect(arena.connect(alice).submit(id, h("late"))).to.be.revertedWithCustomError(arena, "TooLate");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await time.increaseTo(deadline + HOUR);
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT)).to.be.revertedWithCustomError(arena, "TooLate");
  });

  it("blocks entries after the deadline", async () => {
    const { arena, alice, postVerified } = await loadFixture(deploy);
    const { id, deadline } = await postVerified();
    await time.increaseTo(deadline);
    await expect(arena.connect(alice).submit(id, h("a"))).to.be.revertedWithCustomError(arena, "TooLate");
  });

  it("refunds the poster after the grace window when every entry failed", async () => {
    const { arena, poster, alice, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
    const { id, deadline } = await postVerified({ reward: USDC(300) });
    await enter(arena, alice, id, "a");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await time.increaseTo(deadline);
    await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly");
    await time.increaseTo(deadline + HOUR);
    await arena.settleTimeout(id);
    expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
    expect(await arena.claimable(poster.address)).to.equal(USDC(300));
    expect(await arena.claimable(alice.address)).to.equal(0);
    expect(await arena.feesAccrued()).to.equal(0);
    await expectSolvent();
  });

  it("refunds with no entries through reclaim", async () => {
    const { arena, poster, postVerified } = await loadFixture(deploy);
    const { id, deadline } = await postVerified({ reward: USDC(50) });
    await time.increaseTo(deadline);
    await arena.connect(poster).reclaim(id);
    expect(await arena.claimable(poster.address)).to.equal(USDC(50));
  });

  describe("entry stakes", () => {
    // Changed by the audit fix for M-3: a forfeited stake is held until that entry's dispute window closes.
    it("holds a failing entry's stake through its dispute window, then forfeits it to the poster", async () => {
      const { arena, usdc, poster, alice, bob, agent, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
      const { id } = await postVerified({ reward: USDC(500), stake: USDC(2) });
      const before = await usdc.balanceOf(alice.address);
      await enter(arena, alice, id, "a");
      expect(await usdc.balanceOf(alice.address)).to.equal(before - USDC(2));
      await enter(arena, agent, id, "b");
      await enter(arena, bob, id, "c");
      expect((await arena.getBounty(id)).stakeHeld).to.equal(USDC(6));
      await expectSolvent();

      await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
      expect(await arena.claimable(poster.address)).to.equal(0);
      await arena.connect(verifier).verifyAndAward(id, 1, true, REPORT);
      // winner gets payout plus stake back, the unchecked entrant gets their stake back
      expect(await arena.claimable(agent.address)).to.equal(USDC(475) + USDC(2));
      expect(await arena.claimable(bob.address)).to.equal(USDC(2));
      expect(await arena.claimable(alice.address)).to.equal(0);
      expect((await arena.getBounty(id)).stakeHeld).to.equal(USDC(2));
      await expect(arena.settleStake(id, 0)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increase(2 * DAY);
      await expect(arena.settleStake(id, 0)).to.emit(arena, "StakeSettled").withArgs(id, 0, poster.address, USDC(2), true);
      expect(await arena.claimable(poster.address)).to.equal(USDC(2));
      expect((await arena.getBounty(id)).stakeHeld).to.equal(0);
      await expectSolvent();
    });

    it("returns unchecked stakes when the verifier goes silent, after the 14 day fallback", async () => {
      const { arena, poster, alice, bob, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await postVerified({ reward: USDC(100), stake: USDC(1) });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
      await time.increaseTo(deadline + HOUR);
      await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increaseTo(deadline + HOUR + 14 * DAY);
      await arena.settleTimeout(id);
      expect(await arena.claimable(poster.address)).to.equal(USDC(100) + USDC(1));
      expect(await arena.claimable(bob.address)).to.equal(USDC(1));
      expect(await arena.claimable(alice.address)).to.equal(0);
      await expectSolvent();
    });

    it("caps the entry stake at 10% of the reward", async () => {
      const { arena, poster } = await loadFixture(deploy);
      const dl = (await time.latest()) + DAY;
      await expect(
        arena.connect(poster).createVerifiedBounty("t", h("s"), h("c"), 0, USDC(10), dl, 0, USDC(1000), USDC("1.01"), 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
      await arena.connect(poster).createVerifiedBounty("t", h("s"), h("c"), 0, USDC(10), dl, 0, USDC(1000), USDC(1), 0);
    });
  });

  // Changed by the audit fixes for M-1 and M-3: a verified challenge is per entry and does not freeze the bounty.
  describe("disputes on verified bounties", () => {
    it("lets a failed entrant challenge and the arbiter overturn the check, returning stake and bond", async () => {
      const { arena, arbiter, alice, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
      const { id } = await postVerified({ reward: USDC(200), stake: USDC(2) });
      await enter(arena, alice, id, "a");
      await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
      await arena.connect(alice).dispute(id);
      const b = await arena.getBounty(id);
      expect(b.status).to.equal(Status.Open);
      expect(b.openChallenges).to.equal(1);
      await expect(arena.connect(verifier).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "BadState");
      await arena.connect(arbiter).resolveChallenge(id, 0, true);
      // 190 payout, the 2 USDC stake back and the 5 USDC bond back
      expect(await arena.claimable(alice.address)).to.equal(USDC(190) + USDC(2) + USDC(5));
      expect((await arena.getBounty(id)).status).to.equal(Status.Paid);
      await expectSolvent();
    });

    it("blocks a passing entrant from disputing", async () => {
      const { arena, alice, bob, verifier, postVerified } = await loadFixture(deploy);
      const { id } = await postVerified();
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await arena.connect(verifier).verifyAndAward(id, 0, true, REPORT);
      await expect(arena.connect(alice).dispute(id)).to.be.revertedWithCustomError(arena, "BadState");
    });

    it("lets the failed check stand if the arbiter never rules, then refunds the poster", async () => {
      const { arena, poster, alice, bob, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await postVerified({ reward: USDC(80), stake: USDC(1) });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
      await arena.connect(verifier).verifyAndAward(id, 1, false, REPORT);
      await arena.connect(alice).dispute(id);
      await time.increaseTo(deadline + HOUR);
      await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly"); // challenge still open
      await time.increase(14 * DAY);
      await expect(arena.expireChallenge(id, 0)).to.emit(arena, "DisputeTimedOut");
      await arena.settleTimeout(id);
      expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
      // both stakes forfeited to the poster once their windows closed, and the bond came back
      expect(await arena.claimable(poster.address)).to.equal(USDC(80) + USDC(2));
      expect(await arena.claimable(alice.address)).to.equal(USDC(5));
      expect(await arena.claimable(bob.address)).to.equal(0);
      await expectSolvent();
    });

    it("pays a later passing entry once an earlier challenge is dismissed", async () => {
      const { arena, arbiter, alice, bob, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
      const { id } = await postVerified({ reward: USDC(100) });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
      await arena.connect(alice).dispute(id);
      await arena.connect(verifier).verifyAndAward(id, 1, true, REPORT);
      expect((await arena.getBounty(id)).status).to.equal(Status.Open); // held for the earlier challenge
      await arena.connect(arbiter).resolveChallenge(id, 0, false);
      expect(await arena.claimable(bob.address)).to.equal(USDC(95));
      await expectSolvent();
    });
  });


it("snapshots the verifier so a later change cannot judge old bounties", async () => {
    const { arena, owner, outsider, alice, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified();
    await arena.connect(owner).setVerifier(outsider.address);
    await enter(arena, alice, id, "a");
    await expect(arena.connect(outsider).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "NotVerifier");
    await arena.connect(verifier).verifyAndAward(id, 0, true, REPORT);
    await expect(arena.connect(alice).setVerifier(alice.address)).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
  });

  it("blocks reentrancy when a verified winner withdraws through a malicious token", async () => {
    const [, treasury, arbiter, verifier, poster, hunter] = await ethers.getSigners();
    const token = await ethers.deployContract("ReentrantToken");
    const arena = await ethers.deployContract("BountyArena", [await token.getAddress(), treasury.address, arbiter.address, verifier.address]);
    const addr = await arena.getAddress();
    await token.mint(poster.address, USDC(1000));
    await token.mint(hunter.address, USDC(10));
    await token.connect(poster).approve(addr, ethers.MaxUint256);
    await token.connect(hunter).approve(addr, ethers.MaxUint256);
    await arena.connect(poster).createVerifiedBounty("t", h("s"), h("c"), 0, USDC(100), (await time.latest()) + DAY, 0, USDC(1000), USDC(1), 0);
    await arena.connect(hunter).register("h", true);
    await enter(arena, hunter, 0, "d");
    await arena.connect(verifier).verifyAndAward(0, 0, true, REPORT);
    expect(await arena.claimable(hunter.address)).to.equal(USDC(96));
    await token.arm(addr);
    await expect(arena.connect(hunter).withdraw()).to.be.revertedWithCustomError(arena, "ReentrancyGuardReentrantCall");
    expect(await arena.claimable(hunter.address)).to.equal(USDC(96));
  });
});

describe("ArenaTextStore", () => {
  it("publishes text once and records the block for lookup", async () => {
    const store = await ethers.deployContract("ArenaTextStore");
    const text = "function isValidIban(s) { return true }";
    const hash = h(text);
    await expect(store.publish(1, text)).to.emit(store, "Published");
    const block = await store.blockOf(hash);
    expect(block).to.be.greaterThan(0);
    await expect(store.publish(1, text)).to.not.emit(store, "Published");
    expect(await store.blockOf(hash)).to.equal(block);
    const logs = await store.queryFilter(store.filters.Published(hash), Number(block), Number(block));
    expect(logs[0].args.text).to.equal(text);
    await expect(store.publish(1, "")).to.be.revertedWithCustomError(store, "BadText");
    await expect(store.publish(4, "x")).to.be.revertedWithCustomError(store, "BadText");
  });
});
