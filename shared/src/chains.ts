import { defineChain, type Chain } from "viem";

export const LOCAL_CHAIN_ID = 31337 as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042 as const;
export type ArenaChainId = typeof LOCAL_CHAIN_ID | typeof ARC_TESTNET_CHAIN_ID | typeof ARC_MAINNET_CHAIN_ID;

/** Arc's minimum base fee. Set maxFeePerGas at or above it. */
export const ARC_MIN_BASE_FEE = 20_000_000_000n;

/** USDC's ERC-20 interface on Arc testnet. 6 decimals. Also the gas token (18 decimals natively). */
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as const;

export const arcTestnet: Chain = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

/** Arc mainnet. Real USDC: the same ERC-20 address as testnet, per docs.arc.io/arc/references/contract-addresses. */
export const arcMainnet: Chain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

/** The local demo chain started by `npm run demo` (Hardhat node on port 8555). */
export const arenaLocal: Chain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "Arena local demo",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
  testnet: true,
});

export const CHAINS: Record<ArenaChainId, Chain> = {
  [LOCAL_CHAIN_ID]: arenaLocal,
  [ARC_TESTNET_CHAIN_ID]: arcTestnet,
  [ARC_MAINNET_CHAIN_ID]: arcMainnet,
};

/** Local demo HTTP endpoints (served by `npm run demo`). */
export const LOCAL_DEMO = {
  rpc: "http://127.0.0.1:8555",
  web: "http://localhost:5303",
  store: "http://localhost:5303/api/store",
  deployment: "http://localhost:5303/deployments/local.json",
  manifest: "http://localhost:5303/arena.json",
} as const;
