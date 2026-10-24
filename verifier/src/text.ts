import { keccak256, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { textStoreAbi } from "./abi.js";

export const KIND = { spec: 0, deliverable: 1, check: 2, report: 3 } as const;

/** Reads a text from ArenaTextStore by hash: one blockOf call, one eth_getLogs on that block. */
export async function readText(client: PublicClient, store: Address, hash: Hex): Promise<string | null> {
  const block = (await client.readContract({ address: store, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
  if (block === 0n) return null;
  const logs = await client.getContractEvents({
    address: store,
    abi: textStoreAbi,
    eventName: "Published",
    args: { hash },
    fromBlock: block,
    toBlock: block,
  });
  const text = (logs[0] as any)?.args?.text as string | undefined;
  if (text === undefined || keccak256(toBytes(text)) !== hash) return null;
  return text;
}

export const hashText = (text: string): Hex => keccak256(toBytes(text));
