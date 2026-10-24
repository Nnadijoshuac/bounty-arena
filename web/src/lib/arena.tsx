import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { useAccount } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { arenaAbi, erc20Abi } from "./abi";
import { NETWORKS, type NetworkKey } from "./chains";
import { wagmiConfig } from "./wagmi";
import { configureStore } from "./store";

// ------------------------------------------------------------------ types

export type Deployment = {
  network: NetworkKey;
  chainId: number;
  arena: Address | null;
  textStore?: Address | null;
  usdc: Address;
  arbiter?: Address;
  treasury?: Address;
  startBlock: number;
  timeOffset: number;
};

export type Submission = {
  index: number;
  hunter: Address;
  deliverableHash: Hex;
  submittedAt: number;
  isAgent: boolean;
  rejected: boolean;
  rank: number;
  payout: bigint;
  checked: boolean;
  passed: boolean;
};

export type Bounty = {
  id: number;
  poster: Address;
  arbiter: Address;
  disputer: Address;
  reward: bigint;
  bond: bigint;
  entryStake: bigint;
  createdAt: number;
  deadline: number;
  reviewEnd: number;
  awardedAt: number;
  disputedAt: number;
  featuredUntil: number;
  disputeWindow: number;
  feeBps: number;
  mode: number;
  category: number;
  status: number;
  specHash: Hex;
  title: string;
  subs: Submission[];
};

export type Hunter = {
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
  categoryWins: number[];
};

export type ArenaData = {
  bounties: Bounty[];
  hunters: Hunter[];
  byAddress: Map<string, Hunter>;
  config: {
    feeBps: number;
    featuredPricePerDay: bigint;
    disputeBond: bigint;
    reviewWindow: number;
    disputeWindow: number;
    feesAccrued: bigint;
    treasury: Address;
    arbiter: Address;
    owner: Address;
  };
};

export const Status = { Open: 0, Awarded: 1, Disputed: 2, Paid: 3, GhostPaid: 4, Refunded: 5 } as const;

export type Phase = "open" | "review" | "timeout" | "awarded" | "finalizable" | "disputed" | "paid" | "ghost" | "refunded";

