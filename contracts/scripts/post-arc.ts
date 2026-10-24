import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Posts one real Proven commission on Arc TESTNET, as the deployer (the patron):
 * the isValidIban brief and its 12 tests from fixtures/, 5 USDC fee, 0.5 USDC entry stake, open 2 days.
 *   npx hardhat run scripts/post-arc.ts --network arcTestnet
 * Refuses every chain except Arc testnet (5042002).
 */
const ARC_TESTNET = 5042002n;
const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const fixture = (f: string) => readFileSync(path.join(__dirname, "../../fixtures", f), "utf8");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== ARC_TESTNET) throw new Error(`Refusing: chain ${chainId} is not Arc testnet.`);
  const dep = JSON.parse(readFileSync(path.join(__dirname, "../../web/public/deployments/arcTestnet.json"), "utf8"));
  const [patron] = await ethers.getSigners();
  const arena = await ethers.getContractAt("BountyArena", dep.arena, patron);
  const store = await ethers.getContractAt("ArenaTextStore", dep.textStore, patron);
  const usdc = await ethers.getContractAt("MockUSDC", dep.usdc, patron);

  const title = "Write isValidIban(str) that passes these 12 tests";
  const spec = `# ${title}\n\n${fixture("iban.spec.md")}`;
  const check = fixture("iban.check.json");
  const put = async (kind: number, text: string) => {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(text));
    if ((await store.blockOf(hash)) === 0n) await (await store.publish(kind, text)).wait();
    return hash;
  };
  const specHash = await put(0, spec);
  const checkHash = await put(2, check);

  const reward = USDC(5);
  await (await usdc.approve(dep.arena, reward)).wait();
  const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 2 * 86400;
  const price = await arena.featuredPricePerDay();
  const tx = await arena.createVerifiedBounty(title, specHash, checkHash, 0, reward, deadline, 0, price, USDC(0.5), 0);
  const receipt = await tx.wait();
  const id = (await arena.bountyCount()) - 1n;
  console.log(`Posted Proven commission #${id} for 5 USDC`);
  console.log(`  tx https://explorer.testnet.arc.io/tx/${receipt!.hash}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
