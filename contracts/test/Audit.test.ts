// Audit proofs, flipped. Each test replays the attack from ../../AUDIT.md and asserts that it now fails
// (the safe behaviour). The "Fixes" section of AUDIT.md maps each finding to its fix.
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const MIN = 60;
const h = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
const REPORT = h("report");
const MAX_PRICE = USDC(1000); // highest featured price per day a poster accepts in these tests

const Mode = { WinnerTakesAll: 0, Top3Split: 1, FirstValid: 2, Verified: 3 };
const Status = { Open: 0n, Awarded: 1n, Disputed: 2n, Paid: 3n, GhostPaid: 4n, Refunded: 5n };

let saltN = 1000;
const salt = () => ethers.zeroPadValue(ethers.toBeHex(++saltN), 32);

/** Commit, then reveal, the way the SDK does. Returns the entry index. */
async function enter(arena: any, who: any, id: bigint, text: string) {
  const content = h(text);
  const s = salt();
  await (await arena.connect(who).submit(id, await arena.commitmentFor(id, who.address, content, s))).wait();
  const index = (await arena.getSubmissions(id)).length - 1;
  await (await arena.connect(who).reveal(id, index, content, s)).wait();
  return index;
}

async function deploy() {
  const [owner, treasury, arbiter, verifier, poster, alice, bob, carol, mallory] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC");
  const arena = await ethers.deployContract("BountyArena", [await usdc.getAddress(), treasury.address, arbiter.address, verifier.address]);
  const store = await ethers.deployContract("ArenaTextStore");
  const arenaAddr = await arena.getAddress();
  for (const s of [poster, alice, bob, carol, mallory]) {
    await usdc.mint(s.address, USDC(10_000));
    await usdc.connect(s).approve(arenaAddr, ethers.MaxUint256);
  }
  await arena.connect(alice).register("alice", false);
  await arena.connect(bob).register("bob", false);
  await arena.connect(carol).register("carol", false);
  await arena.connect(mallory).register("mallory", true);

  async function postVerified(opts: { reward?: bigint; stake?: bigint } = {}) {
    const deadline = (await time.latest()) + 2 * DAY;
    await arena
      .connect(poster)
      .createVerifiedBounty("isValidIban", h("spec"), h("check"), 0, opts.reward ?? USDC(1000), deadline, 0, MAX_PRICE, opts.stake ?? 0n, 0);
    return { id: (await arena.bountyCount()) - 1n, deadline };
  }

  async function post(mode: number, reward = USDC(1000), stake = 0n) {
    const deadline = (await time.latest()) + 2 * DAY;
    await arena.connect(poster).createBounty("Build a thing", h("spec"), 0, mode, reward, deadline, 0, MAX_PRICE, stake, 0);
    return { id: (await arena.bountyCount()) - 1n, deadline };
  }

  /** Funded, approved and registered throwaway wallets. */
  async function sybils(n: number) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await network.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);
      await usdc.mint(w.address, USDC(100));
      await usdc.connect(w).approve(arenaAddr, ethers.MaxUint256);
      await arena.connect(w).register(`s${i}`, true);
      out.push(w);
    }
    return out;
  }

  /** Every token the arena holds is owed to someone. */
  async function expectSolvent(extra: any[] = []) {
    let owed = await arena.feesAccrued();
    const n = await arena.bountyCount();
    for (let i = 0n; i < n; i++) {
      const b = await arena.getBounty(i);
      if (b.status <= Status.Disputed) owed += b.reward;
      owed += b.bond + b.stakeHeld;
    }
    for (const s of [owner, treasury, arbiter, verifier, poster, alice, bob, carol, mallory, ...extra]) owed += await arena.claimable(s.address);
    expect(await usdc.balanceOf(arenaAddr)).to.equal(owed);
  }

  return { owner, treasury, arbiter, verifier, poster, alice, bob, carol, mallory, usdc, arena, store, postVerified, post, sybils, expectSolvent };
}