export function phaseOf(b: Bounty, now: number): Phase {
  switch (b.status) {
    case Status.Open:
      if (now < b.deadline) return "open";
      if (now < b.reviewEnd) return "review";
      return "timeout";
    case Status.Awarded:
      return now < b.awardedAt + b.disputeWindow ? "awarded" : "finalizable";
    case Status.Disputed:
      return "disputed";
    case Status.Paid:
      return "paid";
    case Status.GhostPaid:
      return "ghost";
    default:
      return "refunded";
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  open: "Open",
  review: "In review",
  timeout: "Review missed",
  awarded: "Awarded",
  finalizable: "Ready to pay",
  disputed: "Disputed",
  paid: "Paid",
  ghost: "Split payout",
  refunded: "Refunded",
};

export const isLive = (p: Phase) => p === "open";
export const isSettled = (p: Phase) => p === "paid" || p === "ghost" || p === "refunded";

// ------------------------------------------------------------------ context

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
  const [network, setNetworkState] = useState<NetworkKey>(
    (readLocal("arena.network") as NetworkKey) || (import.meta.env.VITE_NETWORK as NetworkKey) || "local",
  );
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

  // load the deployment for the selected network
  useEffect(() => {
    let alive = true;
    setDep(null);
    setDepError(null);
    fetch(`/deployments/${network}.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("missing"))))
      .then(async (d: Deployment) => {
        if (!alive) return;
        if (!d.arena) {
          setDepError(network === "local" ? "The local demo is not deployed. Run npm run demo." : "Bounty Arena is not deployed on Arc testnet yet.");
          return;
        }
        setDep(d);
        let off = d.timeOffset || 0;
        try {
          const block = await client.getBlock();
          off = Math.max(off, Number(block.timestamp) - Math.floor(Date.now() / 1000));
        } catch {
          setDepError(network === "local" ? "Cannot reach the local node on port 8555. Run npm run demo." : "Cannot reach the Arc testnet RPC.");
        }
        if (alive) setOffset(off);
        if (network === "local") {
          try {
            const accts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
            if (alive) setDemoAccounts(accts.slice(0, 16));
          } catch {}
        }
      })
      .catch(() => {
        if (alive) setDepError(network === "local" ? "The local demo is not deployed. Run npm run demo." : "Bounty Arena is not deployed on Arc testnet yet.");
      });
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
      // The local Hardhat node holds unlocked dev accounts, so no key ever touches the browser.
      return createWalletClient({ account: demo, chain, transport: http(chain.rpcUrls.default.http[0]) });
    }
    if (walletKind === "injected") {
      await switchChain(wagmiConfig, { chainId: chain.id as 31337 | 5042002 }).catch(() => {});
      return (await getWalletClient(wagmiConfig, { chainId: chain.id as 31337 | 5042002 })) as WalletClient;
    }
    throw new Error("Connect a wallet first");
  }, [walletKind, demo, chain]);

  // Local demo: the dev server store API. Arc testnet: read and publish texts onchain.
  useEffect(() => {
    if (network === "local" || !dep?.textStore) configureStore({ kind: "http" });
    else configureStore({ kind: "chain", client, textStore: dep.textStore, getWallet, account });
  }, [network, dep, client, getWallet, account]);

  const write = useCallback(
    async (functionName: string, args: unknown[], opts: WriteOpts = {}) => {
      if (!dep?.arena || !account) throw new Error("Connect a wallet first");
      const wallet = await getWallet();
      try {
        if (opts.approve && opts.approve > 0n) {
          const allowance = (await client.readContract({
            address: dep.usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, dep.arena],
          })) as bigint;
          if (allowance < opts.approve) {
            const h = await wallet.writeContract({
              address: dep.usdc,
              abi: erc20Abi,
              functionName: "approve",
              args: [dep.arena, opts.approve],
              account,
              chain,
            });
            await client.waitForTransactionReceipt({ hash: h });
          }
        }
        const { request } = await client.simulateContract({
          address: dep.arena,
          abi: arenaAbi,
          functionName: functionName as never,
          args: args as never,
          account,
        });
        const hash = await wallet.writeContract(request as never);
        await client.waitForTransactionReceipt({ hash });
        await qc.invalidateQueries();
        return hash;
      } catch (e) {
        throw new Error(explain(e));
      }
    },
    [dep, account, getWallet, client, chain, qc],
  );

  const mintTestUsdc = useCallback(async () => {
    if (network !== "local" || !dep || !account) return;
    const wallet = await getWallet();
    const h = await wallet.writeContract({
      address: dep.usdc,
      abi: erc20Abi,
      functionName: "mint",
      args: [account, 1_000_000_000n],
      account,
      chain,
    });
    await client.waitForTransactionReceipt({ hash: h });
    await qc.invalidateQueries();
  }, [network, dep, account, getWallet, client, chain, qc]);

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

/** Chain time in seconds, ticking. Local demo time can run ahead of the wall clock. */
export function useNow(intervalMs = 1000) {
  const { offset } = useArena();
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return t + offset;
}

// ------------------------------------------------------------------ data

export function useArenaData() {
  const { dep, client, network } = useArena();
  return useQuery({
    queryKey: ["arena", network, dep?.arena],
    enabled: !!dep?.arena,
    refetchInterval: 5000,
    queryFn: async (): Promise<ArenaData> => {
      const address = dep!.arena!;
      const read = (functionName: string, args: unknown[] = []) =>
        client.readContract({ address, abi: arenaAbi, functionName: functionName as never, args: args as never }) as Promise<any>;

      const [count, hunterAddrs, feeBps, featuredPricePerDay, disputeBond, reviewWindow, disputeWindow, feesAccrued, treasury, arbiter, owner] =
        await Promise.all([
          read("bountyCount"),
          read("getHunters"),
          read("feeBps"),
          read("featuredPricePerDay"),
          read("disputeBond"),
          read("reviewWindow"),
          read("disputeWindow"),
          read("feesAccrued"),
          read("treasury"),
          read("arbiter"),
          read("owner"),
        ]);

      const ids = Array.from({ length: Number(count) }, (_, i) => i);
      const [raws, subsRaw, statsRaw] = await Promise.all([
        Promise.all(ids.map((i) => read("getBounty", [BigInt(i)]))),
        Promise.all(ids.map((i) => read("getSubmissions", [BigInt(i)]))),
        Promise.all((hunterAddrs as Address[]).map((a) => read("getStats", [a]))),
      ]);

      const bounties: Bounty[] = raws.map((b: any, i: number) => ({
        id: i,
        poster: b.poster,
        arbiter: b.arbiter,
        disputer: b.disputer,
        reward: b.reward,
        bond: b.bond,
        entryStake: b.entryStake,
        createdAt: Number(b.createdAt),
        deadline: Number(b.deadline),
        reviewEnd: Number(b.reviewEnd),
        awardedAt: Number(b.awardedAt),
        disputedAt: Number(b.disputedAt),
        featuredUntil: Number(b.featuredUntil),
        disputeWindow: Number(b.disputeWindow),
        feeBps: Number(b.feeBps),
        mode: Number(b.mode),
        category: Number(b.category),
        status: Number(b.status),
        specHash: b.specHash,
        title: b.title,
        subs: (subsRaw[i] as any[]).map((s, index) => ({
          index,
          hunter: s.hunter,
          deliverableHash: s.deliverableHash,
          submittedAt: Number(s.submittedAt),
          isAgent: s.isAgent,
          rejected: s.rejected,
          rank: Number(s.rank),
          payout: s.payout,
          checked: s.checked,
          passed: s.passed,
        })),
      }));

      const hunters: Hunter[] = (hunterAddrs as Address[]).map((address, i) => {
        const s = statsRaw[i];
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
          categoryWins: (s.categoryWins as number[]).map(Number),
        };
      });

      return {
        bounties,
        hunters,
        byAddress: new Map(hunters.map((h) => [h.address.toLowerCase(), h])),
        config: {
          feeBps: Number(feeBps),
          featuredPricePerDay,
          disputeBond,
          reviewWindow: Number(reviewWindow),
          disputeWindow: Number(disputeWindow),
          feesAccrued,
          treasury,
          arbiter,
          owner,
        },
      };
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
        client.readContract({ address: dep!.arena!, abi: arenaAbi, functionName: "claimable", args: [account!] }) as Promise<bigint>,
      ]);
      return { wallet, claimable };
    },
  });
}

// ------------------------------------------------------------------ errors

const ERRORS: Record<string, string> = {
  NotRegistered: "Set up your hunter profile first.",
  BadInput: "That input was rejected by the contract.",
  BadState: "The bounty is not in a state that allows this.",
  TooEarly: "Too early for that. Check the timeline.",
  TooLate: "That window has closed.",
  NotPoster: "Only the poster can do this.",
  NotArbiter: "Only this bounty's arbiter can rule.",
  NotSubmitter: "Only hunters who submitted can dispute.",
  AlreadySubmitted: "You already submitted to this bounty.",
  FirstValidOrder: "First valid: reject earlier submissions before awarding a later one.",
  ERC20InsufficientBalance: "Not enough USDC in this wallet.",
  ERC20InsufficientAllowance: "USDC allowance is too low.",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return ERRORS[name] ?? revert.shortMessage;
    }
    if (/rejected|denied/i.test(e.message)) return "You rejected the request in your wallet.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
