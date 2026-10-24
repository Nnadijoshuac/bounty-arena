import { keccak256, toBytes, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { textStoreAbi } from "./abi";

/**
 * Text store client. Texts live onchain in ArenaTextStore (only hashes go into the arena).
 * Local demo: read and write through the dev server's /api/store, which publishes for you.
 * Arc testnet: read from the chain and publish from the connected wallet. No server needed.
 */
export type StoreEntry = { hash: Hex; kind: string; text: string };

type Backend =
  | { kind: "http" }
  | { kind: "chain"; client: PublicClient; textStore: Address; getWallet: () => Promise<WalletClient>; account?: Address };

let backend: Backend = { kind: "http" };
export function configureStore(b: Backend) {
  backend = b;
}

const KINDS = { spec: 0, deliverable: 1, check: 2, report: 3 } as const;
const cache = new Map<string, StoreEntry | null>();

export async function getText(hash: Hex): Promise<StoreEntry | null> {
  const key = hash.toLowerCase();
  if (cache.get(key)) return cache.get(key)!;
  let entry: StoreEntry | null = null;
  if (backend.kind === "http") {
    const res = await fetch(`/api/store/${key}`);
    entry = res.ok ? ((await res.json()) as StoreEntry) : null;
  } else {
    const { client, textStore } = backend;
    const block = (await client.readContract({ address: textStore, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
    if (block > 0n) {
      const logs = await client.getContractEvents({ address: textStore, abi: textStoreAbi, eventName: "Published", args: { hash }, fromBlock: block, toBlock: block });
      const a = (logs[0] as any)?.args;
      if (a) entry = { hash, kind: String(a.kind), text: a.text };
    }
  }
  if (entry) cache.set(key, entry);
  return entry;
}

export async function putText(kind: keyof typeof KINDS, text: string): Promise<Hex> {
  if (backend.kind === "http") {
    const res = await fetch("/api/store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, text }),
    });
    if (!res.ok) throw new Error("Could not save the text to the store");
    return ((await res.json()) as { hash: Hex }).hash;
  }
  const { client, textStore, getWallet, account } = backend;
  const hash = hashText(text);
  const exists = (await client.readContract({ address: textStore, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
  if (exists > 0n) return hash;
  if (!account) throw new Error("Connect a wallet first");
  const wallet = await getWallet();
  const tx = await wallet.writeContract({ address: textStore, abi: textStoreAbi, functionName: "publish", args: [KINDS[kind], text], account, chain: wallet.chain });
  await client.waitForTransactionReceipt({ hash: tx });
  return hash;
}

export function hashText(text: string): Hex {
  return keccak256(toBytes(text));
}
