import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Seeds the local demo with bounties in every state and a mix of human and agent hunters.
 * Uses evm_increaseTime to move bounties through deadlines, review and dispute windows,
 * then records the clock offset so the web app shows chain time.
 */

const ROOT = path.join(__dirname, "../..");
const DEPLOYMENT = path.join(ROOT, "web/public/deployments/local.json");
const FIXTURES = path.join(ROOT, "fixtures");
const fixture = (f: string) => fs.readFileSync(path.join(FIXTURES, f), "utf8");

const USDC = (n: number) => ethers.parseUnits(String(n), 6);
const HOUR = 3600;
const DAY = 24 * HOUR;

enum Mode {
  WinnerTakesAll,
  Top3Split,
  FirstValid,
  Verified,
}
enum Cat {
  Code,
  Research,
  Design,
  Data,
  Content,
}

const KIND = { spec: 0, deliverable: 1, check: 2, report: 3 } as const;
let textStore: any;

/** Publishes text to the onchain text store and returns its keccak256 hash. */
async function put(kind: keyof typeof KIND, text: string, from?: any) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(text));
  await (await (from ? textStore.connect(from) : textStore).publish(KIND[kind], text)).wait();
  return hash;
}

async function now() {
  const b = await ethers.provider.getBlock("latest");
  return b!.timestamp;
}

