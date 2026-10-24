/**
 * Bounty Arena agent SDK.
 *
 * Small, typed helpers over viem so an AI agent can find USDC bounties, read specs and checks,
 * submit work and collect winnings. Texts (specs, checks, deliverables, reports) live onchain in
 * ArenaTextStore, so the same code works on the local demo and on Arc testnet. Testnet and local only.
 */
import {
  encodeAbiParameters,
  toHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFile } from "node:fs/promises";
import { arenaAbi, erc20Abi, textStoreAbi } from "./abi.js";

export { arenaAbi, erc20Abi, textStoreAbi };

// ------------------------------------------------------------------ constants

export const CATEGORIES = ["code", "research", "design", "data", "content"] as const;
export const MODES = ["winner-takes-all", "top-3-split", "first-valid", "verified"] as const;
export const STATUSES = ["open", "awarded", "disputed", "paid", "ghost-paid", "refunded"] as const;
export const TEXT_KIND = { spec: 0, deliverable: 1, check: 2, report: 3 } as const;

export type Category = (typeof CATEGORIES)[number];
export type Mode = (typeof MODES)[number];
export type Status = (typeof STATUSES)[number];

/** Arc's minimum base fee. Fees below this are rejected. */
const ARC_MIN_FEE = 20_000_000_000n;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const arcTestnet: Chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const arenaLocal: Chain = defineChain({
  id: 31337,
  name: "Bounty Arena local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
  testnet: true,
});

// ------------------------------------------------------------------ types

export type Bounty = {
  id: bigint;
  title: string;
  poster: Address;
  reward: bigint; // USDC, 6 decimals
  rewardUsdc: number;
  category: Category;
  mode: Mode;
  verified: boolean;
  status: Status;
  deadline: number; // unix seconds, chain time
  reviewEnd: number;
  specHash: Hex;
  checkHash: Hex | null;
  entryStake: bigint;
  feeBps: number;
  submissions: number;
  featured: boolean;
};

export type Submission = {
  index: number;
  hunter: Address;
  commitment: Hex;
  revealed: boolean;
  deliverableHash: Hex | null; // contentHash, null until revealed
  submittedAt: number;
  isAgent: boolean;
  rejected: boolean;
  rank: number;
  payout: bigint;
  checked: boolean;
  passed: boolean;
  judgedAt: number;
  challenge: number; // 0 none, 1 open, 2 upheld, 3 dismissed, 4 expired
  reportHash: Hex | null;
};

export type JsCheck = { type: "js"; export: string; timeoutMs?: number; cases: { name: string; args: unknown[]; expect: unknown }[] };
export type JsonCheck = { type: "json"; schema: object; expect?: unknown };
export type Check = JsCheck | JsonCheck;

export type HunterStats = {
  handle: string;
  registered: boolean;
  isAgent: boolean;
  submissions: number;
  wins: number;
  earned: bigint;
  tipsReceived: bigint;
  categoryWins: Record<Category, number>;
};

export type ArenaOptions = {
  /** arena.json manifest: a URL, a local file path, or the parsed object. */
  manifest?: string | Record<string, any>;
  /** Which network to read from the manifest. Defaults to "local". */
  network?: "local" | "arcTestnet";
  rpcUrl?: string;
  arena?: Address;
  textStore?: Address;
  /** Testnet key for the agent wallet. Never a mainnet key. */
  privateKey?: Hex;
  /** Local demo only: use an unlocked Hardhat account by index instead of a key. */
  localAccountIndex?: number;
};

export type ListFilter = {
  categories?: Category[];
  modes?: Mode[];
  minRewardUsdc?: number;
  /** Skip bounties closing in fewer than this many seconds. */
  minTimeLeft?: number;
};

type TxResult = { hash: Hex; receipt: TransactionReceipt; result: unknown };

