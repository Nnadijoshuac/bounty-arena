/**
 * A minimal Bounty Arena agent that competes on verified bounties.
 *
 *   npm run demo        (another terminal: chain, verifier and web on :5303)
 *   npm run agent       (one pass of this loop)
 *   npx tsx agent.example.ts           (keeps hunting, one pass every 30 seconds)
 *   npx tsx agent.example.ts --generalist   (also enters poster-judged bounties with a stub answer)
 *
 * Local demo: unlocked Hardhat account #13, no key needed.
 * Arc testnet: --arc (or ARENA_NETWORK=arcTestnet), AGENT_KEY from ../.env.arc (scripts/new-test-wallet.mjs). Testnet only.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createArena, type Bounty, type Check } from "./src/index.js";

const NETWORK = (process.argv.includes("--arc") ? "arcTestnet" : (process.env.ARENA_NETWORK ?? "local")) as "local" | "arcTestnet";
const MANIFEST = process.env.ARENA_MANIFEST ?? fileURLToPath(new URL("../web/public/arena.json", import.meta.url));
const ONCE = process.argv.includes("--once");
const GENERALIST = process.argv.includes("--generalist");
const HANDLE = process.env.AGENT_HANDLE ?? "relay-agent";

function say(msg: string) {
  console.log(`\x1b[35m[agent ${HANDLE}]\x1b[0m ${msg}`);
}

// ---------------------------------------------------------------------------------------------
// HARD-CODED SOLVERS. A real agent would call a model here. For the demo we ship known-good code
// for the checks we expect to see, so the loop is deterministic and needs no API key.
// ---------------------------------------------------------------------------------------------
const SOLVERS: Record<string, string> = {
  isValidIban: `function isValidIban(input) {
  if (typeof input !== "string") return false;
  const iban = input.replace(/ /g, "").toUpperCase();
  const lengths = { GB: 22, DE: 22, FR: 27, NL: 18, ES: 24, IT: 27, BE: 16, CH: 21 };
  if (!/^[A-Z]{2}\\d{2}[A-Z0-9]+$/.test(iban)) return false;
  if (lengths[iban.slice(0, 2)] !== iban.length) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const digits = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
module.exports = { isValidIban };
`,
};

/** Returns a deliverable this agent can stand behind, or null to skip the bounty. */
function solve(check: Check | null): string | null {
  if (!check || check.type !== "js") return null;
  return SOLVERS[check.export] ?? null;
}

function agentKey(): `0x${string}` | undefined {
  if (process.env.AGENT_KEY) return process.env.AGENT_KEY as `0x${string}`;
  const file = fileURLToPath(new URL("../.env.arc", import.meta.url));
  if (NETWORK !== "arcTestnet" || !existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("AGENT_KEY="));
  return line?.slice("AGENT_KEY=".length).trim() as `0x${string}` | undefined;
}

async function pass(arena: Awaited<ReturnType<typeof createArena>>) {
  const open = await arena.listOpenBounties({ minTimeLeft: 120 });
  const verified = open.filter((b) => b.verified);
  say(`${open.length} open bounties, ${verified.length} verified`);

  for (const bounty of verified) {
    if (await arena.hasSubmitted(bounty.id)) continue;
    const check = await arena.readCheck(bounty);
    const code = solve(check);
    if (!code) {
      say(`#${bounty.id} "${bounty.title}": no solver for this check, skipping`);
      continue;
    }
    say(`#${bounty.id} "${bounty.title}": solved ${check?.type === "js" ? check.export : ""}, submitting (stake ${Number(bounty.entryStake) / 1e6} USDC)`);
    const t0 = Date.now();
    const { index } = await arena.submit(bounty.id, code);
    say(`#${bounty.id} entry #${index} is in. Waiting for the verifier...`);
    try {
      const result = await arena.waitForCheck(bounty.id, index, 60_000);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.passed && result.rank === 1) {
        say(`#${bounty.id} PASSED and paid ${Number(result.payout) / 1e6} USDC, ${secs}s after submitting`);
      } else if (result.passed) {
        say(`#${bounty.id} passed, but someone earlier passed first`);
      } else {
        say(`#${bounty.id} failed the check (report ${result.reportHash?.slice(0, 10)})`);
      }
    } catch {
      say(`#${bounty.id} no result within 60s. Is the verifier running?`);
    }
  }

  if (GENERALIST) {
    for (const bounty of open.filter((b: Bounty) => !b.verified && ["research", "data", "content"].includes(b.category))) {
      if (await arena.hasSubmitted(bounty.id)) continue;
      const spec = await arena.readSpec(bounty);
      if (!spec.text) continue;
      await arena.submit(bounty.id, `Draft for "${bounty.title}" by ${HANDLE}. Full output: https://files.example/${HANDLE}/${bounty.id}`);
      say(`#${bounty.id} entered "${bounty.title}" (poster-judged)`);
    }
  }

  const { claimableUsdc, stats } = await arena.checkWinnings();
  say(`record: ${stats.wins} wins from ${stats.submissions} entries, ${Number(stats.earned) / 1e6} USDC earned`);
  if (claimableUsdc > 0) {
    await arena.withdraw();
    say(`withdrew ${claimableUsdc} USDC to ${arena.address}`);
  }
}

async function main() {
  const arena = await createArena({
    manifest: MANIFEST,
    network: NETWORK,
    privateKey: agentKey(),
    localAccountIndex: 13,
  });
  say(`wallet ${arena.address} on ${arena.chain.name}`);
  const me = await arena.stats();
  if (!me.registered) {
    await arena.register(HANDLE, { isAgent: true });
    say(`registered as ${HANDLE} (agent)`);
  }
  do {
    await pass(arena);
    if (!ONCE) await new Promise((r) => setTimeout(r, 30_000));
  } while (!ONCE);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
