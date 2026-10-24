import type { Address, Hex } from "viem";

export const CATEGORIES = ["code", "research", "design", "data", "content"] as const;
export const MODES = ["winner-takes-all", "top-3-split", "first-valid", "verified"] as const;
export const STATUSES = ["open", "awarded", "disputed", "paid", "ghost-paid", "refunded"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Mode = (typeof MODES)[number];
export type Status = (typeof STATUSES)[number];

/**
 * What a bounty is doing right now, derived from status and chain time.
 * - open: taking entries
 * - review: deadline passed, poster can award (or, on verified bounties, the verifier is finishing checks)
 * - timeout: review window missed, anyone can call settleTimeout
 * - awarded: winners picked, dispute window running
 * - finalizable: dispute window over, anyone can call finalize
 * - disputed: waiting on the arbiter
 * - paid / ghost-paid / refunded: settled
 */
export type Phase = "open" | "review" | "timeout" | "awarded" | "finalizable" | "disputed" | "paid" | "ghost-paid" | "refunded";

export type EntryCheck = "not-verified" | "pending" | "passed" | "failed";

/** Verified bounties: a failed entrant can challenge the check. "none" until then. */
export type EntryChallenge = "none" | "open" | "upheld" | "dismissed" | "expired";
export const CHALLENGES: EntryChallenge[] = ["none", "open", "upheld", "dismissed", "expired"];

export type Entry = {
  index: number;
  hunter: Address;
  isAgent: boolean;
  /** keccak256(abi.encode(bountyId, hunter, contentHash, salt)), what was submitted */
  commitment: Hex;
  /** true once the hunter revealed contentHash and salt onchain */
  revealed: boolean;
  /** contentHash of the deliverable text, null until revealed */
  deliverableHash: Hex | null;
  submittedAt: number;
  /** reveal must land before this (submittedAt + 10 minutes) */
  revealBy: number;
  rejected: boolean;
  rank: number; // 1..3 when awarded
  payout: bigint; // USDC 6 decimals, set once settled
  check: EntryCheck;
  /** when the entry was rejected (poster-judged) or checked (verified), 0 if not yet */
  judgedAt: number;
  /** a rejected or failed entry can dispute until this time, 0 if not applicable */
  disputeBy: number;
  challenge: EntryChallenge;
  challengedAt: number;
  stakeSettled: boolean;
  reportHash: Hex | null;
};

export type Bounty = {
  id: number;
  title: string;
  poster: Address;
  arbiter: Address;
  verifier: Address;
  disputer: Address | null;
  reward: bigint; // USDC, 6 decimals
  fee: bigint; // protocol fee that comes off the reward at payout
  feeBps: number;
  bond: bigint; // dispute bonds currently held
  bondSize: bigint; // the bond one dispute costs on this bounty
  entryStake: bigint;
  stakeHeld: bigint;
  maxEntries: number;
  openChallenges: number;
  lastJudgedAt: number;
  category: Category;
  mode: Mode;
  verified: boolean;
  status: Status;
  phase: Phase;
  createdAt: number;
  deadline: number;
  reviewEnd: number;
  awardedAt: number;
  disputedAt: number;
  settledAt: number;
  featuredUntil: number;
  featured: boolean;
  disputeWindow: number;
  specHash: Hex;
  checkHash: Hex | null;
  entries: Entry[];
  winners: Entry[]; // ranked, empty until awarded
  /** Verified bounties that paid out: seconds from the winning entry to the payout. */
  autoPaidIn: number | null;
};

export type HunterStats = {
  address: Address;
  handle: string;
  registered: boolean;
  isAgent: boolean;
  submissions: number;
  wins: number;
  bountiesPosted: number;
  earned: bigint;
  tipsReceived: bigint;
  posted: bigint;
  categoryWins: Record<Category, number>;
};

export type SideTotals = {
  hunters: number;
  entries: number;
  wins: number;
  earned: bigint;
  tips: bigint;
  winRate: number; // 0..1
  categoryWins: Record<Category, number>;
};

export type HumansVsAgents = { humans: SideTotals; agents: SideTotals };

export type AutoPayStats = {
  count: number;
  medianSeconds: number | null;
  fastestSeconds: number | null;
  items: { bountyId: number; title: string; winner: Address; isAgent: boolean; seconds: number; payout: bigint; settledAt: number }[];
};

export type ProtocolConfig = {
  feeBps: number;
  featuredPricePerDay: bigint;
  disputeBond: bigint;
  reviewWindow: number;
  disputeWindow: number;
  verifyGrace: number;
  feesAccrued: bigint;
  treasury: Address;
  arbiter: Address;
  verifier: Address;
  owner: Address;
};

/** Deployment file shape: web/public/deployments/{local,arcTestnet,arcMainnet}.json */
export type Deployment = {
  network: "local" | "arcTestnet" | "arcMainnet";
  chainId: number;
  arena: Address | null;
  textStore: Address | null;
  usdc: Address;
  treasury?: Address;
  arbiter?: Address;
  verifier?: Address;
  startBlock: number;
  timeOffset: number; // local demo only: seconds the chain clock runs ahead of wall time
};

/** Machine check formats for verified bounties (the text behind checkHash). */
export type JsCheck = {
  type: "js";
  export: string;
  timeoutMs?: number;
  cases: { name: string; args: unknown[]; expect: unknown }[];
};
export type JsonCheck = { type: "json"; schema: object; expect?: unknown };
export type Check = JsCheck | JsonCheck;

/** Report the verifier publishes for every entry it judges (the text behind reportHash). */
export type VerifierReport = {
  verifier: string;
  bounty: number;
  entry: number;
  hunter: Address;
  commitment: Hex;
  deliverableHash: Hex | null;
  checkHash: Hex;
  passed: boolean;
  summary: string;
  results: { name: string; ok: boolean; got?: string; error?: string }[];
  error?: string;
  runMs: number;
  at: string;
};
