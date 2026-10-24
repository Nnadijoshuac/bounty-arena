import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  // Native balance is USDC with 18 decimals. All app accounting uses the 6-decimal ERC-20.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const arenaLocal = defineChain({
  id: 31337,
  name: "Local demo",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
  testnet: true,
});

export type NetworkKey = "local" | "arcTestnet";

export const NETWORKS: Record<NetworkKey, { chain: typeof arcTestnet | typeof arenaLocal; label: string }> = {
  local: { chain: arenaLocal, label: "Local demo" },
  arcTestnet: { chain: arcTestnet, label: "Arc testnet" },
};
