/**
 * Bounty Arena verifier.
 *
 * Watches verified bounties, runs each new entry through the bounty's machine check,
 * publishes a report to the text store and posts the result with verifyAndAward.
 * The first entry that passes is paid by the contract on the spot.
 *
 * Trust model: this service is trusted to run the check honestly. The contract limits the damage:
 * it can only pay an existing entrant, only in entry order, only before deadline + grace,
 * and every result can be disputed to the arbiter. See README for the road to multiple verifiers or TEE/zk.
 *
 *   tsx src/index.ts --network local        (Hardhat account #14, unlocked on the local node)
 *   tsx src/index.ts --network arcTestnet   (VERIFIER_KEY from ../.env.arc, testnet only)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arenaAbi, textStoreAbi } from "./abi.js";
import { runCheck } from "./checks.js";
import { KIND, hashText, readText } from "./text.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NETWORK = (process.argv[process.argv.indexOf("--network") + 1] ?? "local") as "local" | "arcTestnet" | "arcMainnet";
const POLL_MS = Number(process.env.VERIFIER_POLL_MS ?? (NETWORK === "local" ? 1200 : 4000));
const MIN_FEE = 20_000_000_000n; // Arc minimum base fee
const REVEAL_WINDOW = 10 * 60; // seconds, matches BountyArena.REVEAL_WINDOW

const chains = {
  local: defineChain({
    id: 31337,
    name: "Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
  }),
  arcTestnet: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io"] } },
  }),
  arcMainnet: defineChain({
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io"] } },
  }),
};

function log(msg: string) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[36m[verifier ${t}]\x1b[0m ${msg}`);
}

function readEnvArc(name = ".env.arc"): Record<string, string> {
  const file = `${ROOT}${name}`;
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

async function main() {
  const depFile = `${ROOT}web/public/deployments/${NETWORK}.json`;
  const dep = JSON.parse(readFileSync(depFile, "utf8"));
  if (!dep.arena || !dep.textStore) throw new Error(`No deployment in ${depFile}`);
  const arena = dep.arena as Address;
  const store = dep.textStore as Address;
  const chain = chains[NETWORK];
  const transport = http(chain.rpcUrls.default.http[0]);
  const client = createPublicClient({ chain, transport }) as PublicClient;

  let account: Account | Address;
  if (NETWORK === "local") {
    const accounts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
    account = accounts[14];
  } else {
    const key = (
      NETWORK === "arcMainnet" ? readEnvArc(".env.mainnet").MAINNET_VERIFIER_KEY : (process.env.VERIFIER_KEY ?? readEnvArc().VERIFIER_KEY)
    ) as Hex | undefined;
    if (!key) throw new Error(NETWORK === "arcMainnet" ? "Set MAINNET_VERIFIER_KEY in .env.mainnet." : "Set VERIFIER_KEY in .env.arc (node scripts/new-test-wallet.mjs). Testnet only.");
    account = privateKeyToAccount(key);
  }
  const me = typeof account === "string" ? account : account.address;
  if (me.toLowerCase() !== String(dep.verifier).toLowerCase()) {
    log(`warning: signing as ${me} but the deployment's verifier is ${dep.verifier}`);
  }
  const wallet = createWalletClient({ account, chain, transport }) as WalletClient;

  async function fees() {
    if (NETWORK === "local") return {};
    const est = await client.estimateFeesPerGas();
    const max = est.maxFeePerGas && est.maxFeePerGas > MIN_FEE * 2n ? est.maxFeePerGas : MIN_FEE * 2n;
    return { maxFeePerGas: max, maxPriorityFeePerGas: est.maxPriorityFeePerGas ?? 1n };
  }

  async function send(address: Address, abi: any, functionName: string, args: unknown[]) {
    const { request } = await client.simulateContract({ address, abi, functionName, args, account, ...(await fees()) } as any);
    const hash = await wallet.writeContract(request as any);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return hash;
  }

  const finished = new Set<number>();
  const checkCache = new Map<Hex, string | null>();
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const count = Number(await client.readContract({ address: arena, abi: arenaAbi, functionName: "bountyCount" }));
      const now = Number((await client.getBlock()).timestamp);
      for (let id = 0; id < count; id++) {
        if (finished.has(id)) continue;
        const b = (await client.readContract({ address: arena, abi: arenaAbi, functionName: "getBounty", args: [BigInt(id)] })) as any;
        if (Number(b.mode) !== 3 || Number(b.status) !== 0) {
          finished.add(id);
          continue;
        }
        if (b.verifier.toLowerCase() !== me.toLowerCase() || now >= Number(b.reviewEnd)) {
          finished.add(id);
          continue;
        }
        const subs = (await client.readContract({ address: arena, abi: arenaAbi, functionName: "getSubmissions", args: [BigInt(id)] })) as any[];
        for (let i = 0; i < subs.length; i++) {
          if (subs[i].checked) continue;
          // Commit-reveal: an entry is judged once revealed. One that never reveals is failed after
          // its 10 minute window. Entries are judged in order, so wait here until then.
          if (!subs[i].revealed && now < Number(subs[i].submittedAt) + REVEAL_WINDOW) break;
          const done = await judge(id, b, i, subs[i]);
          if (done) {
            finished.add(id);
            break;
          }
        }
      }
    } catch (e) {
      log(`tick error: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      busy = false;
    }
  }

  async function judge(id: number, b: any, index: number, sub: any): Promise<boolean> {
    if (!checkCache.has(b.checkHash)) checkCache.set(b.checkHash, await readText(client, store, b.checkHash));
    const check = checkCache.get(b.checkHash);
    const entry = sub.revealed ? await readText(client, store, sub.deliverableHash) : null;
    const started = Date.now();
    const result =
      check == null
        ? { passed: false, type: "invalid", summary: "The check text is not in the store", results: [], ms: 0 }
        : !sub.revealed
          ? { passed: false, type: "invalid", summary: "The entry was never revealed", results: [], ms: 0 }
          : entry == null
            ? { passed: false, type: "invalid", summary: "The entry text is not in the store or does not match its hash", results: [], ms: 0 }
          : await runCheck(check, entry);

    const report = JSON.stringify(
      {
        verifier: "arena-verifier/0.1",
        bounty: id,
        entry: index,
        hunter: sub.hunter,
        commitment: sub.commitment,
        deliverableHash: sub.revealed ? sub.deliverableHash : null,
        checkHash: b.checkHash,
        passed: result.passed,
        summary: result.summary,
        results: result.results,
        error: (result as any).error,
        runMs: result.ms,
        at: new Date().toISOString(),
      },
      null,
      1,
    );
    const reportHash = hashText(report);
    try {
      await send(store, textStoreAbi, "publish", [KIND.report, report]);
      await send(arena, arenaAbi, "verifyAndAward", [BigInt(id), BigInt(index), result.passed, reportHash]);
    } catch (e) {
      log(`bounty #${id} entry #${index}: could not post result (${(e as Error).message.split("\n")[0]})`);
      return false;
    }
    const took = ((Date.now() - started) / 1000).toFixed(1);
    if (result.passed) {
      log(`bounty #${id} entry #${index} PASSED (${result.summary}). Paid out on the spot, ${took}s from pickup.`);
      return true;
    }
    log(`bounty #${id} entry #${index} failed (${result.summary}).`);
    return false;
  }

  log(`watching ${NETWORK} arena ${arena} as ${me}, every ${POLL_MS} ms`);
  await tick();
  setInterval(tick, POLL_MS);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
