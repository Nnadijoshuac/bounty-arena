import { ethers } from "hardhat";
import { deployArena } from "./lib";

/**
 * Arc MAINNET deploy. Real USDC, irreversible. Run it yourself:
 *   npm --prefix contracts run deploy:mainnet
 *
 * Reads ../.env.mainnet (gitignored, copy .env.mainnet.example), which the owner fills in:
 *   MAINNET_DEPLOYER_KEY  a wallet you control, holding a little USDC on Arc mainnet for gas
 *   TREASURY              where protocol fees go
 *   ARBITER               who rules on disputes
 *   VERIFIER              the address the verifier service signs with (MAINNET_VERIFIER_KEY's address)
 *   CONFIRM_MAINNET       must read exactly: I understand this uses real USDC
 * Refuses every chain except Arc mainnet (5042), and every role must be set explicitly.
 */
const ARC_MAINNET = 5042n;
// USDC's ERC-20 interface on Arc mainnet, per docs.arc.io/arc/references/contract-addresses
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const PHRASE = "I understand this uses real USDC";

async function main() {
  const env = (await import("dotenv")).config({ path: require("path").join(__dirname, "../../.env.mainnet"), processEnv: {} }).parsed ?? {};
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== ARC_MAINNET) throw new Error(`Refusing to deploy: chain ${chainId} is not Arc mainnet (5042).`);
  if (env.CONFIRM_MAINNET !== PHRASE) throw new Error(`Set CONFIRM_MAINNET="${PHRASE}" in .env.mainnet to deploy to mainnet.`);

  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("Set MAINNET_DEPLOYER_KEY in .env.mainnet.");
  const deployer = signers[0];

  const role = (name: string) => {
    const v = env[name];
    if (!v || !ethers.isAddress(v)) throw new Error(`Set ${name} to an address in .env.mainnet. Mainnet needs every role set on purpose.`);
    return v;
  };
  const treasury = role("TREASURY");
  const arbiter = role("ARBITER");
  const verifier = role("VERIFIER");

  const code = await ethers.provider.getCode(ARC_USDC);
  if (code === "0x") throw new Error("USDC has no code at the expected address on this chain. Stopping.");
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error(`Deployer ${deployer.address} holds no USDC on Arc mainnet for gas.`);

  console.log("Deploying Arena to Arc MAINNET");
  console.log(`  deployer   ${deployer.address} (${ethers.formatUnits(balance, 18)} USDC for gas)`);
  console.log(`  treasury   ${treasury}`);
  console.log(`  arbiter    ${arbiter}`);
  console.log(`  verifier   ${verifier}`);

  const dep = await deployArena({ key: "arcMainnet", usdc: ARC_USDC, treasury, arbiter, verifier });
  console.log("Deployed to Arc mainnet");
  console.log(`  arena      ${dep.arena}`);
  console.log(`  text store ${dep.textStore}`);
  console.log(`  explorer   https://explorer.arc.io/address/${dep.arena}`);
  console.log("Written to web/public/deployments/arcMainnet.json and web/public/arena.json");
  console.log("Next: npm run arc:mainnet:verifier, then rebuild the app so it ships arcMainnet.json.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