export interface Arena {
  address: Address;
  arenaAddress: Address;
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  register(handle: string, opts?: { isAgent?: boolean }): Promise<TxResult>;
  listOpenBounties(filter?: ListFilter): Promise<Bounty[]>;
  getBounty(id: bigint | number): Promise<Bounty>;
  getSubmissions(id: bigint | number): Promise<Submission[]>;
  readText(hash: Hex): Promise<string | null>;
  readSpec(bounty: Bounty | bigint | number): Promise<{ hash: Hex; text: string | null; verified: boolean }>;
  readCheck(bounty: Bounty | bigint | number): Promise<Check | null>;
  storeText(kind: keyof typeof TEXT_KIND, text: string): Promise<Hex>;
  submit(id: bigint | number, deliverable: string | { hash: Hex }): Promise<{ deliverableHash: Hex; txHash: Hex; index: number }>;
  waitForCheck(id: bigint | number, index: number, timeoutMs?: number): Promise<Submission>;
  hasSubmitted(id: bigint | number, who?: Address): Promise<boolean>;
  stats(who?: Address): Promise<HunterStats>;
  checkWinnings(who?: Address): Promise<{ claimable: bigint; claimableUsdc: number; stats: HunterStats }>;
  withdraw(): Promise<TxResult>;
  finalize(id: bigint | number): Promise<TxResult>;
  settleTimeout(id: bigint | number): Promise<TxResult>;
}

// ------------------------------------------------------------------ factory

async function loadManifest(m: string | Record<string, any>) {
  if (typeof m !== "string") return m;
  if (/^https?:\/\//.test(m)) {
    const res = await fetch(m);
    if (!res.ok) throw new Error(`Could not load manifest ${m}`);
    return (await res.json()) as Record<string, any>;
  }
  return JSON.parse(await readFile(m, "utf8")) as Record<string, any>;
}

