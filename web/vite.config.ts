import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import fs from "node:fs";
import path from "node:path";
import { textStoreAbi } from "./src/lib/abi";

/**
 * Local demo store API, a thin HTTP view of the onchain ArenaTextStore.
 *   GET  /api/store/{hash}        -> { hash, kind, text, block }
 *   POST /api/store {kind, text}  -> { hash }   publishes onchain from dev account #15 (local node only)
 * Texts live onchain, so the same hashes resolve on Arc testnet without this server.
 */
const RPC = "http://127.0.0.1:8555";
const DEPLOYMENT = path.resolve(__dirname, "public/deployments/local.json");
const KINDS = ["spec", "deliverable", "check", "report"] as const;

const client = createPublicClient({ transport: http(RPC) });

function storeAddress(): Address | null {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8")).textStore ?? null;
  } catch {
    return null;
  }
}

async function readText(store: Address, hash: Hex) {
  const block = (await client.readContract({ address: store, abi: textStoreAbi, functionName: "blockOf", args: [hash] })) as bigint;
  if (block === 0n) return null;
  const logs = await client.getContractEvents({ address: store, abi: textStoreAbi, eventName: "Published", args: { hash }, fromBlock: block, toBlock: block });
  const a = (logs[0] as any)?.args;
  if (!a) return null;
  return { hash, kind: KINDS[Number(a.kind)], text: a.text as string, block: Number(block) };
}

const storeApi: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith("/api/store")) return next();
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  const send = (code: number, body: unknown) => {
    res.statusCode = code;
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") return send(204, {});
  const store = storeAddress();
  if (!store) return send(503, { error: "local demo not deployed" });
  const hash = req.url.split("?")[0].replace(/^\/api\/store\/?/, "").toLowerCase() as Hex;

  if (req.method === "GET") {
    if (!/^0x[0-9a-f]{64}$/.test(hash)) return send(400, { error: "GET /api/store/{keccak256 hash}" });
    readText(store, hash)
      .then((e) => (e ? send(200, e) : send(404, { error: "not found" })))
      .catch((e) => send(502, { error: String(e?.shortMessage ?? e) }));
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 30_000) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { kind, text } = JSON.parse(raw);
        const k = KINDS.indexOf(kind);
        if (k < 0 || typeof text !== "string" || !text.trim()) return send(400, { error: "kind must be spec, deliverable, check or report, text non-empty" });
        const accounts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
        const wallet = createWalletClient({ account: accounts[15], transport: http(RPC) });
        const h = keccak256(toBytes(text));
        const tx = await wallet.writeContract({ address: store, abi: textStoreAbi, functionName: "publish", args: [k, text], chain: null });
        await client.waitForTransactionReceipt({ hash: tx });
        send(200, { hash: h });
      } catch (e: any) {
        send(400, { error: String(e?.shortMessage ?? e?.message ?? e) });
      }
    });
    return;
  }
  send(405, { error: "method not allowed" });
};

function arenaStore(): Plugin {
  return {
    name: "arena-store",
    configureServer(server) {
      server.middlewares.use(storeApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(storeApi);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), arenaStore()],
  server: { port: 5303, strictPort: true },
  preview: { port: 5303, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
