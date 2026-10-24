import { ethers, network } from "hardhat";
import { deployArena } from "./lib";

/**
 * Local demo deploy. Hardhat dev accounts: #0 owner and treasury, #1 arbiter, #14 verifier.
 * For Arc testnet use scripts/deploy-arc.ts.
 */
async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) throw new Error(`deploy.ts is for the local node only (got chain ${chainId}). Use deploy-arc.ts for Arc testnet.`);
  const signers = await ethers.getSigners();
  const mock = await ethers.deployContract("MockUSDC");
  await mock.waitForDeployment();
  const dep = await deployArena({
    key: "local",
    usdc: await mock.getAddress(),
    treasury: signers[0].address,
    arbiter: signers[1].address,
    verifier: signers[14].address,
  });
  console.log(`BountyArena ${dep.arena} and text store ${dep.textStore} on ${network.name}, USDC ${dep.usdc}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
