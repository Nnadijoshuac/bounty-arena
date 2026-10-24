import type { Address } from "viem";
import type { ArenaChainId } from "./chains";
import type { Deployment } from "./types";
import { GENERATED } from "./addresses.generated";

export type ArenaAddresses = {
  arena: Address;
  textStore: Address;
  usdc: Address;
  arbiter: Address;
  verifier: Address;
  startBlock: number;
};

/**
 * Addresses per chain, written by the deploy scripts into addresses.generated.ts.
 * Local addresses are deterministic on a fresh `npm run demo`. Arc testnet and mainnet are null until their deploy script runs.
 */
export const ADDRESSES: Record<ArenaChainId, ArenaAddresses | null> = GENERATED;

export function getAddresses(chainId: number): ArenaAddresses {
  const a = ADDRESSES[chainId as ArenaChainId];
  if (!a) throw new Error(`Bounty Arena is not deployed on chain ${chainId}`);
  return a;
}

/**
 * Runtime alternative: read the deployment file the demo serves
 * (http://localhost:5303/deployments/local.json) or that ships with a static build.
 * Includes timeOffset for the local demo clock.
 */
export async function loadDeployment(url: string): Promise<Deployment> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No deployment at ${url}`);
  return (await res.json()) as Deployment;
}
