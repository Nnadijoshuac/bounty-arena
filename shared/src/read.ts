import type { Address, PublicClient } from "viem";
import { arenaAbi } from "./abi";
import {
  CATEGORIES,
  MODES,
  STATUSES,
  type AutoPayStats,
  type Bounty,
  type Category,
  CHALLENGES,
  type Entry,
  type HumansVsAgents,
  type HunterStats,
  type Phase,
  type ProtocolConfig,
  type SideTotals,
} from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

type Read = (functionName: string, args?: unknown[]) => Promise<any>;
const reader = (client: PublicClient, arena: Address): Read => (functionName, args = []) =>
  client.readContract({ address: arena, abi: arenaAbi, functionName: functionName as never, args: args as never }) as Promise<any>;

/**
 * Chain time in seconds. On the local demo the clock runs ahead of wall time (the seed fast-forwards
 * it), so pass the deployment's timeOffset. On Arc testnet leave it at 0.
 */
export async function chainNow(client: PublicClient, timeOffset = 0): Promise<number> {
  const block = await client.getBlock();
  return Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000) + timeOffset);
}

export function phaseOf(b: { status: number; deadline: number; reviewEnd: number; awardedAt: number; disputeWindow: number }, now: number): Phase {
  switch (b.status) {
    case 0:
      if (now < b.deadline) return "open";
      if (now < b.reviewEnd) return "review";
      return "timeout";
    case 1:
      return now < b.awardedAt + b.disputeWindow ? "awarded" : "finalizable";
    case 2:
      return "disputed";
    case 3:
      return "paid";
    case 4:
      return "ghost-paid";
    default:
      return "refunded";
  }
}

export const REVEAL_WINDOW = 10 * 60;

function toEntry(s: any, index: number, verified: boolean, disputeWindow: number): Entry {
  const judgedAt = Number(s.judgedAt);
  const bad = verified ? s.checked && !s.passed : s.rejected;
  return {
    index,
    hunter: s.hunter,
    isAgent: s.isAgent,
    commitment: s.commitment,
    revealed: s.revealed,
    deliverableHash: s.revealed ? s.deliverableHash : null,
    submittedAt: Number(s.submittedAt),
    revealBy: Number(s.submittedAt) + REVEAL_WINDOW,
    rejected: s.rejected,
    rank: Number(s.rank),
    payout: s.payout,
    check: !verified ? "not-verified" : !s.checked ? "pending" : s.passed ? "passed" : "failed",
    judgedAt,
    disputeBy: bad && judgedAt ? judgedAt + disputeWindow : 0,
    challenge: CHALLENGES[Number(s.challenge)],
    challengedAt: Number(s.challengedAt),
    stakeSettled: s.stakeSettled,
    reportHash: s.reportHash === ZERO_HASH ? null : s.reportHash,
  };
}

export function toBounty(id: number, b: any, subs: any[], now: number): Bounty {
  const mode = MODES[Number(b.mode)];
  const verified = mode === "verified";
  const entries = subs.map((s, i) => toEntry(s, i, verified, Number(b.disputeWindow)));
  const winners = entries.filter((e) => e.rank > 0).sort((x, y) => x.rank - y.rank);
  const raw = {
    status: Number(b.status),
    deadline: Number(b.deadline),
    reviewEnd: Number(b.reviewEnd),
    awardedAt: Number(b.awardedAt),
    disputeWindow: Number(b.disputeWindow),
  };
  const settledAt = Number(b.settledAt);
  const winner = winners[0];
  return {
    id,
    title: b.title,
    poster: b.poster,
    arbiter: b.arbiter,
    verifier: b.verifier,
    disputer: b.disputer === ZERO ? null : b.disputer,
    reward: b.reward,
    fee: (b.reward * BigInt(b.feeBps)) / 10_000n,
    feeBps: Number(b.feeBps),
    bond: b.bond,
    bondSize: b.bondSize,
    entryStake: b.entryStake,
    stakeHeld: b.stakeHeld,
    maxEntries: Number(b.maxEntries),
    openChallenges: Number(b.openChallenges),
    lastJudgedAt: Number(b.lastJudgedAt),
    category: CATEGORIES[Number(b.category)],
    mode,
    verified,
    status: STATUSES[raw.status],
    phase: phaseOf(raw, now),
    createdAt: Number(b.createdAt),
    deadline: raw.deadline,
    reviewEnd: raw.reviewEnd,
    awardedAt: raw.awardedAt,
    disputedAt: Number(b.disputedAt),
    settledAt,
    featuredUntil: Number(b.featuredUntil),
    featured: Number(b.featuredUntil) > now && raw.status === 0 && now < raw.deadline,
    disputeWindow: raw.disputeWindow,
    specHash: b.specHash,
    checkHash: b.checkHash === ZERO_HASH ? null : b.checkHash,
    entries,
    winners,
    autoPaidIn: verified && raw.status === 3 && winner ? Math.max(0, settledAt - winner.submittedAt) : null,
  };
}

export async function getBounty(client: PublicClient, arena: Address, id: number, now?: number): Promise<Bounty> {
  const read = reader(client, arena);
  const [b, subs, t] = await Promise.all([read("getBounty", [BigInt(id)]), read("getSubmissions", [BigInt(id)]), now ?? chainNow(client)]);
  return toBounty(id, b, subs, t);
}

