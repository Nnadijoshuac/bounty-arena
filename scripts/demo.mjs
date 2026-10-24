// One command local demo: Hardhat node, deploy, seed, verifier, web app on http://localhost:5303
//   node scripts/demo.mjs          the demo
//   node scripts/demo.mjs --live   the demo, then the example agent starts competing after 20 seconds
// Ctrl+C stops everything it started.
import { spawn, execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = join(root, "contracts");
const web = join(root, "web");
const verifier = join(root, "verifier");
const agentSdk = join(root, "agent-sdk");
const LIVE = process.argv.includes("--live");
const AGENT_DELAY_MS = Number(process.env.AGENT_DELAY_MS ?? 20_000);
const RPC = "http://127.0.0.1:8555";
const isWin = process.platform === "win32";
const children = [];

function log(msg) {
  console.log(`\x1b[33m[arena]\x1b[0m ${msg}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

function start(cmd, args, cwd, name) {
  const child = spawn([cmd, ...args].join(" "), { cwd, shell: true, detached: !isWin, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => {
    const text = d.toString();
    // The Hardhat node is chatty. Only pass through the web server output.
    if (name !== "node") process.stdout.write(text);
  });
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}

// Async on purpose: a blocking spawnSync would stop us draining the node's output pipe and stall it.
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn([cmd, ...args].join(" "), { cwd, shell: true, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed`))));
  });
}

async function waitForRpc(timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Hardhat node did not start");
}

function stopAll() {
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    try {
      if (isWin) execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
}

process.on("SIGINT", () => {
  log("stopping");
  stopAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

async function main() {
  for (const dir of [contracts, web, verifier, agentSdk]) {
    if (!existsSync(join(dir, "node_modules"))) {
      log(`installing dependencies in ${dir}`);
      await run("npm", ["install", "--no-audit", "--no-fund"], dir);
    }
  }
  if (!(await portFree(8555))) throw new Error("Port 8555 is busy. Stop the other node first.");
  if (!(await portFree(5303))) throw new Error("Port 5303 is busy. Stop the other web server first.");

  log("starting Hardhat node on :8555");
  start("npx", ["hardhat", "node", "--port", "8555"], contracts, "node");
  await waitForRpc();

  // fresh chain, fresh off-chain store
  rmSync(join(root, ".data"), { recursive: true, force: true });

  log("deploying");
  await run("npx", ["hardhat", "run", "scripts/deploy.ts", "--network", "localhost"], contracts);
  log("seeding bounties, hunters and agents");
  await run("npx", ["hardhat", "run", "scripts/seed.ts", "--network", "localhost"], contracts);

  log("starting the verifier (Hardhat account #14)");
  start("npx", ["tsx", "src/index.ts", "--network", "local"], verifier, "verifier");

  log("starting the web app on http://localhost:5303");
  const webProc = start("npx", ["vite", "--port", "5303", "--strictPort"], web, "web");
  if (LIVE) {
    log(`live mode: the example agent starts competing in ${AGENT_DELAY_MS / 1000} seconds. Open http://localhost:5303 and say "watch".`);
    setTimeout(() => {
      log("agent relay-agent is entering");
      const agent = start("npx", ["tsx", "agent.example.ts", "--once"], agentSdk, "agent");
      agent.on("exit", () => log("agent pass finished. The demo keeps running, Ctrl+C to stop."));
    }, AGENT_DELAY_MS);
  }
  webProc.on("exit", (code) => {
    log(`web server exited (${code})`);
    stopAll();
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e.message || e);
  stopAll();
  process.exit(1);
});