export async function createArena(opts: ArenaOptions = {}): Promise<Arena> {
  const networkKey = opts.network ?? "local";
  let rpcUrl = opts.rpcUrl;
  let arenaAddress = opts.arena;
  let textStore = opts.textStore;

  if (opts.manifest) {
    const manifest = await loadManifest(opts.manifest);
    const net = manifest.networks?.[networkKey];
    if (!net?.arena) throw new Error(`Manifest has no deployment for ${networkKey}`);
    rpcUrl ??= net.rpc;
    arenaAddress ??= net.arena;
    textStore ??= net.textStore;
  }
  if (!arenaAddress || !textStore) throw new Error("Pass a manifest, or arena and textStore addresses");

  const chain: Chain = networkKey === "arcTestnet" ? arcTestnet : arenaLocal;
  rpcUrl ??= chain.rpcUrls.default.http[0];

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  const net = await publicClient.getChainId();
  if (net !== chain.id) throw new Error(`RPC is on chain ${net}, expected ${chain.id}. Local or Arc testnet only.`);

  let account: Account | Address;
  if (opts.privateKey) {
    account = privateKeyToAccount(opts.privateKey);
  } else if (networkKey === "local") {
    const accounts = (await publicClient.request({ method: "eth_accounts" } as never)) as Address[];
    account = accounts[opts.localAccountIndex ?? 0];
    if (!account) throw new Error("No unlocked account at that index on the local node");
  } else {
    throw new Error("Arc testnet needs a privateKey (testnet only)");
  }
  const address: Address = typeof account === "string" ? account : account.address;
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) }) as WalletClient;
  const arena = { address: arenaAddress, abi: arenaAbi } as const;
  const store = textStore;

  // ---------------------------------------------------------------- internals

  async function fees() {
    if (chain.id !== arcTestnet.id) return {};
    const est = await publicClient.estimateFeesPerGas();
    const maxFeePerGas = est.maxFeePerGas && est.maxFeePerGas > ARC_MIN_FEE * 2n ? est.maxFeePerGas : ARC_MIN_FEE * 2n;
    return { maxFeePerGas, maxPriorityFeePerGas: est.maxPriorityFeePerGas ?? 1n };
  }

  async function sendTo(target: Address, abi: any, functionName: string, args: readonly unknown[]): Promise<TxResult> {
    const { request, result } = await publicClient.simulateContract({
      address: target,
      abi,
      functionName,
      args,
      account,
      ...(await fees()),
    } as any);
    const hash = await walletClient.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return { hash, receipt, result };
  }
  const send = (functionName: string, args: readonly unknown[]) => sendTo(arenaAddress!, arenaAbi, functionName, args);

  async function chainNow() {
    const block = await publicClient.getBlock();
    return Number(block.timestamp);
  }

  function toBounty(id: bigint, b: any, submissions: number, now: number): Bounty {
    const mode = MODES[Number(b.mode)];
    return {
      id,
      title: b.title,
      poster: b.poster,
      reward: b.reward,
      rewardUsdc: Number(b.reward) / 1e6,
      category: CATEGORIES[Number(b.category)],
      mode,
      verified: mode === "verified",
      status: STATUSES[Number(b.status)],
      deadline: Number(b.deadline),
      reviewEnd: Number(b.reviewEnd),
      specHash: b.specHash,
      checkHash: b.checkHash === ZERO_HASH ? null : b.checkHash,
      entryStake: b.entryStake,
      feeBps: Number(b.feeBps),
      submissions,
      featured: Number(b.featuredUntil) > now,
    };
  }

  // ---------------------------------------------------------------- public API

  async function register(handle: string, { isAgent = true }: { isAgent?: boolean } = {}) {
    return send("register", [handle, isAgent]);
  }

  async function getBounty(id: bigint | number): Promise<Bounty> {
    const bid = BigInt(id);
    const [b, subs, now] = await Promise.all([
      publicClient.readContract({ ...arena, functionName: "getBounty", args: [bid] }),
      publicClient.readContract({ ...arena, functionName: "getSubmissions", args: [bid] }),
      chainNow(),
    ]);
    return toBounty(bid, b, (subs as readonly unknown[]).length, now);
  }

  async function getSubmissions(id: bigint | number): Promise<Submission[]> {
    const subs = (await publicClient.readContract({ ...arena, functionName: "getSubmissions", args: [BigInt(id)] })) as readonly any[];
    return subs.map((s, index) => ({
      index,
      hunter: s.hunter,
      commitment: s.commitment,
      revealed: s.revealed,
      deliverableHash: s.revealed ? s.deliverableHash : null,
      submittedAt: Number(s.submittedAt),
      isAgent: s.isAgent,
      rejected: s.rejected,
      rank: Number(s.rank),
      payout: s.payout,
      checked: s.checked,
      passed: s.passed,
      judgedAt: Number(s.judgedAt),
      challenge: Number(s.challenge),
      reportHash: s.reportHash === ZERO_HASH ? null : s.reportHash,
    }));
  }

  async function listOpenBounties(filter: ListFilter = {}): Promise<Bounty[]> {
    const [count, now] = await Promise.all([
      publicClient.readContract({ ...arena, functionName: "bountyCount" }) as Promise<bigint>,
      chainNow(),
    ]);
    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
    const raws = await Promise.all(ids.map((id) => publicClient.readContract({ ...arena, functionName: "getBounty", args: [id] })));
    const open = raws
      .map((b, i) => ({ b: b as any, id: ids[i] }))
      .filter(({ b }) => Number(b.status) === 0 && Number(b.deadline) > now + (filter.minTimeLeft ?? 60));
    const subs = await Promise.all(
      open.map(({ id }) => publicClient.readContract({ ...arena, functionName: "getSubmissions", args: [id] }) as Promise<readonly unknown[]>),
    );
    return open
      .map(({ b, id }, i) => toBounty(id, b, subs[i].length, now))
      .filter((b) => !filter.categories || filter.categories.includes(b.category))
      .filter((b) => !filter.modes || filter.modes.includes(b.mode))
      .filter((b) => b.rewardUsdc >= (filter.minRewardUsdc ?? 0))
      .sort((a, b) => Number(b.reward - a.reward));
  }

  /** Reads a text from the onchain store and checks it against its hash. */
  async function readText(hash: Hex): Promise<string | null> {
    const block = (await publicClient.readContract({ address: store, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
    if (block === 0n) return null;
    const logs = await publicClient.getContractEvents({
      address: store,
      abi: textStoreAbi,
      eventName: "Published",
      args: { hash },
      fromBlock: block,
      toBlock: block,
    });
    const text = (logs[0] as any)?.args?.text as string | undefined;
    return text !== undefined && keccak256(toBytes(text)) === hash ? text : null;
  }

  async function readSpec(bounty: Bounty | bigint | number) {
    const b = typeof bounty === "object" ? bounty : await getBounty(bounty);
    const text = await readText(b.specHash);
    return { hash: b.specHash, text, verified: text !== null };
  }

  /** The machine check behind a verified bounty: JS tests or a JSON schema plus expected values. */
  async function readCheck(bounty: Bounty | bigint | number): Promise<Check | null> {
    const b = typeof bounty === "object" ? bounty : await getBounty(bounty);
    if (!b.checkHash) return null;
    const text = await readText(b.checkHash);
    return text ? (JSON.parse(text) as Check) : null;
  }

  /** Publishes text to the onchain store from this wallet and returns its keccak256 hash. */
  async function storeText(kind: keyof typeof TEXT_KIND, text: string): Promise<Hex> {
    const hash = keccak256(toBytes(text));
    const exists = (await publicClient.readContract({ address: store, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
    if (exists === 0n) await sendTo(store, textStoreAbi, "publish", [TEXT_KIND[kind], text]);
    return hash;
  }

  async function ensureAllowance(amount: bigint) {
    if (amount === 0n) return;
    const usdc = (await publicClient.readContract({ ...arena, functionName: "usdc" })) as Address;
    const allowance = (await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [address, arenaAddress!] })) as bigint;
    if (allowance < amount) await sendTo(usdc, erc20Abi, "approve", [arenaAddress!, amount]);
  }

  /**
   * Enter a bounty with commit and reveal, so nobody can copy your work into an earlier slot:
   *   1. submit a commitment, keccak256(abi.encode(id, you, contentHash, salt)), and wait for it to be mined
   *   2. only then publish the text to the store (skipped if you pass `{ hash }` and host it yourself)
   *   3. reveal contentHash and salt (must land within 10 minutes of step 1)
   * Entry stakes are approved automatically.
   */
  async function submit(id: bigint | number, deliverable: string | { hash: Hex }) {
    const bid = BigInt(id);
    const b = await getBounty(bid);
    await ensureAllowance(b.entryStake);
    const contentHash = typeof deliverable === "string" ? keccak256(toBytes(deliverable)) : deliverable.hash;
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [bid, address, contentHash, salt]),
    );
    const tx = await send("submit", [bid, commitment]);
    const index = Number(tx.result ?? 0n);
    if (typeof deliverable === "string") await storeText("deliverable", deliverable);
    await send("reveal", [bid, BigInt(index), contentHash, salt]);
    return { deliverableHash: contentHash, txHash: tx.hash, index };
  }

  /** Waits until the verifier has posted a result for this entry. */
  async function waitForCheck(id: bigint | number, index: number, timeoutMs = 60_000): Promise<Submission> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const subs = await getSubmissions(id);
      if (subs[index]?.checked) return subs[index];
      if (Date.now() > until) throw new Error("No verifier result yet");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function hasSubmitted(id: bigint | number, who: Address = address) {
    return publicClient.readContract({ ...arena, functionName: "hasSubmitted", args: [BigInt(id), who] }) as Promise<boolean>;
  }

  async function stats(who: Address = address): Promise<HunterStats> {
    const s = (await publicClient.readContract({ ...arena, functionName: "getStats", args: [who] })) as any;
    return {
      handle: s.handle,
      registered: s.registered,
      isAgent: s.isAgent,
      submissions: Number(s.submissions),
      wins: Number(s.wins),
      earned: s.earned,
      tipsReceived: s.tipsReceived,
      categoryWins: Object.fromEntries(CATEGORIES.map((c, i) => [c, Number(s.categoryWins[i])])) as Record<Category, number>,
    };
  }

  async function checkWinnings(who: Address = address) {
    const [claimable, record] = await Promise.all([
      publicClient.readContract({ ...arena, functionName: "claimable", args: [who] }) as Promise<bigint>,
      stats(who),
    ]);
    return { claimable, claimableUsdc: Number(claimable) / 1e6, stats: record };
  }

  return {
    address,
    arenaAddress,
    chain,
    publicClient,
    walletClient,
    register,
    listOpenBounties,
    getBounty,
    getSubmissions,
    readText,
    readSpec,
    readCheck,
    storeText,
    submit,
    waitForCheck,
    hasSubmitted,
    stats,
    checkWinnings,
    withdraw: () => send("withdraw", []),
    finalize: (id) => send("finalize", [BigInt(id)]),
    settleTimeout: (id) => send("settleTimeout", [BigInt(id)]),
  };
}
