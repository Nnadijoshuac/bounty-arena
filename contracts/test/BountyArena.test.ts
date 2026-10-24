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
const spec = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

enum Mode {
  WinnerTakesAll,
  Top3Split,
  FirstValid,
  Verified,
}
enum Category {
  Code,
  Research,
  Design,
  Data,
  Content,
}
enum Status {
  Open,
  Awarded,
  Disputed,
  Paid,
  GhostPaid,
  Refunded,
}

async function deploy() {
  const [owner, treasury, arbiter, poster, alice, bob, carol, agent, outsider, verifier] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC");
  const arena = await ethers.deployContract("BountyArena", [
    await usdc.getAddress(),
    treasury.address,
    arbiter.address,
    verifier.address,
  ]);
  const arenaAddr = await arena.getAddress();
  for (const s of [poster, alice, bob, carol, agent, outsider]) {
    await usdc.mint(s.address, USDC(100_000));
    await usdc.connect(s).approve(arenaAddr, ethers.MaxUint256);
  }
  await arena.connect(alice).register("alice", false);
  await arena.connect(bob).register("bob", false);
  await arena.connect(carol).register("carol", false);
  await arena.connect(agent).register("orca-agent", true);

  async function post(opts: { reward?: bigint; mode?: Mode; category?: Category; duration?: number; feature?: number } = {}) {
    const deadline = (await time.latest()) + (opts.duration ?? 2 * DAY);
    const tx = await arena
      .connect(poster)
      .createBounty(
        "Build a thing",
        spec("spec text"),
        opts.category ?? Category.Code,
        opts.mode ?? Mode.WinnerTakesAll,
        opts.reward ?? USDC(1000),
        deadline,
        opts.feature ?? 0, USDC(1000), 0, 0);
    await tx.wait();
    const id = (await arena.bountyCount()) - 1n;
    return { id, deadline };
  }

  /// Every token the arena holds must be owed to someone: open escrow, claimables, fees or bonds.
  async function expectSolvent() {
    const balance = await usdc.balanceOf(arenaAddr);
    let owed = await arena.feesAccrued();
    const n = await arena.bountyCount();
    for (let i = 0n; i < n; i++) {
      const b = await arena.getBounty(i);
      if (b.status === BigInt(Status.Open) || b.status === BigInt(Status.Awarded) || b.status === BigInt(Status.Disputed)) {
        owed += b.reward;
      }
      owed += b.bond + b.stakeHeld;
    }
    const everyone = [owner, treasury, arbiter, poster, alice, bob, carol, agent, outsider, verifier];
    for (const s of everyone) owed += await arena.claimable(s.address);
    expect(balance).to.equal(owed);
  }

  async function postVerified(opts: { reward?: bigint; stake?: bigint; duration?: number } = {}) {
    const deadline = (await time.latest()) + (opts.duration ?? 2 * DAY);
    await (
      await arena
        .connect(poster)
        .createVerifiedBounty(
          "Write isValidIban",
          spec("spec"),
          spec("check: 12 tests"),
          Category.Code,
          opts.reward ?? USDC(1000),
          deadline,
          0, USDC(1000), opts.stake ?? 0n, 0)
    ).wait();
    const id = (await arena.bountyCount()) - 1n;
    return { id, deadline };
  }

  return { owner, treasury, arbiter, poster, alice, bob, carol, agent, outsider, verifier, usdc, arena, post, postVerified, expectSolvent };
}

