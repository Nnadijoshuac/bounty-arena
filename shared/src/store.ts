import { keccak256, toBytes, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { textStoreAbi } from "./abi";

/**
 * Text store. Specs, checks, deliverables and verifier reports are stored by keccak256(utf8(text)).
 * Only the hash goes into BountyArena. The text lives in ArenaTextStore as an event, so it works
 * on any chain with no server. The local demo also serves an HTTP view of the same store.
 */
export const TEXT_KIND = { spec: 0, deliverable: 1, check: 2, report: 3 } as const;
export type TextKind = keyof typeof TEXT_KIND;

export type StoreEntry = { hash: Hex; kind: TextKind; text: string; block: number };

export const hashText = (text: string): Hex => keccak256(toBytes(text));

// ---------------------------------------------------------------- onchain (works everywhere)

const cache = new Map<string, StoreEntry | null>();

/** Reads a text by hash: one blockOf call plus one eth_getLogs on that block. Verifies the hash. */
export async function readText(client: PublicClient, textStore: Address, hash: Hex): Promise<StoreEntry | null> {
  const key = `${textStore}:${hash}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const block = (await client.readContract({ address: textStore, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
  if (block === 0n) return null;
  const logs = await client.getContractEvents({
    address: textStore,
    abi: textStoreAbi,
    eventName: "Published",
    args: { hash },
    fromBlock: block,
    toBlock: block,
  });
  const args = (logs[0] as any)?.args as { text: string; kind: number } | undefined;
  if (!args || hashText(args.text) !== hash) return null;
  const entry: StoreEntry = { hash, kind: (Object.keys(TEXT_KIND) as TextKind[])[args.kind], text: args.text, block: Number(block) };
  cache.set(key, entry);
  return entry;
}

/** Publishes a text from the connected wallet and returns its hash. Skips the tx if it already exists. */
export async function publishText(
  client: PublicClient,
  wallet: WalletClient,
  textStore: Address,
  kind: TextKind,
  text: string,
): Promise<Hex> {
  const hash = hashText(text);
  const existing = (await client.readContract({ address: textStore, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
  if (existing > 0n) return hash;
  const account = wallet.account ?? ((await wallet.getAddresses())[0] as Address);
  const { request } = await client.simulateContract({
    address: textStore,
    abi: textStoreAbi,
    functionName: "publish",
    args: [TEXT_KIND[kind], text],
    account,
  });
  const tx = await wallet.writeContract(request as any);
  await client.waitForTransactionReceipt({ hash: tx });
  return hash;
}

// ---------------------------------------------------------------- local demo HTTP API

/**
 * HTTP view of the store served by the local demo on port 5303 (CORS open).
 *   GET  /api/store/{hash}        -> StoreEntry, 404 if unknown
 *   POST /api/store {kind, text}  -> { hash }   (local demo only: the dev server publishes it onchain for you)
 */
export function httpStore(baseUrl = "http://localhost:5303/api/store") {
  return {
    async get(hash: Hex): Promise<StoreEntry | null> {
      const res = await fetch(`${baseUrl}/${hash}`);
      return res.ok ? ((await res.json()) as StoreEntry) : null;
    },
    async put(kind: TextKind, text: string): Promise<Hex> {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, text }),
      });
      if (!res.ok) throw new Error(`store rejected the text (${res.status})`);
      return ((await res.json()) as { hash: Hex }).hash;
    },
  };
}