describe("Audit", () => {
  // ------------------------------------------------------------------ High

  it("H-1: a copied deliverable cannot take the reward from the hunter who wrote it", async () => {
    const { arena, store, alice, mallory, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
    const { id } = await postVerified({ reward: USDC(1000) });
    const solution = "function isValidIban(s){ /* alice's work */ return true }";
    const content = h(solution);
    const aliceSalt = salt();
    const aliceCommitment = await arena.commitmentFor(id, alice.address, content, aliceSalt);

    // Attack 1: Mallory copies Alice's commitment out of the mempool and lands first (index 0).
    await arena.connect(mallory).submit(id, aliceCommitment);
    await arena.connect(alice).submit(id, aliceCommitment); // index 1
    // The commitment is bound to Alice's address, so Mallory cannot reveal it.
    await expect(arena.connect(mallory).reveal(id, 0, content, aliceSalt)).to.be.revertedWithCustomError(arena, "BadInput");

    // Alice's entry is mined, so she publishes her text and reveals.
    await store.connect(alice).publish(1, solution);
    await arena.connect(alice).reveal(id, 1, content, aliceSalt);

    // Mallory's slot holds Alice's commitment, so no content and salt of hers can open it.
    const [ev] = await store.queryFilter(store.filters.Published(undefined, 1n));
    await expect(arena.connect(mallory).reveal(id, 0, ev.args.hash, salt())).to.be.revertedWithCustomError(arena, "BadInput");

    // Mallory's slot never revealed: the verifier can only fail it once its reveal window is over.
    await expect(arena.connect(verifier).verifyAndAward(id, 0, true, REPORT)).to.be.revertedWithCustomError(arena, "TooEarly");
    await time.increase(10 * MIN);
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await arena.connect(verifier).verifyAndAward(id, 1, true, REPORT);

    expect(await arena.claimable(mallory.address)).to.equal(0n, "the copier was paid");
    expect(await arena.claimable(alice.address)).to.equal(USDC(950));
    await expectSolvent();
  });

  it("H-1b: a copier who waits for the published text only gets a later slot and cannot reveal the same content", async () => {
    const { arena, store, alice, carol, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified({ reward: USDC(1000) });
    const solution = "function isValidIban(s){ return true }";
    await enter(arena, alice, id, solution); // commit (mined), then publish and reveal
    await store.connect(alice).publish(1, solution);

    const s = salt();
    await arena.connect(carol).submit(id, await arena.commitmentFor(id, carol.address, h(solution), s));
    await expect(arena.connect(carol).reveal(id, 1, h(solution), s)).to.be.revertedWithCustomError(arena, "DuplicateContent");
    await arena.connect(verifier).verifyAndAward(id, 0, true, REPORT);
    expect(await arena.claimable(alice.address)).to.equal(USDC(950));
    expect(await arena.claimable(carol.address)).to.equal(0n);
  });

  it("H-2: sybils filling every slot of a winner-takes-all bounty cannot capture the escrow", async () => {
    const { arena, poster, alice, post, sybils, expectSolvent } = await loadFixture(deploy);
    // The poster asks for a 10 USDC entry stake (1% of the reward).
    const { id } = await post(Mode.WinnerTakesAll, USDC(1000), USDC(10));

    const ws = await sybils(50);
    for (let i = 0; i < ws.length; i++) await enter(arena, ws[i], id, `junk ${i}`);
    await expect(arena.connect(alice).submit(id, h("real work"))).to.be.revertedWithCustomError(arena, "BadState");

    // The poster can now turn the junk down in this mode, in one transaction.
    await arena.connect(poster).rejectMany(id, ws.map((_, i) => i));

    await time.increase(5 * DAY + 1);
    await arena.settleTimeout(id);
    let captured = 0n;
    for (const w of ws) captured += await arena.claimable(w.address);
    expect(captured).to.equal(0n, `attacker captured ${ethers.formatUnits(captured, 6)} USDC`);
    expect((await arena.getBounty(id)).status).to.equal(Status.Refunded);
    expect(await arena.claimable(poster.address)).to.equal(USDC(1000));
    // The 50 stakes (500 USDC) were forfeited to the protocol, not to the poster.
    expect(await arena.feesAccrued()).to.equal(USDC(500));
    await expectSolvent(ws);
  });

  it("H-2b: the poster can cap entries per bounty", async () => {
    const { arena, poster, alice, bob, carol } = await loadFixture(deploy);
    const deadline = (await time.latest()) + 2 * DAY;
    await arena.connect(poster).createBounty("t", h("s"), 0, Mode.WinnerTakesAll, USDC(100), deadline, 0, MAX_PRICE, 0, 2);
    await enter(arena, alice, 0n, "a");
    await enter(arena, bob, 0n, "b");
    await expect(arena.connect(carol).submit(0, h("c"))).to.be.revertedWithCustomError(arena, "BadState");
  });

  // ------------------------------------------------------------------ Medium

  it("M-1: one entrant's dispute does not stop the verifier from judging and paying a passing entry", async () => {
    const { arena, alice, mallory, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
    const { id } = await postVerified({ stake: USDC(2) });
    await enter(arena, mallory, id, "junk");
    await enter(arena, alice, id, "solution");

    // Mallory's entry has not been judged, so she cannot dispute.
    await expect(arena.connect(mallory).dispute(id)).to.be.revertedWithCustomError(arena, "BadState");

    await expect(arena.connect(verifier).verifyAndAward(id, 0, false, REPORT)).to.not.be.reverted;
    await expect(arena.connect(verifier).verifyAndAward(id, 1, true, REPORT)).to.not.be.reverted;
    expect(await arena.claimable(alice.address)).to.equal(USDC(950) + USDC(2));
    await expectSolvent();
  });

  it("M-1b: a failed entrant's challenge does not freeze the bounty", async () => {
    const { arena, alice, bob, mallory, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified({ stake: USDC(2) });
    await enter(arena, mallory, id, "junk");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await arena.connect(mallory).dispute(id);
    expect((await arena.getBounty(id)).status).to.equal(Status.Open);
    // New entries and new checks still work.
    await enter(arena, alice, id, "attempt");
    await arena.connect(verifier).verifyAndAward(id, 1, false, REPORT);
    await enter(arena, bob, id, "another");
  });

  it("M-2a: a first-valid rejection made at the end of review can still be disputed", async () => {
    const { arena, poster, alice, post } = await loadFixture(deploy);
    const { id } = await post(Mode.FirstValid);
    await enter(arena, alice, id, "valid work");
    const b = await arena.getBounty(id);

    await time.setNextBlockTimestamp(Number(b.reviewEnd) - 1);
    await arena.connect(poster).reject(id, 0);

    // The poster cannot settle straight away: the rejection opened its own dispute window.
    await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly");
    await time.increase(HOUR);
    await expect(arena.connect(alice).dispute(id)).to.not.be.reverted;
  });

  it("M-2b: a failed check made at the end of the grace window can still be disputed", async () => {
    const { arena, alice, verifier, postVerified } = await loadFixture(deploy);
    const { id } = await postVerified({ stake: USDC(50) });
    await enter(arena, alice, id, "solution");
    const b = await arena.getBounty(id);

    await time.setNextBlockTimestamp(Number(b.reviewEnd) - 1);
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT);
    await expect(arena.settleTimeout(id)).to.be.revertedWithCustomError(arena, "TooEarly");

    await time.increase(HOUR);
    await expect(arena.connect(alice).dispute(id)).to.not.be.reverted;
  });

  it("M-3: an entrant whose failed check is overturned gets their stake back", async () => {
    const { arena, poster, alice, arbiter, verifier, postVerified, expectSolvent } = await loadFixture(deploy);
    // A stake larger than 10% of the reward is refused outright.
    await expect(postVerified({ reward: USDC(1), stake: USDC(100) })).to.be.revertedWithCustomError(arena, "BadInput");

    const { id } = await postVerified({ reward: USDC(1000), stake: USDC(100) });
    await enter(arena, alice, id, "correct solution");
    await arena.connect(verifier).verifyAndAward(id, 0, false, REPORT); // the check was wrong
    expect(await arena.claimable(poster.address)).to.equal(0n, "a forfeit is held through the dispute window");

    await arena.connect(alice).dispute(id);
    await arena.connect(arbiter).resolveChallenge(id, 0, true);

    expect(await arena.claimable(alice.address)).to.equal(USDC(950) + USDC(100) + USDC(5));
    expect(await arena.claimable(poster.address)).to.equal(0n);
    await expectSolvent();
  });

  it("M-4: a silent arbiter on a rejection dispute does not pay the rejected spam", async () => {
    const { arena, poster, alice, mallory, post, sybils, expectSolvent } = await loadFixture(deploy);
    const { id } = await post(Mode.FirstValid, USDC(1000));
    const extra = await sybils(3);
    const spam = [mallory, ...extra];
    for (let i = 0; i < spam.length; i++) await enter(arena, spam[i], id, `spam ${i}`);
    await enter(arena, alice, id, "valid work"); // index 4
    for (let i = 0; i < spam.length; i++) await arena.connect(poster).reject(id, i);

    await arena.connect(mallory).dispute(id);
    await expect(arena.connect(poster).award(id, [4])).to.be.revertedWithCustomError(arena, "BadState");

    await time.increase(14 * DAY);
    await arena.settleStaleDispute(id);

    let spamPaid = 0n;
    for (const s of spam) spamPaid += await arena.claimable(s.address);
    spamPaid -= USDC(5); // mallory's bond comes back because the arbiter, not mallory, failed to act
    expect(spamPaid).to.equal(0n, `rejected spam was paid ${ethers.formatUnits(spamPaid, 6)} USDC`);
    expect(await arena.claimable(alice.address)).to.equal(USDC(950));
    await expectSolvent(extra);
  });

  it("M-5: the owner cannot raise the featured price to take a poster's whole approval", async () => {
    const { arena, usdc, owner, poster } = await loadFixture(deploy);
    const before = await usdc.balanceOf(poster.address);

    // The price is capped.
    await expect(arena.connect(owner).setFeaturedPrice(before - USDC(1000))).to.be.revertedWithCustomError(arena, "BadInput");

    // Even a legal raise cannot surprise a poster who signed for 10 USDC a day.
    await arena.connect(owner).setFeaturedPrice(USDC(1000));
    const deadline = (await time.latest()) + 2 * DAY;
    await expect(
      arena.connect(poster).createBounty("t", h("s"), 0, Mode.WinnerTakesAll, USDC(1000), deadline, 1, USDC(10), 0, 0),
    ).to.be.revertedWithCustomError(arena, "PriceChanged");
    expect(await usdc.balanceOf(poster.address)).to.equal(before);
  });

  // ------------------------------------------------------------------ Low

  it("L-1: a tip pays the fee locked into the bounty, not the current global fee", async () => {
    const { arena, owner, alice, bob, post } = await loadFixture(deploy);
    const { id } = await post(Mode.WinnerTakesAll);
    await enter(arena, alice, id, "work");
    await arena.connect(owner).setFeeBps(1000);
    expect((await arena.getBounty(id)).feeBps).to.equal(500);
    await expect(arena.connect(bob).tip(id, 0, USDC(100))).to.emit(arena, "Tipped").withArgs(id, bob.address, alice.address, USDC(95), USDC(5));
  });

  it("L-2: a disputer who exposes a bad award keeps the bond when the arbiter overturns it", async () => {
    const { arena, poster, alice, bob, carol, arbiter, post } = await loadFixture(deploy);
    const { id } = await post(Mode.WinnerTakesAll);
    await enter(arena, alice, id, "best work");
    await enter(arena, bob, id, "ok work");
    await enter(arena, carol, id, "poster's friend");
    await time.increase(2 * DAY);
    await arena.connect(poster).award(id, [2]);

    await arena.connect(bob).dispute(id);
    await arena.connect(arbiter).resolveDispute(id, [0]);
    expect(await arena.claimable(bob.address)).to.equal(USDC(5), "the bond of a correct challenge was forfeited");
  });

  // ------------------------------------------------------------------ Info (indexers)

  it("I-1: closing a stale dispute emits an event that says the dispute ended", async () => {
    const { arena, poster, alice, verifier, post, postVerified } = await loadFixture(deploy);
    // Poster-judged: a rejection dispute nobody rules on
    const fv = await post(Mode.FirstValid);
    await enter(arena, alice, fv.id, "x");
    await arena.connect(poster).reject(fv.id, 0);
    await arena.connect(alice).dispute(fv.id);
    // Verified: a challenge nobody rules on
    const v = await postVerified();
    await enter(arena, alice, v.id, "y");
    await arena.connect(verifier).verifyAndAward(v.id, 0, false, REPORT);
    await arena.connect(alice).dispute(v.id);

    await time.increase(14 * DAY);
    await expect(arena.settleStaleDispute(fv.id)).to.emit(arena, "DisputeResolved").and.to.emit(arena, "DisputeTimedOut");
    await expect(arena.expireChallenge(v.id, 0)).to.emit(arena, "ChallengeResolved").and.to.emit(arena, "DisputeTimedOut");
  });

  it("I-2: a ghost split emits who was paid and how much", async () => {
    const { arena, alice, bob, post } = await loadFixture(deploy);
    const { id } = await post(Mode.WinnerTakesAll, USDC(100));
    await enter(arena, alice, id, "a");
    await enter(arena, bob, id, "b");
    await time.increase(5 * DAY + 1);
    const rc = await (await arena.settleTimeout(id)).wait();
    const topics = rc!.logs.flatMap((l) => l.topics.map((t) => t.toLowerCase()));
    for (const who of [alice, bob]) {
      expect(topics).to.include(ethers.zeroPadValue(who.address, 32).toLowerCase(), `no event names ${who.address}`);
    }
    await expect(arena.queryFilter(arena.filters.GhostShare(id))).to.eventually.have.length(2);
  });
});
