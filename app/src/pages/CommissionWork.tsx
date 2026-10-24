import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { arenaAbi, CATEGORIES, MODES, type Category, type Check, type Mode } from "@shared";
import { useActions } from "../lib/actions";
import { Wrap } from "../components/Shell";
import { Lines, Reveal } from "../components/motion";
import { Eyebrow, PlateCaption, ProvenBadge, Timeline, TxButton } from "../components/ui";
import { useArena, useArenaData, useBalances, useNow } from "../lib/arena";
import { CATEGORY_LABEL, MODE_HELP, MODE_LABEL, toUnits, usdc } from "../lib/format";

const DURATIONS = [
  ["1 hour", 3600],
  ["6 hours", 6 * 3600],
  ["1 day", 86400],
  ["3 days", 3 * 86400],
  ["1 week", 7 * 86400],
  ["2 weeks", 14 * 86400],
  ["30 days", 30 * 86400],
] as const;

const TESTS_TEMPLATE = `{
  "type": "js",
  "export": "slugify",
  "timeoutMs": 1000,
  "cases": [
    { "name": "spaces become dashes", "args": ["Hello World"], "expect": "hello-world" },
    { "name": "punctuation is dropped", "args": ["Arc, at last!"], "expect": "arc-at-last" },
    { "name": "no leading or trailing dashes", "args": ["  edges  "], "expect": "edges" }
  ]
}`;

const BRIEF_TEMPLATE = `What you need, in a sentence or two.

What a finished piece looks like
- the first thing it must do
- the second thing
- how you will judge it`;