describe("BountyArena", () => {
  describe("posting and escrow", () => {
    it("escrows the reward and records poster stats", async () => {
      const { arena, usdc, poster, post } = await loadFixture(deploy);
      const before = await usdc.balanceOf(poster.address);
      const { id } = await post({ reward: USDC(250) });
      expect(await usdc.balanceOf(poster.address)).to.equal(before - USDC(250));
      const b = await arena.getBounty(id);
      expect(b.reward).to.equal(USDC(250));
      expect(b.status).to.equal(Status.Open);
      expect(b.feeBps).to.equal(500);
      const s = await arena.getStats(poster.address);
      expect(s.bountiesPosted).to.equal(1);
      expect(s.posted).to.equal(USDC(250));
    });

    it("rejects tiny rewards, empty specs and bad deadlines", async () => {
      const { arena, poster } = await loadFixture(deploy);
      const now = await time.latest();
      await expect(
        arena.connect(poster).createBounty("t", spec("s"), 0, 0, USDC("0.5"), now + DAY, 0, USDC(1000), 0, 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(
        arena.connect(poster).createBounty("t", ethers.ZeroHash, 0, 0, USDC(5), now + DAY, 0, USDC(1000), 0, 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(
        arena.connect(poster).createBounty("t", spec("s"), 0, 0, USDC(5), now + 60, 0, USDC(1000), 0, 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(
        arena.connect(poster).createBounty("t", spec("s"), 0, 0, USDC(5), now + 91 * DAY, 0, USDC(1000), 0, 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(
        arena.connect(poster).createBounty("", spec("s"), 0, 0, USDC(5), now + DAY, 0, USDC(1000), 0, 0),
      ).to.be.revertedWithCustomError(arena, "BadInput");
    });

    it("charges featured boosts to the protocol and extends them", async () => {
      const { arena, poster, outsider, post } = await loadFixture(deploy);
      const { id } = await post({ feature: 3 });
      expect(await arena.feesAccrued()).to.equal(USDC(30));
      const b1 = await arena.getBounty(id);
      await arena.connect(outsider).feature(id, 2, USDC(1000));
      const b2 = await arena.getBounty(id);
      expect(b2.featuredUntil - b1.featuredUntil).to.equal(2n * BigInt(DAY));
      expect(await arena.feesAccrued()).to.equal(USDC(50));
      await expect(arena.connect(poster).feature(id, 0, USDC(1000))).to.be.revertedWithCustomError(arena, "BadInput");
    });
  });

  describe("submissions and deadlines", () => {
    it("records the human or agent flag on each submission", async () => {
      const { arena, alice, agent, post } = await loadFixture(deploy);
      const { id } = await post();
      await enter(arena, alice, id, "a");
      await enter(arena, agent, id, "b");
      const subs = await arena.getSubmissions(id);
      expect(subs.length).to.equal(2);
      expect(subs[0].isAgent).to.equal(false);
      expect(subs[1].isAgent).to.equal(true);
      expect((await arena.getStats(agent.address)).submissions).to.equal(1);
    });

    it("blocks submissions after the deadline", async () => {
      const { arena, alice, post } = await loadFixture(deploy);
      const { id, deadline } = await post();
      await time.increaseTo(deadline);
      await expect(arena.connect(alice).submit(id, spec("late"))).to.be.revertedWithCustomError(arena, "TooLate");
    });

    it("blocks unregistered hunters, double submits and the poster", async () => {
      const { arena, alice, outsider, poster, post } = await loadFixture(deploy);
      const { id } = await post();
      await expect(arena.connect(outsider).submit(id, spec("x"))).to.be.revertedWithCustomError(arena, "NotRegistered");
      await enter(arena, alice, id, "x");
      await expect(arena.connect(alice).submit(id, spec("y"))).to.be.revertedWithCustomError(arena, "AlreadySubmitted");
      await arena.connect(poster).register("poster", false);
      await expect(arena.connect(poster).submit(id, spec("z"))).to.be.revertedWithCustomError(arena, "BadInput");
    });

    it("locks the agent flag after the first submission", async () => {
      const { arena, agent, post } = await loadFixture(deploy);
      const { id } = await post();
      await enter(arena, agent, id, "a");
      await expect(arena.connect(agent).register("orca", false)).to.be.revertedWithCustomError(arena, "BadState");
      await arena.connect(agent).register("orca-v2", true);
      expect((await arena.getStats(agent.address)).handle).to.equal("orca-v2");
    });
  });

  describe("winner takes all", () => {
    it("pays the winner minus a 5% fee after the dispute window", async () => {
      const { arena, usdc, alice, bob, poster, treasury, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(1000) });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await expect(arena.connect(poster).award(id, [1])).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [1]);
      await expect(arena.finalize(id)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increase(2 * DAY);
      await arena.finalize(id);
      expect(await arena.claimable(bob.address)).to.equal(USDC(950));
      expect(await arena.claimable(alice.address)).to.equal(0);
      expect(await arena.feesAccrued()).to.equal(USDC(50));
      await expectSolvent();

      const before = await usdc.balanceOf(bob.address);
      await arena.connect(bob).withdraw();
      expect(await usdc.balanceOf(bob.address)).to.equal(before + USDC(950));
      await arena.withdrawFees();
      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC(50));
      await expectSolvent();
    });

    it("rejects more than one winner", async () => {
      const { arena, alice, bob, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post();
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await time.increaseTo(deadline);
      await expect(arena.connect(poster).award(id, [0, 1])).to.be.revertedWithCustomError(arena, "BadInput");
    });
  });

  describe("top 3 split", () => {
    it("splits 50 / 30 / 20 of the net payout", async () => {
      const { arena, alice, bob, carol, agent, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(1000), mode: Mode.Top3Split });
      for (const s of [alice, bob, carol, agent]) await enter(arena, s, id, s.address);
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [3, 0, 2]);
      await time.increase(2 * DAY);
      await arena.finalize(id);
      expect(await arena.claimable(agent.address)).to.equal(USDC(475));
      expect(await arena.claimable(alice.address)).to.equal(USDC(285));
      expect(await arena.claimable(carol.address)).to.equal(USDC(190));
      expect(await arena.claimable(bob.address)).to.equal(0);
      const subs = await arena.getSubmissions(id);
      expect(subs[3].rank).to.equal(1);
      expect(subs[0].rank).to.equal(2);
      expect(subs[2].rank).to.equal(3);
      await expectSolvent();
    });

    it("renormalises when only two winners are picked", async () => {
      const { arena, alice, bob, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(800), mode: Mode.Top3Split });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [1, 0]);
      await time.increase(2 * DAY);
      await arena.finalize(id);
      // net 760, weights 50:30 -> 475 / 285
      expect(await arena.claimable(bob.address)).to.equal(USDC(475));
      expect(await arena.claimable(alice.address)).to.equal(USDC(285));
      await expectSolvent();
    });

    it("rejects duplicate and out of range winners", async () => {
      const { arena, alice, bob, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post({ mode: Mode.Top3Split });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await time.increaseTo(deadline);
      await expect(arena.connect(poster).award(id, [0, 0])).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(arena.connect(poster).award(id, [0, 5])).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(arena.connect(poster).award(id, [0, 1, 0, 1])).to.be.revertedWithCustomError(arena, "BadInput");
    });
  });

  describe("first valid", () => {
    it("can be awarded before the deadline and closes the race", async () => {
      const { arena, alice, bob, carol, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id } = await post({ reward: USDC(300), mode: Mode.FirstValid });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await expect(arena.connect(poster).award(id, [1])).to.be.revertedWithCustomError(arena, "FirstValidOrder");
      await arena.connect(poster).reject(id, 0);
      await arena.connect(poster).award(id, [1]);
      await expect(arena.connect(carol).submit(id, spec("c"))).to.be.revertedWithCustomError(arena, "BadState");
      await time.increase(2 * DAY);
      await arena.finalize(id);
      expect(await arena.claimable(bob.address)).to.equal(USDC(285));
      await expectSolvent();
    });

    // Changed by the audit fix for H-2: posters can now reject in every poster-judged mode,
    // and only verified bounties (judged by the verifier) refuse a poster rejection.
    it("cannot award a rejected submission, and only verified bounties refuse a poster rejection", async () => {
      const { arena, alice, poster, post, postVerified } = await loadFixture(deploy);
      const fv = await post({ mode: Mode.FirstValid });
      await enter(arena, alice, fv.id, "a");
      await arena.connect(poster).reject(fv.id, 0);
      await expect(arena.connect(poster).award(fv.id, [0])).to.be.revertedWithCustomError(arena, "BadInput");
      const wta = await post();
      await enter(arena, alice, wta.id, "a");
      await expect(arena.connect(poster).reject(wta.id, 0)).to.emit(arena, "Rejected");
      const v = await postVerified();
      await enter(arena, alice, v.id, "a");
      await expect(arena.connect(poster).reject(v.id, 0)).to.be.revertedWithCustomError(arena, "BadState");
    });
  });

  describe("ghost poster and refunds", () => {
    it("splits the escrow evenly when the poster misses the review window", async () => {
      const { arena, alice, bob, carol, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(1000) });
      for (const s of [alice, bob, carol]) await enter(arena, s, id, s.address);
      await time.increaseTo(deadline);
      await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increaseTo(deadline + 3 * DAY);
      await expect(arena.connect(poster).award(id, [0])).to.be.revertedWithCustomError(arena, "TooLate");
      await arena.settleTimeout(id);
      const b = await arena.getBounty(id);
      expect(b.status).to.equal(Status.GhostPaid);
      // net 950 split three ways: 316.666666 each, dust to the first
      expect(await arena.claimable(alice.address)).to.equal(316_666_668n);
      expect(await arena.claimable(bob.address)).to.equal(316_666_666n);
      expect(await arena.claimable(carol.address)).to.equal(316_666_666n);
      expect(await arena.feesAccrued()).to.equal(USDC(50));
      // ghost payouts count as earnings, not wins
      const s = await arena.getStats(alice.address);
      expect(s.wins).to.equal(0);
      expect(s.earned).to.equal(316_666_668n);
      await expectSolvent();
    });

    it("skips rejected submissions in a first-valid ghost split", async () => {
      const { arena, alice, bob, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(100), mode: Mode.FirstValid });
      await enter(arena, alice, id, "a");
      await enter(arena, bob, id, "b");
      await arena.connect(poster).reject(id, 0);
      await time.increaseTo(deadline + 3 * DAY);
      await arena.settleTimeout(id);
      expect(await arena.claimable(alice.address)).to.equal(0);
      expect(await arena.claimable(bob.address)).to.equal(USDC(95));
      await expectSolvent();
    });

    it("refunds the poster in full when nobody submits", async () => {
      const { arena, usdc, poster, outsider, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(400) });
      await expect(arena.connect(poster).reclaim(id)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increaseTo(deadline);
      await expect(arena.connect(outsider).reclaim(id)).to.be.revertedWithCustomError(arena, "NotPoster");
      await arena.connect(poster).reclaim(id);
      expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
      expect(await arena.claimable(poster.address)).to.equal(USDC(400));
      expect(await arena.feesAccrued()).to.equal(0);
      const before = await usdc.balanceOf(poster.address);
      await arena.connect(poster).withdraw();
      expect(await usdc.balanceOf(poster.address)).to.equal(before + USDC(400));
      await expectSolvent();
    });

    it("does not let the poster reclaim once someone has submitted", async () => {
      const { arena, alice, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post();
      await enter(arena, alice, id, "a");
      await time.increaseTo(deadline);
      await expect(arena.connect(poster).reclaim(id)).to.be.revertedWithCustomError(arena, "BadState");
    });

    it("refunds through settleTimeout when every submission was rejected", async () => {
      const { arena, alice, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: USDC(100), mode: Mode.FirstValid });
      await enter(arena, alice, id, "a");
      await arena.connect(poster).reject(id, 0);
      await time.increaseTo(deadline + 3 * DAY);
      await arena.settleTimeout(id);
      expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
      expect(await arena.claimable(poster.address)).to.equal(USDC(100));
      await expectSolvent();
    });
  });

  describe("disputes", () => {
    async function awarded() {
      const f = await loadFixture(deploy);
      const { id, deadline } = await f.post({ reward: USDC(1000) });
      await enter(f.arena, f.alice, id, "a");
      await enter(f.arena, f.bob, id, "b");
      await time.increaseTo(deadline);
      await f.arena.connect(f.poster).award(id, [0]);
      return { ...f, id };
    }

    it("freezes the payout and lets the arbiter overturn it, returning the bond", async () => {
      const { arena, arbiter, alice, bob, outsider, id, expectSolvent } = await awarded();
      await expect(arena.connect(outsider).dispute(id)).to.be.revertedWithCustomError(arena, "NotSubmitter");
      await arena.connect(bob).dispute(id);
      expect((await arena.getBounty(id)).status).to.equal(Status.Disputed);
      await time.increase(3 * DAY);
      await expect(arena.finalize(id)).to.be.revertedWithCustomError(arena, "BadState");
      await expect(arena.connect(outsider).resolveDispute(id, [1])).to.be.revertedWithCustomError(arena, "NotArbiter");
      await arena.connect(arbiter).resolveDispute(id, [1]);
      expect(await arena.claimable(bob.address)).to.equal(USDC(950) + USDC(5));
      expect(await arena.claimable(alice.address)).to.equal(0);
      expect((await arena.getStats(bob.address)).wins).to.equal(1);
      expect((await arena.getStats(alice.address)).wins).to.equal(0);
      await expectSolvent();
    });

    it("forfeits the bond to the protocol when the award stands", async () => {
      const { arena, arbiter, alice, bob, id, expectSolvent } = await awarded();
      await arena.connect(bob).dispute(id);
      await arena.connect(arbiter).resolveDispute(id, [0]);
      expect(await arena.claimable(alice.address)).to.equal(USDC(950));
      expect(await arena.claimable(bob.address)).to.equal(0);
      expect(await arena.feesAccrued()).to.equal(USDC(55));
      await expectSolvent();
    });

    it("lets the arbiter refund the poster with an empty ruling", async () => {
      const { arena, arbiter, poster, bob, id, expectSolvent } = await awarded();
      await arena.connect(bob).dispute(id);
      await arena.connect(arbiter).resolveDispute(id, []);
      expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
      expect(await arena.claimable(poster.address)).to.equal(USDC(1000));
      await expectSolvent();
    });

    it("closes the dispute window after it ends", async () => {
      const { arena, bob, id } = await awarded();
      await time.increase(2 * DAY);
      await expect(arena.connect(bob).dispute(id)).to.be.revertedWithCustomError(arena, "TooLate");
    });

    it("lets a rejected first-valid hunter dispute before the review window ends", async () => {
      const { arena, arbiter, alice, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id } = await post({ reward: USDC(200), mode: Mode.FirstValid });
      await enter(arena, alice, id, "a");
      await arena.connect(poster).reject(id, 0);
      await arena.connect(alice).dispute(id);
      await arena.connect(arbiter).resolveDispute(id, [0]);
      expect(await arena.claimable(alice.address)).to.equal(USDC(190) + USDC(5));
      await expectSolvent();
    });

    it("falls back to the original award if the arbiter never rules", async () => {
      const { arena, alice, bob, id, expectSolvent } = await awarded();
      await arena.connect(bob).dispute(id);
      await expect(arena.settleStaleDispute(id)).to.be.revertedWithCustomError(arena, "TooEarly");
      await time.increase(14 * DAY);
      await arena.settleStaleDispute(id);
      expect(await arena.claimable(alice.address)).to.equal(USDC(950));
      expect(await arena.claimable(bob.address)).to.equal(USDC(5));
      await expectSolvent();
    });

    it("snapshots the arbiter so a later change cannot rule on old bounties", async () => {
      const { arena, owner, outsider, bob, id } = await awarded();
      await arena.connect(owner).setArbiter(outsider.address);
      await arena.connect(bob).dispute(id);
      await expect(arena.connect(outsider).resolveDispute(id, [1])).to.be.revertedWithCustomError(arena, "NotArbiter");
    });
  });

  describe("fees and tips", () => {
    it("caps the fee and applies it only to new bounties", async () => {
      const { arena, owner, alice, poster, post, expectSolvent } = await loadFixture(deploy);
      await expect(arena.connect(owner).setFeeBps(1001)).to.be.revertedWithCustomError(arena, "BadInput");
      await expect(arena.connect(poster).setFeeBps(0)).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
      const { id, deadline } = await post({ reward: USDC(1000) });
      await arena.connect(owner).setFeeBps(1000);
      await enter(arena, alice, id, "a");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [0]);
      await time.increase(2 * DAY);
      await arena.finalize(id);
      expect(await arena.claimable(alice.address)).to.equal(USDC(950));
      const next = await post({ reward: USDC(1000) });
      expect((await arena.getBounty(next.id)).feeBps).to.equal(1000);
      await expectSolvent();
    });

    it("computes the fee exactly on odd amounts", async () => {
      const { arena, alice, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post({ reward: 1_234_567n });
      await enter(arena, alice, id, "a");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [0]);
      await time.increase(2 * DAY);
      await arena.finalize(id);
      const fee = (1_234_567n * 500n) / 10_000n;
      expect(await arena.feesAccrued()).to.equal(fee);
      expect(await arena.claimable(alice.address)).to.equal(1_234_567n - fee);
    });

    it("routes tips to the hunter minus the fee", async () => {
      const { arena, alice, poster, post, expectSolvent } = await loadFixture(deploy);
      const { id } = await post();
      await enter(arena, alice, id, "a");
      await arena.connect(poster).tip(id, 0, USDC(20));
      expect(await arena.claimable(alice.address)).to.equal(USDC(19));
      expect((await arena.getStats(alice.address)).tipsReceived).to.equal(USDC(19));
      expect(await arena.feesAccrued()).to.equal(USDC(1));
      await expectSolvent();
    });

    it("sends fees only to the treasury, even when the owner triggers it", async () => {
      const { arena, usdc, owner, treasury, post } = await loadFixture(deploy);
      await post({ feature: 2 });
      const ownerBefore = await usdc.balanceOf(owner.address);
      await arena.connect(owner).withdrawFees();
      expect(await usdc.balanceOf(owner.address)).to.equal(ownerBefore);
      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC(20));
      await expect(arena.withdrawFees()).to.be.revertedWithCustomError(arena, "BadState");
    });
  });

  describe("reputation", () => {
    it("counts wins, earnings and category wins per address", async () => {
      const { arena, agent, alice, poster, post } = await loadFixture(deploy);
      const a = await post({ reward: USDC(100), category: Category.Data });
      const b = await post({ reward: USDC(200), category: Category.Research });
      await enter(arena, agent, a.id, "1");
      await enter(arena, alice, a.id, "2");
      await enter(arena, agent, b.id, "3");
      await time.increaseTo(b.deadline);
      await arena.connect(poster).award(a.id, [0]);
      await arena.connect(poster).award(b.id, [0]);
      await time.increase(2 * DAY);
      await arena.finalize(a.id);
      await arena.finalize(b.id);
      const s = await arena.getStats(agent.address);
      expect(s.isAgent).to.equal(true);
      expect(s.submissions).to.equal(2);
      expect(s.wins).to.equal(2);
      expect(s.earned).to.equal(USDC(285));
      expect(s.categoryWins[Category.Data]).to.equal(1);
      expect(s.categoryWins[Category.Research]).to.equal(1);
      expect(s.categoryWins[Category.Code]).to.equal(0);
      const hunters = await arena.getHunters();
      expect(hunters).to.include(agent.address);
      expect(hunters.length).to.equal(4);
    });
  });

  describe("attacks", () => {
    it("blocks reentrancy through a malicious token on withdraw", async () => {
      const [, treasury, arbiter, poster, hunter] = await ethers.getSigners();
      const token = await ethers.deployContract("ReentrantToken");
      const arena = await ethers.deployContract("BountyArena", [await token.getAddress(), treasury.address, arbiter.address, arbiter.address]);
      const arenaAddr = await arena.getAddress();
      await token.mint(poster.address, USDC(1000));
      await token.connect(poster).approve(arenaAddr, ethers.MaxUint256);
      const deadline = (await time.latest()) + DAY;
      await arena.connect(poster).createBounty("t", spec("s"), 0, 0, USDC(100), deadline, 0, USDC(1000), 0, 0);
      await arena.connect(hunter).register("h", false);
      await enter(arena, hunter, 0, "d");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(0, [0]);
      await time.increase(2 * DAY);
      await arena.finalize(0);
      await token.arm(arenaAddr);
      await expect(arena.connect(hunter).withdraw()).to.be.revertedWithCustomError(arena, "ReentrancyGuardReentrantCall");
      expect(await arena.claimable(hunter.address)).to.equal(USDC(95));
    });

    it("blocks double withdraw and withdraw with nothing owed", async () => {
      const { arena, alice, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post();
      await enter(arena, alice, id, "a");
      await time.increaseTo(deadline);
      await arena.connect(poster).award(id, [0]);
      await time.increase(2 * DAY);
      await arena.finalize(id);
      await arena.connect(alice).withdraw();
      await expect(arena.connect(alice).withdraw()).to.be.revertedWithCustomError(arena, "BadState");
      await expect(arena.connect(poster).withdraw()).to.be.revertedWithCustomError(arena, "BadState");
    });

    it("blocks strangers from awarding, rejecting or settling twice", async () => {
      const { arena, alice, outsider, poster, post } = await loadFixture(deploy);
      const { id, deadline } = await post({ mode: Mode.FirstValid });
      await enter(arena, alice, id, "a");
      await expect(arena.connect(outsider).award(id, [0])).to.be.revertedWithCustomError(arena, "NotPoster");
      await expect(arena.connect(outsider).reject(id, 0)).to.be.revertedWithCustomError(arena, "NotPoster");
      await arena.connect(poster).award(id, [0]);
      await expect(arena.connect(poster).award(id, [0])).to.be.revertedWithCustomError(arena, "BadState");
      await time.increaseTo(deadline + 5 * DAY);
      await arena.finalize(id);
      await expect(arena.finalize(id)).to.be.revertedWithCustomError(arena, "BadState");
      await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "BadState");
    });

    it("gives the owner no way to move escrow", async () => {
      const { arena, owner, usdc, treasury, post } = await loadFixture(deploy);
      await post({ reward: USDC(5000) });
      const arenaBal = await usdc.balanceOf(await arena.getAddress());
      // the only owner levers: config for future bounties
      await arena.connect(owner).setTreasury(owner.address);
      await arena.connect(owner).setFeeBps(1000);
      await expect(arena.connect(owner).withdrawFees()).to.be.revertedWithCustomError(arena, "BadState");
      await expect(arena.connect(owner).withdraw()).to.be.revertedWithCustomError(arena, "BadState");
      expect(await usdc.balanceOf(await arena.getAddress())).to.equal(arenaBal);
      expect(await usdc.balanceOf(treasury.address)).to.equal(0);
      const fns = arena.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => (f as any).name as string);
      for (const name of ["sweep", "rescue", "emergencyWithdraw", "recoverERC20"]) {
        expect(fns).to.not.include(name);
      }
    });

    it("blocks the arbiter from paying anyone outside the bounty", async () => {
      const f = await loadFixture(deploy);
      const { id, deadline } = await f.post();
      await enter(f.arena, f.alice, id, "a");
      await time.increaseTo(deadline);
      await f.arena.connect(f.poster).award(id, [0]);
      await expect(f.arena.connect(f.arbiter).resolveDispute(id, [0])).to.be.revertedWithCustomError(f.arena, "BadState");
      await f.arena.connect(f.alice).dispute(id);
      await expect(f.arena.connect(f.arbiter).resolveDispute(id, [7])).to.be.revertedWithCustomError(f.arena, "BadInput");
    });

    it("caps submissions per bounty so payout loops stay bounded", async () => {
      const { arena, usdc, poster, post } = await loadFixture(deploy);
      const { id } = await post();
      const max = Number(await arena.MAX_SUBMISSIONS());
      const signers: any[] = [];
      for (let i = 0; i < max + 1; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await poster.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
        signers.push(w);
      }
      for (let i = 0; i < max; i++) {
        await arena.connect(signers[i]).register(`h${i}`, i % 2 === 0);
        await arena.connect(signers[i]).submit(id, spec(String(i)));
      }
      await arena.connect(signers[max]).register("late", false);
      await expect(arena.connect(signers[max]).submit(id, spec("x"))).to.be.revertedWithCustomError(arena, "BadState");
      void usdc;
    });
  });
});
