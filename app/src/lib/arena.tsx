import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { useAccount } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import {
  ARC_MIN_BASE_FEE,
  arcTestnet,
  arcMainnet,
  arenaAbi,
  arenaLocal,
  erc20Abi,
  hashText,
  loadDeployment,
  readArena,
  readClaimable,
  readText,
  phaseOf,
  textStoreAbi,
  TEXT_KIND,
  type Bounty,
  type Deployment,
  type HunterStats,
  type Phase,
  type TextKind,
} from "@shared";
import { wagmiConfig } from "./wagmi";

/**
 * Arena's connection to the chain. All reads go through shared/ (see arena/INTEGRATION.md),
 * so the frontend and the verifier agree on every type and phase.
 */

export type NetworkKey = "local" | "arcTestnet" | "arcMainnet";
export const NETWORKS: Record<NetworkKey, { chain: typeof arenaLocal; label: string }> = {
  local: { chain: arenaLocal, label: "Local demo" },
  arcTestnet: { chain: arcTestnet, label: "Arc testnet" },
  arcMainnet: { chain: arcMainnet, label: "Arc mainnet" },
};

/** The seeded personas on the local node, from INTEGRATION.md. */
export const DEMO_ROLES: Record<number, string> = {
  0: "owner and treasury",
  1: "arbiter",
  2: "patron",
  3: "patron",
  12: "patron",
  4: "human maker",
  5: "human maker",
  6: "human maker",
  7: "human maker",
  8: "agent maker",
  9: "agent maker",
  10: "agent maker",
  11: "agent maker",
  13: "relay-agent",
  14: "verifier",
  15: "store relayer",
};

type WriteOpts = { approve?: bigint };

type Ctx = {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  dep: Deployment | null;
  depError: string | null;
  client: PublicClient;
  offset: number;
  account: Address | undefined;
  walletKind: "demo" | "injected" | null;
  demoAccounts: Address[];
  selectDemo: (a: Address | null) => void;
  write: (functionName: string, args: unknown[], opts?: WriteOpts) => Promise<Hex>;
  publish: (kind: TextKind, text: string) => Promise<Hex>;
  mintTestUsdc: () => Promise<void>;
  skipTime: (seconds: number) => Promise<void>;
};

const ArenaCtx = createContext<Ctx | null>(null);

