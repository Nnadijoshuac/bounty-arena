import { ethers } from "hardhat";
import { deployArena } from "./lib";

/**
 * Arc TESTNET deploy. Reads ../.env.arc (made by scripts/new-test-wallet.mjs) or contracts/.env:
 *   DEPLOYER_KEY  throwaway testnet key, funded with testnet USDC from https://faucet.circle.com
 *   VERIFIER      address the verifier service signs with (required)
 *   TREASURY      fee destination (defaults to the deployer)
 *   ARBITER       dispute arbiter (defaults to the deployer)
 * Refuses every chain except Arc testnet (5042002).
 */
const ARC_TESTNET = 5042002n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== ARC_TESTNET) throw new Error(`Refusing to deploy: chain ${chainId} is not Arc testnet (5042002).`);
  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("Set DEPLOYER_KEY in .env.arc (run node scripts/new-test-wallet.mjs).");
  const deployer = signers[0];

  const verifier = process.env.VERIFIER;
  if (!verifier || !ethers.isAddress(verifier)) throw new Error("Set VERIFIER to the verifier service's address in .env.arc.");
  const treasury = process.env.TREASURY && ethers.isAddress(process.env.TREASURY) ? process.env.TREASURY : deployer.address;
  const arbiter = process.env.ARBITER && ethers.isAddress(process.env.ARBITER) ? process.env.ARBITER : deployer.address;

  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error(`Deployer ${deployer.address} has no testnet USDC for gas. Fund it at https://faucet.circle.com`);

  const dep = await deployArena({ key: "arcTestnet", usdc: ARC_USDC, treasury, arbiter, verifier });
  console.log("Deployed to Arc testnet");
  console.log(`  arena      ${dep.arena}`);
  console.log(`  text store ${dep.textStore}`);
  console.log(`  usdc       ${ARC_USDC}`);
  console.log(`  treasury   ${treasury}`);
  console.log(`  arbiter    ${arbiter}`);
  console.log(`  verifier   ${verifier}`);
  console.log(`  explorer   https://explorer.testnet.arc.io/address/${dep.arena}`);
  console.log("Written to web/public/deployments/arcTestnet.json and web/public/arena.json");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
