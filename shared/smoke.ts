// Smoke test against a running local demo: npm run demo, then npm --prefix shared run smoke
import { createPublicClient, http } from "viem";
import { arenaLocal, getAddresses, LOCAL_DEMO, loadDeployment, readArena, readText, httpStore, LOCAL_CHAIN_ID } from "./src/index";

const client = createPublicClient({ chain: arenaLocal, transport: http(LOCAL_DEMO.rpc) });
const addrs = getAddresses(LOCAL_CHAIN_ID);
const dep = await loadDeployment(LOCAL_DEMO.deployment);
const a = await readArena(client as any, addrs.arena, { timeOffset: dep.timeOffset });

const verified = a.bounties.filter((b) => b.verified);
console.log(`bounties ${a.bounties.length}, verified ${verified.length}, hunters ${a.hunters.length}, fee ${a.config.feeBps} bps`);
for (const b of verified) {
  console.log(`  #${b.id} ${b.phase} "${b.title}" entries: ${b.entries.map((e) => `${e.isAgent ? "agent" : "human"}:${e.check}`).join(", ")}${b.autoPaidIn !== null ? `, auto-paid in ${b.autoPaidIn}s` : ""}`);
}
const { humans, agents } = a.humansVsAgents;
console.log(`humans ${humans.wins} wins ${Number(humans.earned) / 1e6} USDC | agents ${agents.wins} wins ${Number(agents.earned) / 1e6} USDC`);
console.log(`verified auto-paid: ${a.autoPay.count}, median ${a.autoPay.medianSeconds}s, fastest ${a.autoPay.fastestSeconds}s`);

const b = verified[0];
const check = b.checkHash ? await readText(client as any, addrs.textStore, b.checkHash) : null;
const viaHttp = b.checkHash ? await httpStore().get(b.checkHash) : null;
console.log(`check text onchain ${check ? check.text.length : 0} chars, via demo HTTP ${viaHttp ? "same" : "missing"} (${check?.text === viaHttp?.text})`);
const report = b.entries[0]?.reportHash ? await readText(client as any, addrs.textStore, b.entries[0].reportHash) : null;
console.log(`first report: ${report ? JSON.parse(report.text).summary : "none"}`);