function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function ArenaProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [network, setNetworkState] = useState<NetworkKey>((readLocal("arena.network") as NetworkKey) || "arcTestnet");
  const [dep, setDep] = useState<Deployment | null>(null);
  const [depError, setDepError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [demoAccounts, setDemoAccounts] = useState<Address[]>([]);
  const [demo, setDemo] = useState<Address | null>((readLocal("arena.demo") as Address) || null);
  const { address: injectedAddress } = useAccount();

  const chain = NETWORKS[network].chain;
  const client = useMemo(
    () => createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { batch: true }) }) as PublicClient,
    [chain],
  );

  const setNetwork = (n: NetworkKey) => {
    writeLocal("arena.network", n);
    setNetworkState(n);
    qc.clear();
  };

  useEffect(() => {
    let alive = true;
    setDep(null);
    setDepError(null);
    const missing = network === "local" ? "The local demo is not running. Start it with npm run demo in arena/." : `Arena is not deployed on ${NETWORKS[network].label} yet.`;
    loadDeployment(`/deployments/${network}.json`)
      .then(async (d) => {
        if (!alive) return;
        if (!d.arena) return setDepError(missing);
        setDep(d);
        let off = d.timeOffset || 0;
        try {
          const block = await client.getBlock();
          off = Math.max(off, Number(block.timestamp) - Math.floor(Date.now() / 1000));
        } catch {
          if (alive) setDepError(network === "local" ? "Cannot reach the local chain on port 8555. Start it with npm run demo in arena/." : `Cannot reach the ${NETWORKS[network].label} RPC.`);
        }
        if (alive) setOffset(off);
        if (network === "local") {
          try {
            const accts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
            if (alive) setDemoAccounts(accts.slice(0, 16));
          } catch {}
        }
      })
      .catch(() => alive && setDepError(missing));
    return () => {
      alive = false;
    };
  }, [network, client]);

  const walletKind: Ctx["walletKind"] = network === "local" && demo ? "demo" : injectedAddress ? "injected" : null;
  const account = walletKind === "demo" ? (demo as Address) : walletKind === "injected" ? injectedAddress : undefined;

  const selectDemo = (a: Address | null) => {
    writeLocal("arena.demo", a);
    setDemo(a);
  };

  const getWallet = useCallback(async (): Promise<WalletClient> => {
    if (walletKind === "demo" && demo) {
      // The local node holds unlocked dev accounts, so no key ever reaches the browser.
      return createWalletClient({ account: demo, chain, transport: http(chain.rpcUrls.default.http[0]) });
    }
    if (walletKind === "injected") {
      await switchChain(wagmiConfig, { chainId: chain.id as 31337 | 5042002 | 5042 }).catch(() => {});
      return (await getWalletClient(wagmiConfig, { chainId: chain.id as 31337 | 5042002 | 5042 })) as WalletClient;
    }
    throw new Error("Choose a wallet first");
  }, [walletKind, demo, chain]);

  // Arc's base fee never drops below 20 gwei
  const fees = useCallback(async () => {
    if (network === "local") return {};
    const est = await client.estimateFeesPerGas().catch(() => null);
    const max = est?.maxFeePerGas && est.maxFeePerGas > ARC_MIN_BASE_FEE * 2n ? est.maxFeePerGas : ARC_MIN_BASE_FEE * 2n;
    return { maxFeePerGas: max, maxPriorityFeePerGas: est?.maxPriorityFeePerGas ?? 1n };
  }, [network, client]);

  const send = useCallback(
    async (address: Address, abi: Abi, functionName: string, args: unknown[]) => {
      const wallet = await getWallet();
      const { request } = await client.simulateContract({ address, abi, functionName, args, account: account!, ...(await fees()) } as never);
      const hash = await wallet.writeContract(request as never);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      return hash;
    },
    [getWallet, client, account, fees],
  );

  const write = useCallback(
    async (functionName: string, args: unknown[], opts: WriteOpts = {}) => {
      if (!dep?.arena || !account) throw new Error("Choose a wallet first");
      try {
        if (opts.approve && opts.approve > 0n) {
          const allowance = (await client.readContract({ address: dep.usdc, abi: erc20Abi, functionName: "allowance", args: [account, dep.arena] })) as bigint;
          if (allowance < opts.approve) await send(dep.usdc, erc20Abi as Abi, "approve", [dep.arena, opts.approve]);
        }
        const hash = await send(dep.arena, arenaAbi as Abi, functionName, args);
        await qc.invalidateQueries();
        return hash;
      } catch (e) {
        throw new Error(explain(e));
      }
    },
    [dep, account, client, send, qc],
  );

  const publish = useCallback(
    async (kind: TextKind, text: string) => {
      if (!dep?.textStore || !account) throw new Error("Choose a wallet first");
      const hash = hashText(text);
      const existing = (await client.readContract({ address: dep.textStore, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
      if (existing > 0n) return hash;
      try {
        await send(dep.textStore, textStoreAbi as Abi, "publish", [TEXT_KIND[kind], text]);
      } catch (e) {
        throw new Error(explain(e));
      }
      return hash;
    },
    [dep, account, client, send],
  );

  const mintTestUsdc = useCallback(async () => {
    if (network !== "local" || !dep || !account) return;
    await send(dep.usdc, erc20Abi as Abi, "mint", [account, 1_000_000_000n]);
    await qc.invalidateQueries();
  }, [network, dep, account, send, qc]);

  const skipTime = useCallback(
    async (seconds: number) => {
      if (network !== "local") return;
      await client.request({ method: "evm_increaseTime", params: [seconds] } as never);
      await client.request({ method: "evm_mine", params: [] } as never);
      const block = await client.getBlock();
      setOffset(Number(block.timestamp) - Math.floor(Date.now() / 1000));
      await qc.invalidateQueries();
    },
    [network, client, qc],
  );

  const value: Ctx = {
    network,
    setNetwork,
    dep,
    depError,
    client,
    offset,
    account,
    walletKind,
    demoAccounts,
    selectDemo,
    write,
    publish,
    mintTestUsdc,
    skipTime,
  };
  return <ArenaCtx.Provider value={value}>{children}</ArenaCtx.Provider>;
}

export function useArena() {
  const c = useContext(ArenaCtx);
  if (!c) throw new Error("ArenaProvider missing");
  return c;
}

/** Chain time in seconds, ticking. The local demo clock runs ahead of the wall clock. */
export function useNow(intervalMs = 1000) {
  const { offset } = useArena();
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return t + offset;
}

export type Snapshot = Awaited<ReturnType<typeof readArena>> & { byAddress: Map<string, HunterStats> };

/** The whole arena in one read, refreshed every 4 seconds. */
export function useArenaData() {
  const { dep, client, network } = useArena();
  return useQuery({
    queryKey: ["arena", network, dep?.arena],
    enabled: !!dep?.arena,
    refetchInterval: 4000,
    queryFn: async (): Promise<Snapshot> => {
      const snap = await readArena(client, dep!.arena!, { timeOffset: dep!.timeOffset });
      return { ...snap, byAddress: new Map(snap.hunters.map((h) => [h.address.toLowerCase(), h])) };
    },
  });
}

export function useBalances(account?: Address) {
  const { dep, client, network } = useArena();
  return useQuery({
    queryKey: ["balances", network, dep?.arena, account],
    enabled: !!dep?.arena && !!account,
    refetchInterval: 5000,
    queryFn: async () => {
      const [wallet, claimable] = await Promise.all([
        client.readContract({ address: dep!.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account!] }) as Promise<bigint>,
        readClaimable(client, dep!.arena!, account!),
      ]);
      return { wallet, claimable };
    },
  });
}

/** A text from the onchain store, with the demo's HTTP store as a fallback. Hash-checked either way. */
export function useText(hash: Hex | null | undefined) {
  const { dep, client, network } = useArena();
  return useQuery({
    queryKey: ["text", network, hash],
    enabled: !!hash && !!dep,
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (q) => (q.state.data ? false : 5000),
    queryFn: async (): Promise<string | null> => {
      if (dep?.textStore) {
        const entry = await readText(client, dep.textStore, hash!).catch(() => null);
        if (entry) return entry.text;
      }
      try {
        const res = await fetch(`/api/store/${hash!.toLowerCase()}`);
        if (!res.ok) return null;
        const { text } = (await res.json()) as { text: string };
        return hashText(text) === hash ? text : null;
      } catch {
        return null;
      }
    },
  });
}

// ------------------------------------------------------------------ live moments

type PaidEvent = { bounty: Bounty; at: number };
const paidListeners = new Set<(e: PaidEvent) => void>();

/** Subscribe to commissions that become paid while the page is open: the coin pulses, the line clears. */
export function onPaid(fn: (e: PaidEvent) => void) {
  paidListeners.add(fn);
  return () => void paidListeners.delete(fn);
}

/** Watches each snapshot for commissions that just settled and tells the listeners. */
export function usePaidWatcher() {
  const { data } = useArenaData();
  const prev = useRef<Map<number, string> | null>(null);
  const [recent, setRecent] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!data) return;
    const now = new Map(data.bounties.map((b) => [b.id, b.status]));
    if (prev.current) {
      for (const b of data.bounties) {
        const before = prev.current.get(b.id);
        if ((b.status === "paid" || b.status === "ghost-paid") && before !== b.status) {
          paidListeners.forEach((fn) => fn({ bounty: b, at: Date.now() }));
          setRecent((s) => new Set(s).add(b.id));
          setTimeout(() => setRecent((s) => {
            const n = new Set(s);
            n.delete(b.id);
            return n;
          }), 4000);
        }
      }
    }
    prev.current = now;
  }, [data]);
  return recent;
}