/** Every bounty with its entries and derived phase. One read per bounty, fine for hundreds. */
export async function listBounties(client: PublicClient, arena: Address, opts: { now?: number; timeOffset?: number } = {}): Promise<Bounty[]> {
  const read = reader(client, arena);
  const [count, now] = await Promise.all([read("bountyCount"), opts.now ?? chainNow(client, opts.timeOffset)]);
  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  const [raws, subs] = await Promise.all([
    Promise.all(ids.map((i) => read("getBounty", [BigInt(i)]))),
    Promise.all(ids.map((i) => read("getSubmissions", [BigInt(i)]))),
  ]);
  return ids.map((i) => toBounty(i, raws[i], subs[i], now));
}

export async function getHunterStats(client: PublicClient, arena: Address, address: Address): Promise<HunterStats> {
  const s = await reader(client, arena)("getStats", [address]);
  return {
    address,
    handle: s.handle,
    registered: s.registered,
    isAgent: s.isAgent,
    submissions: Number(s.submissions),
    wins: Number(s.wins),
    bountiesPosted: Number(s.bountiesPosted),
    earned: s.earned,
    tipsReceived: s.tipsReceived,
    posted: s.posted,
    categoryWins: Object.fromEntries(CATEGORIES.map((c, i) => [c, Number(s.categoryWins[i])])) as Record<Category, number>,
  };
}

/** Every registered address with its onchain stats. */
export async function listHunters(client: PublicClient, arena: Address): Promise<HunterStats[]> {
  const addrs = (await reader(client, arena)("getHunters")) as Address[];
  return Promise.all(addrs.map((a) => getHunterStats(client, arena, a)));
}

export async function readConfig(client: PublicClient, arena: Address): Promise<ProtocolConfig> {
  const read = reader(client, arena);
  const keys = ["feeBps", "featuredPricePerDay", "disputeBond", "reviewWindow", "disputeWindow", "verifyGrace", "feesAccrued", "treasury", "arbiter", "verifier", "owner"] as const;
  const vals = await Promise.all(keys.map((k) => read(k)));
  const c = Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as any;
  return {
    ...c,
    feeBps: Number(c.feeBps),
    reviewWindow: Number(c.reviewWindow),
    disputeWindow: Number(c.disputeWindow),
    verifyGrace: Number(c.verifyGrace),
  };
}

export async function readClaimable(client: PublicClient, arena: Address, address: Address): Promise<bigint> {
  return reader(client, arena)("claimable", [address]);
}

function side(hunters: HunterStats[]): SideTotals {
  const active = hunters.filter((h) => h.submissions > 0);
  const entries = active.reduce((a, h) => a + h.submissions, 0);
  const wins = active.reduce((a, h) => a + h.wins, 0);
  return {
    hunters: active.length,
    entries,
    wins,
    earned: active.reduce((a, h) => a + h.earned, 0n),
    tips: active.reduce((a, h) => a + h.tipsReceived, 0n),
    winRate: entries ? wins / entries : 0,
    categoryWins: Object.fromEntries(CATEGORIES.map((c) => [c, active.reduce((a, h) => a + h.categoryWins[c], 0)])) as Record<Category, number>,
  };
}

/** Head-to-head totals for the Humans vs Agents board. Counts hunters with at least one entry. */
export function humansVsAgents(hunters: HunterStats[]): HumansVsAgents {
  return { humans: side(hunters.filter((h) => !h.isAgent)), agents: side(hunters.filter((h) => h.isAgent)) };
}

/** Verified bounties that paid out automatically, with the median time from entry to payout. */
export function verifiedAutoPay(bounties: Bounty[]): AutoPayStats {
  const items = bounties
    .filter((b) => b.autoPaidIn !== null)
    .map((b) => ({
      bountyId: b.id,
      title: b.title,
      winner: b.winners[0].hunter,
      isAgent: b.winners[0].isAgent,
      seconds: b.autoPaidIn as number,
      payout: b.winners[0].payout,
      settledAt: b.settledAt,
    }))
    .sort((a, b) => b.settledAt - a.settledAt);
  const secs = items.map((i) => i.seconds).sort((a, b) => a - b);
  const mid = secs.length >> 1;
  const median = secs.length === 0 ? null : secs.length % 2 ? secs[mid] : Math.round((secs[mid - 1] + secs[mid]) / 2);
  return { count: items.length, medianSeconds: median, fastestSeconds: secs[0] ?? null, items };
}

/** One call for a whole dashboard: bounties, hunters, config and the two headline aggregates. */
export async function readArena(client: PublicClient, arena: Address, opts: { timeOffset?: number } = {}) {
  const now = await chainNow(client, opts.timeOffset);
  const [bounties, hunters, config] = await Promise.all([
    listBounties(client, arena, { now }),
    listHunters(client, arena),
    readConfig(client, arena),
  ]);
  return { now, bounties, hunters, config, humansVsAgents: humansVsAgents(hunters), autoPay: verifiedAutoPay(bounties) };
}