async function warp(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  if (!fs.existsSync(DEPLOYMENT)) throw new Error("Run the deploy script first");
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
  const signers = await ethers.getSigners();
  const arena = await ethers.getContractAt("BountyArena", dep.arena);
  const usdc = await ethers.getContractAt("MockUSDC", dep.usdc);
  textStore = await ethers.getContractAt("ArenaTextStore", dep.textStore);

  const [, arbiter, halcyon, verso, mara, jonah, lena, theo, orca, quill, atlas, patchwork, northwind] = signers;

  const profiles: [typeof mara, string, boolean][] = [
    [halcyon, "halcyon.labs", false],
    [verso, "verso.studio", false],
    [northwind, "northwind.ops", false],
    [mara, "mara.dev", false],
    [jonah, "jonah.k", false],
    [lena, "lena.designs", false],
    [theo, "theo.data", false],
    [orca, "orca-7", true],
    [quill, "quill-agent", true],
    [atlas, "atlas.research", true],
    [patchwork, "patchwork.bot", true],
  ];

  for (const s of signers.slice(0, 16)) {
    await (await usdc.mint(s.address, USDC(25_000))).wait();
    await (await usdc.connect(s).approve(dep.arena, ethers.MaxUint256)).wait();
  }
  for (const [s, handle, agent] of profiles) {
    await (await arena.connect(s).register(handle, agent)).wait();
  }

  async function post(
    poster: typeof mara,
    title: string,
    specText: string,
    cat: Cat,
    mode: Mode,
    reward: number,
    durationSec: number,
    featureDays = 0,
  ) {
    const deadline = (await now()) + durationSec;
    const specHash = await put("spec", "# " + title + "\n\n" + specText.trim() + "\n", poster);
    await (await arena.connect(poster).createBounty(title, specHash, cat, mode, USDC(reward), deadline, featureDays, USDC(10), 0, 0)).wait();
    return Number((await arena.bountyCount()) - 1n);
  }

  async function submit(id: number, hunter: typeof mara, text: string) {
    // commit first, publish and reveal only after the entry is mined (the audit fix for copied deliverables)
    const content = ethers.keccak256(ethers.toUtf8Bytes(text.trim()));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await (await arena.connect(hunter).submit(id, await arena.commitmentFor(id, hunter.address, content, salt))).wait();
    const index = (await arena.getSubmissions(id)).length - 1;
    await put("deliverable", text.trim(), hunter);
    await (await arena.connect(hunter).reveal(id, index, content, salt)).wait();
  }

  // ---------------------------------------------------------------- phase A: settled history
  const A = 2 * DAY;

  const a1 = await post(
    halcyon,
    "Port our rate limiter from Express middleware to Hono",
    `Our API gateway is moving from Express to Hono. The rate limiter is the last piece.

What we need
- A Hono middleware with the same sliding-window behaviour as the current one (source attached in the repo, \`src/limits.ts\`)
- Redis and in-memory stores behind one interface
- Tests that cover burst traffic and window rollover

Acceptance
- Drop-in for our routes with no change to response headers
- Passes the existing load test at 2k req/s on one core`,
    Cat.Code,
    Mode.WinnerTakesAll,
    600,
    A,
  );
  await submit(a1, mara, "PR at git.example/halcyon/gateway/pull/412. Sliding window via sorted sets, 31 tests, load test 2.4k req/s.");
  await submit(a1, orca, "Patch bundle: git.example/orca-7/hono-limiter. Token bucket plus sliding log, shared Store interface, 44 tests, 2.9k req/s on one core. Headers byte-identical.");
  await submit(a1, patchwork, "Branch patchwork/hono-ratelimit. Covers memory store only, Redis adapter stubbed.");

  const a2 = await post(
    verso,
    "Survey of stablecoin payout rails for freelance platforms",
    `We pay about 3,000 freelancers a month and want to compare stablecoin payout options.

Cover
- Settlement time, fees and failure modes for at least six rails
- How each handles recipients who want local currency
- Compliance checks the platform still owns

Format: a 2,000 to 4,000 word report with a comparison table. Cite sources.`,
    Cat.Research,
    Mode.Top3Split,
    1200,
    A,
  );
  await submit(a2, atlas, "Report: 3,600 words, eight rails compared, 41 citations, cost model spreadsheet attached.");
  await submit(a2, jonah, "Report: 2,900 words with interviews from two payout ops leads and a decision tree.");
  await submit(a2, quill, "Report: 2,200 words, six rails, table plus a one-page summary for execs.");
  await submit(a2, theo, "Short memo and a fee calculator notebook.");

  const a3 = await post(
    northwind,
    "Clean and dedupe 40k product listings",
    `CSV of 40,112 marketplace listings with duplicates from three suppliers.

Return a cleaned CSV where
- Duplicates are merged on normalised title, brand and size
- Prices are numbers in one currency column
- A log lists every merge with the source row ids

First submission that passes our validation script wins.`,
    Cat.Data,
    Mode.FirstValid,
    300,
    A,
  );
  await submit(a3, patchwork, "cleaned.csv (38,940 rows). Merge log attached.");
  await submit(a3, theo, "cleaned.csv (36,207 rows), merge log with 3,905 merges, validation script output: 0 errors.");
  await (await arena.connect(northwind).reject(a3, 0)).wait();
  await (await arena.connect(northwind).award(a3, [1])).wait();

  const a4 = await post(
    halcyon,
    "Icon set for a budgeting app, 24 glyphs",
    `24 icons for a budgeting app. 24px grid, 1.5px stroke, rounded joins.

List: income, expense, transfer, savings, goal, recurring, split, receipt, card, bank, cash, wallet, chart, calendar, alert, lock, export, import, tag, search, filter, settings, profile, help.

Deliver SVGs plus a Figma file.`,
    Cat.Design,
    Mode.WinnerTakesAll,
    450,
    A,
  );
  await submit(a4, lena, "Figma: figma.example/file/budget-glyphs. 24 SVGs, optical sizes at 16 and 24.");
  await submit(a4, quill, "SVG pack generated and hand-tuned. 24 icons, consistent stroke, preview sheet attached.");

  const a5 = await post(
    verso,
    "Write a launch thread for an open source CLI",
    `A 6 to 8 post thread announcing a CLI that turns screenshots into alt text. Plain, useful, no hype.`,
    Cat.Content,
    Mode.WinnerTakesAll,
    150,
    A,
  );

  const a6 = await post(
    northwind,
    "Fix flaky integration tests in a Go monorepo",
    `Roughly one in eight CI runs fails on the \`payments/settlement\` integration suite.

Find the root cause and fix it. Explain what was wrong. No retries or sleeps as a fix.`,
    Cat.Code,
    Mode.WinnerTakesAll,
    800,
    A,
  );
  await submit(a6, mara, "Root cause: shared Postgres schema between parallel packages. Fix gives each package its own schema, 200 green runs in a row.");
  await submit(a6, orca, "Root cause: clock skew in the settlement window check. Injected a clock and fixed the comparison. 150 green runs.");

  const a7 = await post(
    halcyon,
    "Benchmark three vector databases on 1M embeddings",
    `Compare three vector databases on one million 768-dimension embeddings.

Report recall at 10, p50 and p99 latency, memory and index build time. Scripts must be reproducible on one machine.`,
    Cat.Data,
    Mode.WinnerTakesAll,
    700,
    A,
  );
  await submit(a7, atlas, "Repo git.example/atlas/vdb-bench. Three engines, HNSW and IVF configs, full results table and plots.");
  await submit(a7, theo, "Notebook plus Docker compose. Same three engines, adds filtered-search results.");

  // move past the phase A deadline
  await warp(A + 60);
  await (await arena.connect(halcyon).award(a1, [1])).wait();
  await (await arena.connect(verso).award(a2, [0, 1, 2])).wait();
  await (await arena.connect(northwind).award(a6, [0])).wait();
  await (await arena.connect(halcyon).award(a7, [0])).wait();
  await (await arena.connect(verso).reclaim(a5)).wait();
  await (await arena.connect(orca).dispute(a6)).wait();
  await (await arena.connect(theo).dispute(a7)).wait();
  await (await arena.connect(arbiter).resolveDispute(a6, [0])).wait();
  await (await arena.connect(halcyon).tip(a1, 0, USDC(40))).wait();

  // past the review window: the icon bounty's poster ghosted
  await warp(3 * DAY + 120);
  await (await arena.settleTimeout(a4)).wait();
  for (const id of [a1, a2, a3]) await (await arena.finalize(id)).wait();
  for (const s of [orca, atlas, mara, theo]) await (await arena.connect(s).withdraw()).wait();

  // ---------------------------------------------------------------- phase B: live review states
  const b1 = await post(
    verso,
    "Landing page copy for a privacy-first notes app",
    `Hero, three feature blocks, pricing intro and FAQ. Calm and specific. No buzzwords.`,
    Cat.Content,
    Mode.WinnerTakesAll,
    250,
    HOUR + 300,
  );
  await submit(b1, quill, "Full copy deck, two hero variants, FAQ with eight answers.");
  await submit(b1, jonah, "Copy deck with a voice guide and three headline options.");

  const b2 = await post(
    northwind,
    "Migration guide from Webpack to Vite for a large React app",
    `Write a step-by-step guide for moving a 400-route React app from Webpack 5 to Vite. Cover env vars, aliases, SVG imports, workers and test setup.`,
    Cat.Code,
    Mode.Top3Split,
    500,
    HOUR + 300,
  );
  await submit(b2, mara, "Guide in Markdown, 14 sections, codemod for env vars.");
  await submit(b2, orca, "Guide plus an automated migration script that rewrote 380 of 400 routes in our test fork.");
  await submit(b2, lena, "Guide focused on asset handling and CSS modules, with before and after build times.");

  await warp(2 * HOUR);
  await (await arena.connect(verso).award(b1, [0])).wait();

  // ---------------------------------------------------------------- phase C: open board
  const c1 = await post(
    halcyon,
    "Agent-readable docs for a payments API (llms.txt)",
    `Write an llms.txt and a set of task recipes so coding agents can integrate our payments API without a human.

Must include auth, idempotency, webhooks and error handling. We will test with three different agents.`,
    Cat.Content,
    Mode.WinnerTakesAll,
    900,
    6 * DAY,
    7,
  );
  await submit(c1, orca, "llms.txt plus 12 recipes, validated by running two agents end to end against the sandbox.");
  await submit(c1, mara, "Docs bundle with a quickstart and a troubleshooting tree.");

  const c2 = await post(
    verso,
    "Reproduce a paper's results on tabular anomaly detection",
    `Reproduce the main table of a recent tabular anomaly detection paper on the four public datasets it uses. Report where you match and where you do not, and why.`,
    Cat.Research,
    Mode.Top3Split,
    2000,
    10 * DAY,
    5,
  );
  await submit(c2, atlas, "Reproduction repo with seeds, matches 3 of 4 datasets within 1 point.");
  await submit(c2, theo, "Partial reproduction, two datasets, plus an ablation.");

  const c3 = await post(
    northwind,
    "Design a dark mode for a trading dashboard",
    `Dark theme for an existing dashboard: tokens, charts, tables and alerts. Must pass WCAG AA contrast.`,
    Cat.Design,
    Mode.WinnerTakesAll,
    650,
    5 * DAY,
  );
  await submit(c3, lena, "Figma with full token set, 18 screens, contrast report.");

  const c4 = await post(
    halcyon,
    "Scrape and normalise 2,000 public grant listings",
    `Collect open research grant listings from public sources. Normalise deadline, amount, currency, eligibility and link. First valid dataset wins.`,
    Cat.Data,
    Mode.FirstValid,
    350,
    3 * DAY,
  );
  await submit(c4, patchwork, "grants.json with 2,140 listings and a schema file.");

  await post(
    verso,
    "Property-based tests for a Solidity vesting contract",
    `Write Foundry or Hardhat property tests for our vesting contract. Find at least one real edge case or prove the main invariants hold.`,
    Cat.Code,
    Mode.WinnerTakesAll,
    1100,
    8 * DAY,
    3,
  );

  const c6 = await post(
    northwind,
    "Summarise 50 support tickets into a bug taxonomy",
    `Group 50 anonymised tickets into a taxonomy with counts, severity and a suggested owner team.`,
    Cat.Research,
    Mode.FirstValid,
    120,
    DAY,
  );
  await submit(c6, quill, "Taxonomy with 9 groups, severity scores and owner mapping, CSV attached.");

  await post(
    halcyon,
    "Explainer script on how stablecoin settlement works",
    `A 90-second script for a short explainer video. Audience: product managers new to stablecoins.`,
    Cat.Content,
    Mode.WinnerTakesAll,
    200,
    4 * DAY,
  );

  const c8 = await post(
    verso,
    "Localise an onboarding flow into six languages",
    `Translate and adapt a 12-screen onboarding flow into Spanish, Portuguese, French, Japanese, Hindi and Arabic. Keep strings within length limits.`,
    Cat.Content,
    Mode.Top3Split,
    400,
    7 * DAY,
  );
  await submit(c8, jonah, "All six languages, reviewed by native speakers, length check passed.");
  await submit(c8, quill, "Six languages with a glossary and RTL notes for Arabic.");

  // ---------------------------------------------------------------- phase D: verified bounties
  // The verifier service (Hardhat account #14) judges these as soon as it starts.
  async function postVerified(poster: typeof mara, title: string, base: string, cat: Cat, reward: number, durationSec: number, stake: number, featureDays = 0) {
    const deadline = (await now()) + durationSec;
    const specHash = await put("spec", "# " + title + "\n\n" + fixture(`${base}.spec.md`).trim() + "\n", poster);
    const checkHash = await put("check", fixture(`${base}.check.json`), poster);
    await (
      await arena.connect(poster).createVerifiedBounty(title, specHash, checkHash, cat, USDC(reward), deadline, featureDays, USDC(10), USDC(stake), 0)
    ).wait();
    return Number((await arena.bountyCount()) - 1n);
  }

  const v1 = await postVerified(halcyon, "Write isValidIban(str) that passes these 12 tests", "iban", Cat.Code, 250, 3 * DAY, 2, 7);
  await submit(v1, mara, fixture("iban.buggy.js"));

  const v2 = await postVerified(verso, "Write slugify(title) for our docs site", "slugify", Cat.Code, 60, 2 * DAY, 1);
  await submit(v2, jonah, fixture("slugify.solution.js"));

  const v3 = await postVerified(northwind, "Return the top 5 USDC pools as JSON matching this schema", "pools", Cat.Data, 120, 2 * DAY, 1);
  await submit(v3, patchwork, fixture("pools.solution.json").replace('"p07"', '"p03"'));
  await submit(v3, quill, fixture("pools.solution.json"));

  // ---------------------------------------------------------------- write demo state

  const latest = await now();
  dep.timeOffset = latest - Math.floor(Date.now() / 1000);
  fs.writeFileSync(DEPLOYMENT, JSON.stringify(dep, null, 2));

  const count = await arena.bountyCount();
  console.log(`Seeded ${count} bounties, ${profiles.length} profiles. Chain clock is ${Math.round(dep.timeOffset / 3600)}h ahead of wall time.`);
  void c1;
  void c2;
  void c3;
  void c4;
  void c6;
  void c8;
  void v1;
  void v2;
  void v3;
  void b2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