// ------------------------------------------------------------------ errors

const ERRORS: Record<string, string> = {
  NotRegistered: "Set up your maker profile first.",
  BadInput: "The contract turned that input down. Check the amounts and dates.",
  BadState: "This commission is not in a state that allows that.",
  TooEarly: "Too early for that. Check the timeline.",
  TooLate: "That window has closed.",
  NotPoster: "Only the patron can do this.",
  NotArbiter: "Only this commission's arbiter can rule.",
  NotVerifier: "Only the verifier can post test results.",
  NotSubmitter: "Only makers who entered can dispute.",
  AlreadySubmitted: "You have already entered this commission.",
  FirstValidOrder: "First valid: reject the earlier entries before awarding a later one.",
  ERC20InsufficientBalance: "Not enough USDC in this wallet.",
  ERC20InsufficientAllowance: "The USDC allowance is too low.",
  BadText: "The text is empty or too long for the store.",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return ERRORS[name] ?? revert.shortMessage;
    }
    if (/rejected|denied/i.test(e.message)) return "You turned the request down in your wallet.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

const STATUS_NUM: Record<Bounty["status"], number> = { open: 0, awarded: 1, disputed: 2, paid: 3, "ghost-paid": 4, refunded: 5 };

/** The phase right now, recomputed every tick from chain time (shared's phaseOf takes the raw status). */
export function livePhase(b: Bounty, now: number): Phase {
  return phaseOf({ ...b, status: STATUS_NUM[b.status] }, now);
}
