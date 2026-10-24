// Creates throwaway Arc TESTNET wallets for the deployer, the verifier and the demo agent.
// Keys go into .env.arc (gitignored) and are never printed. Only public addresses are shown,
// so you can fund them with testnet USDC at https://faucet.circle.com.
//
//   node scripts/new-test-wallet.mjs           create .env.arc (refuses to overwrite)
//   node scripts/new-test-wallet.mjs --force   replace it (old keys are lost)
//   node scripts/new-test-wallet.mjs --show    print the addresses in an existing .env.arc
//
// Never put real funds or a mainnet key in these wallets.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".env.arc");

// viem is already installed for the SDK. Borrow it rather than adding a root dependency.
let accounts;
for (const pkg of ["agent-sdk", "verifier", "web"]) {
  try {
    accounts = createRequire(join(root, pkg, "package.json"))("viem/accounts");
    break;
  } catch {}
}
if (!accounts) {
  console.error("Run npm run setup first (viem is needed to make keys).");
  process.exit(1);
}
const { generatePrivateKey, privateKeyToAddress } = accounts;

function show(env) {
  const addr = (k) => privateKeyToAddress(env[k]);
  console.log("Arc testnet wallets (keys are in .env.arc, never commit or share it):\n");
  console.log(`  deployer  ${addr("DEPLOYER_KEY")}   fund: gas for two deploys, about 1 USDC is plenty`);
  console.log(`  verifier  ${addr("VERIFIER_KEY")}   fund: gas for posting results, a few USDC`);
  console.log(`  agent     ${addr("AGENT_KEY")}   fund: gas plus entry stakes, about 10 USDC`);
  console.log("\nFund all three with testnet USDC at https://faucet.circle.com (Arc testnet).");
  console.log("Then: npm run arc:deploy, and npm run arc:verifier in a second terminal.");
}

function parse(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

if (process.argv.includes("--show")) {
  if (!existsSync(file)) {
    console.error("No .env.arc yet. Run node scripts/new-test-wallet.mjs");
    process.exit(1);
  }
  show(parse(readFileSync(file, "utf8")));
  process.exit(0);
}

if (existsSync(file) && !process.argv.includes("--force")) {
  console.error(".env.arc already exists. Use --show to see its addresses, or --force to replace it (old keys are lost).");
  process.exit(1);
}

const env = {
  DEPLOYER_KEY: generatePrivateKey(),
  VERIFIER_KEY: generatePrivateKey(),
  AGENT_KEY: generatePrivateKey(),
};
const deployer = privateKeyToAddress(env.DEPLOYER_KEY);
const verifier = privateKeyToAddress(env.VERIFIER_KEY);

const body = [
  "# Throwaway Arc TESTNET wallets made by scripts/new-test-wallet.mjs.",
  "# Never commit this file. Never send real funds to these addresses. Testnet only.",
  `# Created ${new Date().toISOString()}`,
  `DEPLOYER_KEY=${env.DEPLOYER_KEY}`,
  `VERIFIER_KEY=${env.VERIFIER_KEY}`,
  `AGENT_KEY=${env.AGENT_KEY}`,
  "",
  "# Roles the deploy script sets on the arena (public addresses)",
  `TREASURY=${deployer}`,
  `ARBITER=${deployer}`,
  `VERIFIER=${verifier}`,
  "ARC_RPC_URL=https://rpc.testnet.arc.io",
  "",
].join("\n");

writeFileSync(file, body, { mode: 0o600 });
try {
  chmodSync(file, 0o600);
} catch {}
show(env);
