import { useMemo } from "react";
import type { Address, Hex } from "viem";
import { CATEGORIES, MODES, commitmentFor, hashText, newSalt, type Bounty, type Category, type Entry, type Mode } from "@shared";
import { useArena } from "./arena";

/**
 * Every contract write Arena makes, in one place. Pages call these by intent ("seal", "award")
 * and never name a contract function, so an ABI change is a change to this file only.
 *
 * Entering is two steps, like a sealed bid:
 *   seal   commits keccak(id, maker, hash of the work, salt), so nobody can see or copy the work
 *   unveil publishes the work to the text store, then reveals the hash and salt onchain.
 *          The contract checks them against the seal. It must land within 10 minutes of sealing.
 * The text and the salt stay in this browser between the two steps.
 */

const sealKey = (network: string, id: number, who: Address) => `arena.sealed.${network}.${id}.${who.toLowerCase()}`;

type Sealed = { text: string; salt: Hex };

function readSealedEntry(network: string, id: number, who?: Address): Sealed | null {
  if (!who) return null;
  try {
    const raw = localStorage.getItem(sealKey(network, id, who));
    if (!raw) return null;
    const v = JSON.parse(raw) as Sealed;
    return v && typeof v.text === "string" && typeof v.salt === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The work sealed from this browser, waiting to be unveiled. */
export function readSealed(network: string, id: number, who?: Address): string | null {
  return readSealedEntry(network, id, who)?.text ?? null;
}

export type PostInput = {
  title: string;
  brief: string;
  category: Category;
  mode: Mode;
  reward: bigint;
  deadline: bigint;
  featureDays: number;
  /** Proven only: the check text and the entry stake */
  tests?: string;
  stake?: bigint;
  featureCost: bigint;
  /** The featured price per day the patron saw. The contract refuses if it has gone up since. */
  featurePrice: bigint;
  onStep?: (step: "brief" | "tests" | "escrow") => void;
};

export function useActions() {
  const { write, publish, network, account } = useArena();
  return useMemo(() => {
    const id = (b: Bounty | number) => BigInt(typeof b === "number" ? b : b.id);
    return {
      register: (handle: string, isAgent: boolean) => write("register", [handle, isAgent]),

      /** Publishes the brief (and the tests), then escrows the fee. Returns nothing, read the new id from the chain. */
      post: async (p: PostInput) => {
        p.onStep?.("brief");
        const specHash = await publish("spec", `# ${p.title}\n\n${p.brief}\n`);
        const cat = CATEGORIES.indexOf(p.category);
        if (p.mode === "verified") {
          p.onStep?.("tests");
          const checkHash = await publish("check", p.tests!);
          p.onStep?.("escrow");
          return write("createVerifiedBounty", [p.title, specHash, checkHash, cat, p.reward, p.deadline, p.featureDays, p.featurePrice, p.stake ?? 0n, 0], { approve: p.reward + p.featureCost });
        }
        p.onStep?.("escrow");
        return write("createBounty", [p.title, specHash, cat, MODES.indexOf(p.mode), p.reward, p.deadline, p.featureDays, p.featurePrice, 0n, 0], { approve: p.reward + p.featureCost });
      },

      /** Step one: commit to the work without showing it. The text and salt are kept here until it is unveiled. */
      seal: async (b: Bounty, text: string) => {
        if (!account) throw new Error("Choose a wallet first");
        const salt = newSalt();
        const commitment = commitmentFor(b.id, account, hashText(text), salt);
        try {
          localStorage.setItem(sealKey(network, b.id, account), JSON.stringify({ text, salt } satisfies Sealed));
        } catch {}
        return write("submit", [id(b), commitment], { approve: b.entryStake });
      },

      /** Step two: publish the work, then reveal its hash and salt so the contract can match the seal. */
      unveil: async (b: Bounty, entry: Entry, text: string) => {
        if (!account) throw new Error("Choose a wallet first");
        const sealed = readSealedEntry(network, b.id, account);
        if (!sealed) throw new Error("The seal for this entry was made in another browser, so its salt is not here.");
        const contentHash = hashText(text);
        if (commitmentFor(b.id, account, contentHash, sealed.salt).toLowerCase() !== entry.commitment.toLowerCase())
          throw new Error("This is not the text you sealed. It must match exactly.");
        await publish("deliverable", text);
        const hash = await write("reveal", [id(b), BigInt(entry.index), contentHash, sealed.salt]);
        try {
          localStorage.removeItem(sealKey(network, b.id, account));
        } catch {}
        return hash;
      },

      reject: (b: Bounty, index: number) => write("reject", [id(b), BigInt(index)]),
      award: (b: Bounty, indexes: number[]) => write("award", [id(b), indexes]),
      finalize: (b: Bounty) => write("finalize", [id(b)]),
      settleTimeout: (b: Bounty) => write("settleTimeout", [id(b)]),
      reclaim: (b: Bounty) => write("reclaim", [id(b)]),
      dispute: (b: Bounty, bond: bigint) => write("dispute", [id(b)], { approve: bond }),
      rule: (b: Bounty, indexes: number[]) => write("resolveDispute", [id(b), indexes]),
      settleStale: (b: Bounty) => write("settleStaleDispute", [id(b)]),
      tip: (b: Bounty, index: number, amount: bigint) => write("tip", [id(b), BigInt(index), amount], { approve: amount }),
      feature: (b: Bounty, days: number, cost: bigint) => write("feature", [id(b), days, cost / BigInt(days)], { approve: cost }),
      withdraw: () => write("withdraw", []),
    };
  }, [write, publish, network, account]);
}