export default function CommissionWork() {
  const { account, client, dep } = useArena();
  const act = useActions();
  const { data } = useArenaData();
  const { data: bal } = useBalances(account);
  const now = useNow();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("code");
  const [mode, setMode] = useState<Mode>("winner-takes-all");
  const [brief, setBrief] = useState("");
  const [tests, setTests] = useState(TESTS_TEMPLATE);
  const [stake, setStake] = useState("1");
  const [reward, setReward] = useState("250");
  const [dur, setDur] = useState<number>(3 * 86400);
  const [feature, setFeature] = useState(0);
  const [step, setStep] = useState(-1);

  const proven = mode === "verified";
  const parsed = useMemo((): { ok: true; check: Check } | { ok: false; error: string } => {
    try {
      const c = JSON.parse(tests);
      if (c?.type === "js" && typeof c.export === "string" && Array.isArray(c.cases) && c.cases.length) return { ok: true, check: c };
      if (c?.type === "json" && c.schema && typeof c.schema === "object") return { ok: true, check: c };
      return { ok: false, error: "Use a js check with cases, or a json check with a schema." };
    } catch (e) {
      return { ok: false, error: `Not valid JSON yet: ${(e as Error).message}` };
    }
  }, [tests]);

  const rewardUnits = toUnits(reward);
  const price = data?.config.featuredPricePerDay ?? 10_000_000n;
  const total = rewardUnits + price * BigInt(feature);
  const feeBps = data?.config.feeBps ?? 500;
  const problems = [
    !account && "Connect a wallet in the top corner first.",
    !title.trim() && "Give the commission a title.",
    title.length > 120 && "Keep the title under 120 characters.",
    !brief.trim() && "Write the brief.",
    rewardUnits < 1_000_000n && "The fee must be at least 1 USDC.",
    proven && !parsed.ok && parsed.error,
    proven && toUnits(stake) > 100_000_000n && "The entry stake can be at most 100 USDC.",
    bal && total > bal.wallet && `This wallet holds ${usdc(bal.wallet)} USDC. You need ${usdc(total)}.`,
  ].filter(Boolean) as string[];

  const steps = proven
    ? [{ label: "Brief" }, { label: "Tests" }, { label: "Approve" }, { label: "Escrow" }]
    : [{ label: "Brief" }, { label: "Approve" }, { label: "Escrow" }];

  const run = async () => {
    const order = proven ? ["brief", "tests", "escrow"] : ["brief", "escrow"];
    setStep(0);
    try {
      await act.post({
        title: title.trim(),
        brief: brief.trim(),
        category,
        mode,
        reward: rewardUnits,
        deadline: BigInt(now + dur + 120), // a little slack for the time it takes to sign
        featureDays: feature,
        featureCost: price * BigInt(feature),
        featurePrice: price,
        tests: proven && parsed.ok ? JSON.stringify(parsed.check, null, 2) : undefined,
        stake: proven ? toUnits(stake) : undefined,
        onStep: (s) => setStep(order.indexOf(s) + (s === "escrow" ? 1 : 0)),
      });
      const count = (await client.readContract({ address: dep!.arena!, abi: arenaAbi, functionName: "bountyCount" })) as bigint;
      setStep(steps.length);
      navigate(`/c/${Number(count) - 1}`);
    } catch (e) {
      setStep(-1);
      throw e;
    }
  };

  const label = "label mb-3 block text-bone-3";

  return (
    <>
      <section className="relative isolate overflow-hidden">
        {/* Plato and Aristotle, faint, behind the heading */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[52%] md:block">
          <img
            src="/img/athens-plato-1200.webp"
            srcSet="/img/athens-plato-1200.webp 1200w, /img/athens-plato-2000.webp 2000w"
            sizes="52vw"
            alt=""
            className="paint"
            style={{ filter: "brightness(.42) saturate(.7)", objectPosition: "50% 30%" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink to-transparent" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink to-transparent" />
        </div>
        <Wrap className="pb-16 pt-32 sm:pb-24 sm:pt-44">
          <Reveal y={12}>
            <Eyebrow n="New">Commission a work</Eyebrow>
          </Reveal>
          <h1 className="display mt-7 text-[clamp(3.4rem,8.6vw,8.6rem)] leading-[0.92] tracking-[-0.038em]">
            <Lines lines={["Commission", <em key="w" className="italic">a work</em>]} immediate delay={0.15} />
          </h1>
          <Reveal delay={0.3} className="mt-8 max-w-[50ch] text-[17px] leading-relaxed text-bone-2 copy">
            Write the brief, set the fee and choose how the work is judged. The fee is escrowed in USDC the moment you post, so every maker knows it is real.
          </Reveal>
          <PlateCaption className="mt-14 hidden md:block" artist="Raphael" title="Plato and Aristotle" year="1509 to 1511" />
        </Wrap>
      </section>

      <Wrap className="pb-32">
        <div className="hairline" />
        <div className="mt-16 grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] xl:gap-24">
          <form className="grid min-w-0 gap-20" onSubmit={(e) => e.preventDefault()}>
            <Fieldset n="01" title="The work">
              <div className="grid gap-8">
                <div>
                  <label className={label} htmlFor="title">
                    Title
                  </label>
                  <input
                    id="title"
                    className="field display rounded-2xl px-5 py-4 text-[1.7rem] leading-tight tracking-[-0.015em]"
                    maxLength={120}
                    placeholder="Write slugify(title) for our docs site"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div>
                  <span className={label}>Craft</span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className="chip">
                        {CATEGORY_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="brief">
                    The brief
                  </label>
                  <textarea
                    id="brief"
                    className="field min-h-56 px-5 py-4 text-[15.5px] leading-relaxed copy"
                    placeholder={BRIEF_TEMPLATE}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    data-lenis-prevent
                  />
                  <p className="mt-2.5 text-[13px] text-bone-3">Published onchain with the commission. Clear acceptance criteria save everyone a dispute.</p>
                </div>
              </div>
            </Fieldset>

            <Fieldset n="02" title="How it is judged">
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map((m) => {
                  const on = mode === m;
                  const isP = m === "verified";
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMode(m)}
                      className={`card group grid gap-2 p-5 text-left transition-[border-color,background-color] duration-500 ${
                        on ? (isP ? "border-lapis/70 bg-lapis/[0.07]" : "border-bone/60 bg-bone/[0.05]") : "hover:border-bone/25"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className={`display text-[1.6rem] leading-tight ${on ? (isP ? "text-lapis" : "text-bone") : "text-bone-2 group-hover:text-bone"}`}>{MODE_LABEL[m]}</span>
                        {isP ? (
                          <ProvenBadge />
                        ) : (
                          <span className={`size-3 rounded-full border transition-colors ${on ? "border-bone bg-bone" : "border-bone/30"}`} aria-hidden />
                        )}
                      </span>
                      <span className="text-[14px] leading-snug text-bone-3">{MODE_HELP[m]}</span>
                    </button>
                  );
                })}
              </div>
              {proven && (
                <Reveal y={16} className="card mt-6 grid gap-5 border-lapis/25 p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="display text-[1.6rem] leading-none">Write the tests</span>
                    <span className={`label ${parsed.ok ? "text-pass" : "text-ember-2"}`}>
                      {parsed.ok ? (parsed.check.type === "js" ? `${parsed.check.cases.length} tests ready` : "Schema check ready") : "Not ready"}
                    </span>
                  </div>
                  <textarea
                    className="field min-h-72 bg-ink-2 font-mono text-[12.5px] leading-[1.75]"
                    spellCheck={false}
                    value={tests}
                    onChange={(e) => setTests(e.target.value)}
                    aria-label="Tests as JSON"
                    data-lenis-prevent
                  />
                  {!parsed.ok && <p className="text-[13px] text-ember-2">{parsed.error}</p>}
                  <p className="text-[13px] leading-relaxed text-bone-3 copy">
                    A js check calls the named export with each case's arguments and expects exactly the value given. A json check validates an answer against a JSON Schema
                    and the expected values.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 border-t border-bone/[0.08] pt-5">
                    <label className="text-[14px] text-bone-2" htmlFor="stake">
                      Entry stake
                    </label>
                    <input id="stake" className="field num h-[42px] w-24 rounded-full px-4 py-0 text-[14px]" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ""))} />
                    <span className="text-[13px] text-bone-3">USDC, returned unless the entry fails</span>
                  </div>
                </Reveal>
              )}
            </Fieldset>

            <Fieldset n="03" title="Fee and time">
              <div className="grid gap-8 sm:grid-cols-3 sm:gap-5">
                <div>
                  <label className={label} htmlFor="reward">
                    Fee in USDC
                  </label>
                  <input
                    id="reward"
                    className="field display rounded-2xl px-5 py-2 text-[2.8rem] leading-tight tracking-[-0.032em]"
                    inputMode="decimal"
                    value={reward}
                    onChange={(e) => setReward(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="dur">
                    Open for
                  </label>
                  <select id="dur" className="field h-[76px] rounded-2xl px-5 text-[16px]" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                    {DURATIONS.map(([l, s]) => (
                      <option key={s} value={s}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="feat">
                    Feature for
                  </label>
                  <select id="feat" className="field h-[76px] rounded-2xl px-5 text-[16px]" value={feature} onChange={(e) => setFeature(Number(e.target.value))}>
                    {[0, 1, 3, 7, 14].map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? "No feature" : `${d} ${d === 1 ? "day" : "days"}, ${usdc(price * BigInt(d))} USDC`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Fieldset>
          </form>

          <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start">
            <div className={`card grid gap-6 p-6 sm:p-8 ${proven ? "border-lapis/30" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="display text-[1.9rem] leading-none">The contract</h2>
                {proven && <ProvenBadge />}
              </div>
              <dl className="grid gap-3.5">
                <Row k="Fee to the maker" v={`${usdc(rewardUnits)} USDC`} />
                <Row k={`Protocol fee, ${feeBps / 100}% at payout`} v={`${usdc((rewardUnits * BigInt(feeBps)) / 10_000n)} USDC`} dim />
                {feature > 0 && <Row k={`Featured for ${feature} ${feature === 1 ? "day" : "days"}`} v={`${usdc(price * BigInt(feature))} USDC`} />}
              </dl>
              <div className="border-t border-bone/10 pt-5">
                <div className="label text-bone-3">Escrowed now</div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className={`display text-[clamp(3rem,5vw,4.4rem)] leading-none tracking-[-0.032em] ${proven ? "text-lapis" : "text-bone"}`}>{usdc(total)}</span>
                  <span className="label text-bone-3">USDC</span>
                </div>
              </div>
              <p className="text-[14px] leading-relaxed text-bone-3 copy">
                {proven
                  ? "The first entry that passes every test is paid on the spot. If nobody passes by the deadline, you are refunded in full."
                  : "If you do not choose within three days of the deadline, the fee is shared among the entries. If nobody enters, you get it all back."}
              </p>
              {step >= 0 && (
                <div className="py-1">
                  <Timeline steps={steps} current={step} />
                </div>
              )}
              {problems.length > 0 && step < 0 && (
                <ul className="grid gap-2 border-t border-bone/[0.08] pt-5 text-[13.5px] text-bone-3">
                  {problems.map((p) => (
                    <li key={p} className="flex gap-3">
                      <span className="mt-[0.6em] h-px w-3 shrink-0 bg-ember" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              <TxButton className={`${proven ? "btn-lapis" : "btn-ember"} h-[52px] w-full`} disabled={problems.length > 0} onRun={run} done="Posted">
                {proven ? "Publish the tests and escrow" : "Post the commission"}
              </TxButton>
              <p className="text-[12.5px] leading-relaxed text-bone-4 copy">
                {proven ? "Four" : "Three"} signatures: the brief{proven ? ", the tests" : ""}, the USDC approval and the escrow. On the local demo the persona signs for you.
              </p>
            </div>
          </aside>
        </div>
      </Wrap>
    </>
  );
}

function Fieldset({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="contents">
        <Reveal y={14} className="mb-9 flex items-baseline gap-5">
          <span className="num text-[12px] text-bone-4">{n}</span>
          <span className="display text-[clamp(2.2rem,3.6vw,3.2rem)] leading-none tracking-[-0.025em] text-bone">{title}</span>
        </Reveal>
      </legend>
      {children}
    </fieldset>
  );
}

function Row({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={`text-[14px] ${dim ? "text-bone-3" : "text-bone-2"}`}>{k}</dt>
      <dd className={`num whitespace-nowrap text-[14px] ${dim ? "text-bone-3" : "text-bone"}`}>{v}</dd>
    </div>
  );
}
