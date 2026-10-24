import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { Address, Hex } from "viem";
import { type Bounty, type Check, type Entry, type Phase, type VerifierReport } from "@shared";
import { Loading, Wrap } from "../components/Shell";
import { Reveal } from "../components/motion";
import { Arrow, Eyebrow, KindGlyph, Maker, PhaseTag, ProvenBadge, Timeline, TxButton } from "../components/ui";
import { onPaid, useArena, useArenaData, useBalances, useNow, useText, livePhase } from "../lib/arena";
import { CATEGORY_LABEL, MODE_HELP, MODE_LABEL, PHASE_LABEL, dateTime, duration, roman, shortHash, toUnits, usdc } from "../lib/format";
import { Offline } from "./Hall";
import { readSealed, useActions } from "../lib/actions";

const no = (id: number) => String(id + 1).padStart(3, "0");

export default function CommissionPage() {
  const { id } = useParams();
  const { data } = useArenaData();
  const { depError } = useArena();
  const b = data?.bounties.find((x) => x.id === Number(id));
  if (!data)
    return depError ? (
      <Wrap className="pb-32 pt-32 sm:pt-40">
        <Offline />
      </Wrap>
    ) : (
      <Loading label="Opening the commission" />
    );
  if (!b)
    return (
      <div className="grid min-h-[80vh] place-content-center gap-6 px-5 text-center">
        <div className="label text-bone-3">Not found</div>
        <p className="display text-[clamp(2.6rem,6vw,5rem)] leading-[0.95]">No commission by that number</p>
        <Link to="/forum" className="btn btn-ghost group mx-auto">
          Back to the commissions <Arrow />
        </Link>
      </div>
    );
  return <CommissionView b={b} />;
}

function CommissionView({ b }: { b: Bounty }) {
  const now = useNow();
  const phase = livePhase(b, now);
  const { account } = useArena();
  const { data } = useArenaData();
  const [picked, setPicked] = useState<number[]>([]);
  const [justPaid, setJustPaid] = useState(false);
  useEffect(() => {
    setPicked([]);
  }, [b.id, phase]);
  useEffect(
    () =>
      onPaid(({ bounty }) => {
        if (bounty.id !== b.id) return;
        setJustPaid(true);
        setTimeout(() => setJustPaid(false), 2000);
      }),
    [b.id],
  );

  const isPoster = !!account && account.toLowerCase() === b.poster.toLowerCase();
  const isArbiter = !!account && account.toLowerCase() === b.arbiter.toLowerCase();
  const maxPick = b.mode === "top-3-split" ? 3 : 1;
  const pickMode: "award" | "rule" | null =
    isPoster && !b.verified && b.status === "open" && ((b.mode === "first-valid" && now < b.reviewEnd) || phase === "review") ? "award" : isArbiter && phase === "disputed" ? "rule" : null;
  const toggle = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : maxPick === 1 ? [i] : p.length < maxPick ? [...p, i] : p));

  const recentlyPaid = b.status === "paid" && now - b.settledAt < 600;

  return (
    <Wrap className="pb-32 pt-32 sm:pt-40">
      <article>
        <nav className="flex items-center gap-2 text-[13.5px] text-bone-3">
          <Link to="/forum" className="link-line hover:text-bone">
            Commissions
          </Link>
          <span className="text-bone-4">/</span>
          <span className="num text-bone-2">{no(b.id)}</span>
        </nav>

        <header className="mt-10 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-16">
          <div className="min-w-0">
            <Reveal y={12}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Eyebrow n={no(b.id)}>Commission</Eyebrow>
                <PhaseTag phase={phase} label={PHASE_LABEL[phase]} />
                {b.verified && <ProvenBadge />}
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="display mt-7 max-w-[22ch] break-words text-[clamp(2.6rem,5.5vw,5.5rem)] leading-[0.98] tracking-[-0.032em] text-bone">{b.title}</h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 text-[15px] text-bone-3">
                Commissioned by <Maker address={b.poster} className="text-bone-2" /> <span className="mx-2 text-bone-4">/</span> {dateTime(b.createdAt)}
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.15} className="lg:text-right">
            <div className={`display text-[clamp(4rem,9vw,8rem)] leading-[0.85] tracking-[-0.038em] ${b.verified ? "text-lapis" : "text-bone"}`}>{usdc(b.reward)}</div>
            <div className="label mt-4 text-bone-3">USDC, escrowed</div>
          </Reveal>
        </header>

        <dl className="mt-14 grid grid-cols-2 gap-px border-y border-bone/[0.08] bg-bone/[0.08] sm:grid-cols-3 lg:grid-cols-6">
          <Fact k="Craft" v={CATEGORY_LABEL[b.category]} />
          <Fact k="Judged by" v={MODE_LABEL[b.mode]} />
          <Fact
            k={now < b.deadline ? "Closes in" : "Closed"}
            v={now < b.deadline ? duration(b.deadline - now) : dateTime(b.deadline)}
            tone={now < b.deadline && b.deadline - now < 6 * 3600 ? "text-ember-2" : ""}
          />
          <Fact k="Entries" v={`${b.entries.length} of 50`} />
          {b.verified ? <Fact k="Entry stake" v={`${usdc(b.entryStake)} USDC`} /> : <Fact k="Review ends" v={dateTime(b.reviewEnd)} />}
          <Fact k="Protocol fee" v={`${b.feeBps / 100}%`} />
        </dl>

        <div className="card mt-8 p-6 sm:p-8">
          <Timeline steps={stepsFor(b, now)} current={stepIndex(b, phase)} />
          <p className="mt-6 max-w-[70ch] text-[14px] leading-relaxed text-bone-3 copy">{MODE_HELP[b.mode]}</p>
        </div>

        {b.verified && b.status === "paid" && b.autoPaidIn != null && <AutoPaid b={b} flash={justPaid || recentlyPaid} />}

        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] xl:gap-24">
          <div className="min-w-0">
            <section>
              <Eyebrow n="01">The brief</Eyebrow>
              <Spec hash={b.specHash} />
            </section>

            {b.verified && b.checkHash && (
              <section className="mt-20">
                <Eyebrow n="02">The tests</Eyebrow>
                <Inscription hash={b.checkHash} />
              </section>
            )}

            <section className="mt-20">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Eyebrow n={b.verified && b.checkHash ? "03" : "02"}>The entries</Eyebrow>
                {pickMode && (
                  <span className="text-[14px] text-lapis">
                    {pickMode === "rule" ? "As arbiter, choose the winners or refund the patron" : maxPick === 3 ? "Choose up to three, best first" : "Choose the masterpiece"}
                  </span>
                )}
              </div>
              {b.entries.length === 0 ? (
                <p className="display mt-8 text-[1.9rem] leading-tight text-bone-3">No maker has entered yet. The first entry could be yours.</p>
              ) : (
                <ol className="mt-8 grid gap-4">
                  {b.entries.map((e) => (
                    <EntryCard
                      key={e.index}
                      b={b}
                      e={e}
                      phase={phase}
                      pickable={!!pickMode && !(pickMode === "award" && e.rejected)}
                      pickRank={picked.indexOf(e.index) + 1}
                      onPick={() => toggle(e.index)}
                      flash={justPaid && e.rank === 1}
                    />
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start">
            <Actions b={b} phase={phase} picked={picked} pickMode={pickMode} clearPicked={() => setPicked([])} featuredPrice={data?.config.featuredPricePerDay ?? 10_000_000n} />
          </aside>
        </div>
      </article>
    </Wrap>
  );
}

function Fact({ k, v, tone = "" }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 bg-ink py-5 pr-4 pl-4 first:pl-0 sm:pl-5">
      <dt className="label text-bone-3">{k}</dt>
      <dd className={`mt-2 truncate text-[16px] text-bone ${tone}`}>{v}</dd>
    </div>
  );
}

function stepsFor(b: Bounty, now: number) {
  if (b.verified)
    return [
      { label: "Inscribed", sub: dateTime(b.createdAt) },
      { label: "Entries", sub: now < b.deadline ? `${duration(b.deadline - now)} left` : "closed" },
      { label: "Tested", sub: `${b.entries.filter((e) => e.check !== "pending").length} of ${b.entries.length}` },
      { label: b.status === "refunded" ? "Returned" : "Paid", sub: b.settledAt ? dateTime(b.settledAt) : undefined },
    ];
  return [
    { label: "Posted", sub: dateTime(b.createdAt) },
    { label: "Entries", sub: now < b.deadline ? `${duration(b.deadline - now)} left` : "closed" },
    { label: "Judgement", sub: `by ${dateTime(b.reviewEnd)}` },
    { label: "Disputes", sub: b.awardedAt ? `until ${dateTime(b.awardedAt + b.disputeWindow)}` : `${Math.round(b.disputeWindow / 3600)}h window` },
    { label: b.status === "ghost-paid" ? "Shared" : b.status === "refunded" ? "Returned" : "Paid", sub: b.settledAt ? dateTime(b.settledAt) : undefined },
  ];
}

function stepIndex(b: Bounty, phase: Phase) {
  if (b.verified) {
    if (phase === "paid" || phase === "refunded") return 4;
    if (phase === "open") return b.entries.length ? 2 : 1;
    return 2;
  }
  switch (phase) {
    case "open":
      return 1;
    case "review":
    case "timeout":
      return 2;
    case "awarded":
    case "finalizable":
    case "disputed":
      return 3;
    default:
      return 5;
  }
}

/** The moment a Proven commission paid itself. */
function AutoPaid({ b, flash }: { b: Bounty; flash: boolean }) {
  const w = b.winners[0];
  return (
    <div className={`card mt-6 grid gap-4 border-lapis/30 bg-lapis/[0.06] p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10 sm:p-8 ${flash ? "paid-sweep" : ""}`}>
      <div className="display text-[clamp(2.6rem,5vw,4.2rem)] leading-none tracking-[-0.032em] text-lapis">
        Paid in {b.autoPaidIn}s
      </div>
      <p className="max-w-[60ch] text-[15.5px] leading-relaxed text-bone-2 copy">
        The tests passed and the contract paid {w && <Maker address={w.hunter} className="text-bone" />} {w && `${usdc(w.payout)} USDC`} in the same transaction. No judge, no
        waiting.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ texts

/** Plain spec text with a little markdown: headings, lists, code. */
function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: string[] = [];
  let code: string[] | null = null;
  const inline = (s: string) =>
    s.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>));
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(
          <pre key={blocks.length} className="codeblock scroll-thin my-4 rounded-2xl border border-bone/[0.08] bg-ink-2">
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const h = line.match(/^#{1,3}\s+(.*)/);
    if (h) {
      flush();
      blocks.push(<h3 key={blocks.length}>{inline(h[1])}</h3>);
    } else if (/^\s*[-*]\s+/.test(line)) list.push(line.replace(/^\s*[-*]\s+/, ""));
    else if (!line.trim()) flush();
    else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="prose-spec">{blocks}</div>;
}

function Spec({ hash }: { hash: Hex }) {
  const { data: text, isLoading } = useText(hash);
  // the first heading usually repeats the title, so drop it
  const body = text?.replace(/^#\s+[^\n]*\n+/, "");
  return (
    <div className="mt-6 max-w-[68ch]">
      {isLoading ? (
        <p className="label shimmer">Reading the brief</p>
      ) : body ? (
        <Prose text={body} />
      ) : (
        <p className="text-bone-3">The brief text is not in the store. Its hash is {shortHash(hash)}.</p>
      )}
      <p className="label mt-8 text-bone-4" title={hash}>
        Brief hash {shortHash(hash)} / checked against the chain
      </p>
    </div>
  );
}

const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? "undefined" : s.length > 48 ? s.slice(0, 46) + "…" : s;
};

/** The Proven tests, written by the patron before the first entry. */
function Inscription({ hash }: { hash: Hex }) {
  const { data: text, isLoading } = useText(hash);
  const check = useMemo(() => {
    try {
      return text ? (JSON.parse(text) as Check) : null;
    } catch {
      return null;
    }
  }, [text]);
  return (
    <div className="card relative mt-6 overflow-hidden p-6 sm:p-9">
      <img src="/img/vitruvian-ink.png" alt="" aria-hidden className="pointer-events-none absolute -right-16 -top-10 w-[360px] opacity-[0.06]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-[clamp(1.9rem,3vw,2.6rem)] leading-none">What the work must pass</h2>
          <ProvenBadge />
        </div>
        <p className="mt-3 max-w-[56ch] text-[14.5px] leading-relaxed text-bone-3 copy">Written by the patron before the first entry. The first maker to pass them all is paid.</p>
        {isLoading && <p className="label shimmer mt-8">Reading the tests</p>}
        {!isLoading && !check && <p className="mt-8 text-bone-3">The tests are not in the store. Their hash is {shortHash(hash)}.</p>}
        {check?.type === "js" && (
          <>
            <p className="num mt-8 text-[13px] text-bone-3">
              export <span className="text-bone">{check.export}</span>
              {check.timeoutMs ? <span> / {check.timeoutMs} ms per test</span> : null}
            </p>
            <ol className="mt-4 border-t border-bone/[0.08]">
              {check.cases.map((c, i) => (
                <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1.5 border-b border-bone/[0.08] py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-x-5">
                  <span className="num pt-0.5 text-[12px] text-bone-4">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[15px] leading-snug text-bone">{c.name}</span>
                  <code className="col-start-2 break-all font-mono text-[12.5px] leading-relaxed text-bone-3 sm:col-start-3 sm:text-right">
                    {check.export}({c.args.map(show).join(", ")}) <span className="text-bone-4">→</span> <span className="text-bone">{show(c.expect)}</span>
                  </code>
                </li>
              ))}
            </ol>
          </>
        )}
        {check?.type === "json" && (
          <>
            <p className="mt-8 text-bone-2">A JSON answer that matches this schema and contains these values.</p>
            <pre className="codeblock scroll-thin mt-4 max-h-80 rounded-2xl border border-bone/[0.08] bg-ink-2" data-lenis-prevent>
              {JSON.stringify(check.expect ?? check.schema, null, 2)}
            </pre>
          </>
        )}
        <p className="label mt-8 text-bone-4" title={hash}>
          Tests hash {shortHash(hash)}
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ entries

function EntryCard({ b, e, phase, pickable, pickRank, onPick, flash }: { b: Bounty; e: Entry; phase: Phase; pickable: boolean; pickRank: number; onPick: () => void; flash: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: text, isLoading: textLoading } = useText(e.deliverableHash);
  const { data: reportText } = useText(e.reportHash);
  const report = useMemo(() => {
    try {
      return reportText ? (JSON.parse(reportText) as VerifierReport) : null;
    } catch {
      return null;
    }
  }, [reportText]);
  const { account } = useArena();
  const act = useActions();
  const isPoster = !!account && account.toLowerCase() === b.poster.toLowerCase();
  const winner = e.rank > 0 && (b.status === "paid" || b.status === "awarded" || b.status === "disputed");
  const failed = e.check === "failed" || e.rejected;
  const [tip, setTip] = useState("5");

  return (
    <li
      className={`card relative overflow-hidden transition-[border-color,box-shadow] duration-500 ${winner && e.rank === 1 ? "border-bone/40 shadow-[0_30px_60px_-30px_rgba(237,230,216,0.25)]" : ""} ${
        failed ? "opacity-70" : ""
      } ${flash ? "paid-sweep" : ""} ${pickRank ? "border-lapis/70 shadow-[0_0_0_1px_var(--color-lapis)]" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-[2px] ${e.isAgent ? "bg-lapis" : "bg-ember"}`} aria-hidden />
      <div className="grid gap-4 p-5 pl-6 sm:grid-cols-[1fr_auto] sm:items-start sm:p-6 sm:pl-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="num text-[12px] text-bone-4">Entry {String(e.index + 1).padStart(2, "0")}</span>
            <Maker address={e.hunter} className="text-[17px] text-bone" />
            <span className={`label ${e.isAgent ? "text-lapis" : "text-ember-2"}`}>{e.isAgent ? "Agent" : "Human"}</span>
            <span className="text-[13px] text-bone-3">{dateTime(e.submittedAt)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {winner && <RankMark rank={e.rank} />}
            {e.rejected && <Mark tone="fail">Rejected by the patron</Mark>}
            {!textLoading && text === null && <Mark tone="seal">Sealed</Mark>}
            {e.check === "passed" && <Mark tone="pass">Passed</Mark>}
            {e.check === "failed" && <Mark tone="fail">Failed</Mark>}
            {e.check === "pending" && (
              <Mark tone="wait">
                <span className="shimmer">Testing</span>
              </Mark>
            )}
            {e.payout > 0n && <span className="display ml-1 text-[1.5rem] leading-none text-bone">+{usdc(e.payout)} USDC</span>}
            {b.verified && e.check === "passed" && e.rank === 1 && e.judgedAt > 0 && (
              <span className="label text-lapis">paid {Math.max(0, e.judgedAt - e.submittedAt)}s after entry</span>
            )}
          </div>
          {report && <Verdict report={report} />}
        </div>
        {pickable && (
          <button type="button" onClick={onPick} className={`btn btn-sm ${pickRank ? "btn-lapis" : "btn-ghost"} justify-self-start`}>
            {pickRank ? (b.mode === "top-3-split" ? `Place ${roman(pickRank)}` : "Chosen") : "Choose"}
          </button>
        )}
      </div>
      <div className="border-t border-bone/[0.07] px-5 py-3 pl-6 sm:px-6 sm:pl-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" className="group inline-flex items-center gap-2 text-[14px] text-bone-2 transition-colors hover:text-bone" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide the work" : "See the work"}
            <svg viewBox="0 0 12 12" className={`size-3 transition-transform duration-500 ${open ? "rotate-180" : ""}`} aria-hidden>
              <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {isPoster && b.mode === "first-valid" && phase !== "paid" && b.status === "open" && !e.rejected && (
            <TxButton className="btn-sm btn-quiet" onRun={() => act.reject(b, e.index)} done="Rejected">
              Reject
            </TxButton>
          )}
          {account && account.toLowerCase() !== e.hunter.toLowerCase() && (
            <span className="ml-auto flex items-center gap-2">
              <input
                value={tip}
                onChange={(x) => setTip(x.target.value.replace(/[^\d.]/g, ""))}
                className="field num h-[38px] w-20 rounded-full px-4 py-0 text-[13px]"
                aria-label="Tip in USDC"
              />
              <TxButton className="btn-sm btn-quiet" done="Tipped" disabled={toUnits(tip) <= 0n} onRun={() => act.tip(b, e.index, toUnits(tip))}>
                Tip
              </TxButton>
            </span>
          )}
        </div>
        {open && (
          <pre className="codeblock scroll-thin mt-4 max-h-96 whitespace-pre-wrap break-words rounded-2xl border border-bone/[0.08] bg-ink-2" data-lenis-prevent>
            {text ?? "Sealed. The maker has not unveiled this work yet. Its fingerprint is on the chain, so whatever they unveil must match it."}
          </pre>
        )}
      </div>
    </li>
  );
}

function Mark({ tone, children }: { tone: "pass" | "fail" | "wait" | "seal"; children: ReactNode }) {
  const c =
    tone === "pass" ? "text-pass bg-pass/10" : tone === "fail" ? "text-ember-2 bg-ember/10" : tone === "seal" ? "text-bone-2 bg-bone/[0.07]" : "text-bone-2 bg-bone/[0.05]";
  return <span className={`label inline-flex h-6 items-center rounded-full px-2.5 ${c}`}>{children}</span>;
}

function RankMark({ rank }: { rank: number }) {
  return (
    <span className={`label inline-flex h-6 items-center rounded-full px-2.5 ${rank === 1 ? "bg-bone text-ink" : "bg-bone/10 text-bone"}`}>
      {rank === 1 ? "Masterpiece" : `Place ${roman(rank)}`}
    </span>
  );
}

/** Each test as a dot: pale green for a pass, ember for a fail. */
function Verdict({ report }: { report: VerifierReport }) {
  const [open, setOpen] = useState(false);
  const passed = report.results.filter((r) => r.ok).length;
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-wrap items-center gap-3 text-left" aria-expanded={open}>
        <span className="flex flex-wrap gap-[4px]" aria-hidden>
          {report.results.map((r, i) => (
            <span key={i} title={r.name} className={`inline-block size-[7px] rounded-full ${r.ok ? "bg-pass" : "bg-ember"}`} />
          ))}
        </span>
        <span className="num text-[12.5px] text-bone-3">
          {report.results.length ? `${passed} of ${report.results.length} tests` : report.summary} / {report.runMs} ms
        </span>
      </button>
      {open && (
        <ul className="mt-3 grid gap-1.5 text-[13.5px]">
          {report.results.map((r, i) => (
            <li key={i} className="grid grid-cols-[1rem_1fr] gap-2">
              <span className={`num ${r.ok ? "text-pass" : "text-ember-2"}`}>{r.ok ? "+" : "x"}</span>
              <span className="text-bone-2">
                {r.name}
                {!r.ok && (r.got || r.error) && <span className="num text-bone-4"> / got {r.error ?? r.got}</span>}
              </span>
            </li>
          ))}
          {report.error && <li className="num text-ember-2">{report.error}</li>}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ actions

function Actions({
  b,
  phase,
  picked,
  pickMode,
  clearPicked,
  featuredPrice,
}: {
  b: Bounty;
  phase: Phase;
  picked: number[];
  pickMode: "award" | "rule" | null;
  clearPicked: () => void;
  featuredPrice: bigint;
}) {
  const { account } = useArena();
  const act = useActions();
  const { data } = useArenaData();
  const now = useNow();
  const me = account ? data?.byAddress.get(account.toLowerCase()) : undefined;
  const isPoster = !!account && account.toLowerCase() === b.poster.toLowerCase();
  const isArbiter = !!account && account.toLowerCase() === b.arbiter.toLowerCase();
  const mine = account ? b.entries.find((e) => e.hunter.toLowerCase() === account.toLowerCase()) : undefined;
  const bond = data?.config.disputeBond ?? 5_000_000n;
  const blocks: ReactNode[] = [];

  if (!account)
    blocks.push(
      <Box key="who" title="Take part">
        <p>Connect a wallet in the top corner. On the local demo you can act as any patron, maker or the arbiter.</p>
      </Box>,
    );

  if (pickMode === "award")
    blocks.push(
      <Box key="award" title="Choose the masterpiece" tone="cyan">
        <p>{b.mode === "top-3-split" ? "Pick up to three entries, best first. They share the fee 50, 30 and 20." : b.mode === "first-valid" ? "Award the earliest entry you have not rejected." : "Pick one entry. It takes the whole fee."}</p>
        <p className="label text-bone-3">{picked.length ? `Chosen: ${picked.map((i) => `entry ${i + 1}`).join(", ")}` : "Nothing chosen yet"}</p>
        <TxButton className="btn-lapis" disabled={!picked.length} onRun={() => act.award(b, picked).then(clearPicked)} done="Awarded">
          Award
        </TxButton>
      </Box>,
    );

  if (pickMode === "rule")
    blocks.push(
      <Box key="rule" title="Rule on the dispute" tone="cyan">
        <p>Choose the rightful winners from the entries, or return the fee to the patron. You cannot send it anywhere else.</p>
        <div className="flex flex-wrap gap-2">
          <TxButton className="btn-lapis" disabled={!picked.length} onRun={() => act.rule(b, picked).then(clearPicked)} done="Ruled">
            Pay the chosen
          </TxButton>
          <TxButton className="btn-ghost" onRun={() => act.rule(b, [])} done="Returned">
            Return to patron
          </TxButton>
        </div>
      </Box>,
    );

  if (phase === "open" && account && !isPoster && !mine) blocks.push(<EnterBox key="enter" b={b} registered={!!me?.registered} />);

  if (mine) blocks.push(<UnveilBox key="unveil" b={b} entry={mine} />);
  if (mine)
    blocks.push(
      <Box key="mine" title="Your entry">
        <p>
          You entered as entry {mine.index + 1}
          {b.verified ? (mine.check === "pending" ? ". The verifier is running the tests." : mine.check === "passed" ? " and passed the tests." : " and did not pass the tests.") : "."}
        </p>
      </Box>,
    );

  if (b.verified && phase !== "paid" && phase !== "refunded" && mine && mine.check === "failed" && b.status === "open")
    blocks.push(
      <Box key="vdispute" title="Think the tests were wrong?">
        <p>Dispute the result to the arbiter with a {usdc(bond)} USDC bond. You get it back if you are proven right.</p>
        <TxButton className="btn-ghost" onRun={() => act.dispute(b, bond)} done="Disputed">
          Dispute the result
        </TxButton>
      </Box>,
    );

  if (b.verified && phase === "review")
    blocks.push(
      <Box key="vreview" title="Finishing the tests">
        <p>Entries are closed. The verifier has until {dateTime(b.reviewEnd)} to finish. If nobody passes, the patron is refunded and every stake goes home.</p>
      </Box>,
    );

  if (!b.verified && phase === "review" && !isPoster)
    blocks.push(
      <Box key="review" title="In judgement">
        <p>The patron has until {dateTime(b.reviewEnd)} to choose. If they miss it, the fee is shared evenly among every entry they did not reject.</p>
      </Box>,
    );

  if (phase === "open" && b.mode === "first-valid" && isPoster && !pickMode)
    blocks.push(
      <Box key="fv" title="First valid">
        <p>Reject entries that miss the brief, then award the earliest one left.</p>
      </Box>,
    );

  if (phase === "timeout" || (b.status === "open" && b.entries.length === 0 && now >= b.deadline)) {
    if (b.entries.length === 0 && isPoster)
      blocks.push(
        <Box key="reclaim" title="Nobody entered">
          <p>Take the full fee back. There is no protocol fee on a refund.</p>
          <TxButton className="btn-ember" onRun={() => act.reclaim(b)} done="Returned">
            Reclaim {usdc(b.reward)} USDC
          </TxButton>
        </Box>,
      );
    if (phase === "timeout")
      blocks.push(
        <Box key="timeout" title={b.verified ? "Nobody passed" : "The patron missed the review"}>
          <p>{b.verified ? "Anyone can settle it now. The patron is refunded and the stakes go home." : "Anyone can settle it now. The fee is shared evenly among the entries that were not rejected."}</p>
          <TxButton className="btn-ember" onRun={() => act.settleTimeout(b)} done="Settled">
            Settle now
          </TxButton>
        </Box>,
      );
  }

  if (phase === "awarded") {
    const left = b.awardedAt + b.disputeWindow - now;
    blocks.push(
      <Box key="awarded" title="Awarded, dispute window open">
        <p>The payout is released in {duration(left)} unless an entrant disputes the award.</p>
        {mine && (
          <TxButton className="btn-ghost" onRun={() => act.dispute(b, bond)} done="Disputed">
            Dispute with a {usdc(bond)} USDC bond
          </TxButton>
        )}
      </Box>,
    );
  }

  if (phase === "finalizable")
    blocks.push(
      <Box key="final" title="Ready to pay" tone="cyan">
        <p>The dispute window has closed. Anyone can release the payout to the winners.</p>
        <TxButton className="btn-lapis" onRun={() => act.finalize(b)} done="Released">
          Release the payout
        </TxButton>
      </Box>,
    );

  if (phase === "disputed" && !isArbiter) {
    const stale = now >= b.disputedAt + 14 * 86400;
    blocks.push(
      <Box key="disputed" title="Disputed">
        <p>
          {b.disputer && <Maker address={b.disputer as Address} className="text-bone" />} challenged the outcome. The commission is frozen until the arbiter rules
          {stale ? ". The arbiter has been silent for 14 days, so anyone can settle it on the original outcome." : `, or for ${duration(b.disputedAt + 14 * 86400 - now)} at most.`}
        </p>
        {stale && (
          <TxButton className="btn-ember" onRun={() => act.settleStale(b)} done="Settled">
            Settle on the original outcome
          </TxButton>
        )}
      </Box>,
    );
  }

  if (phase === "paid" || phase === "ghost-paid" || phase === "refunded")
    blocks.push(
      <Box key="settled" title={phase === "paid" ? "Paid" : phase === "ghost-paid" ? "Shared among the makers" : "Returned to the patron"}>
        <p>
          {phase === "paid"
            ? "The winners were credited. They withdraw from the wallet menu whenever they like."
            : phase === "ghost-paid"
              ? "The patron did not choose in time, so the fee was split evenly across the entries."
              : "Nobody won this commission, so the patron took the fee back with no protocol fee."}
        </p>
      </Box>,
    );

  if (phase === "open" && account) blocks.push(<FeatureBox key="feature" b={b} price={featuredPrice} />);

  return <div className="grid gap-4">{blocks}</div>;
}

function Box({ title, tone, children }: { title: string; tone?: "cyan"; children: ReactNode }) {
  return (
    <section className={`card grid gap-4 p-6 text-[14.5px] leading-relaxed text-bone-2 sm:p-7 ${tone === "cyan" ? "border-lapis/40 bg-lapis/[0.04]" : ""}`}>
      <h3 className={`display text-[1.6rem] leading-[1.1] tracking-[-0.015em] ${tone === "cyan" ? "text-lapis" : "text-bone"}`}>{title}</h3>
      {children}
    </section>
  );
}

function EnterBox({ b, registered }: { b: Bounty; registered: boolean }) {
  const { account } = useArena();
  const act = useActions();
  const { data: bal } = useBalances(account);
  const [handle, setHandle] = useState("");
  const [agent, setAgent] = useState(false);
  const [work, setWork] = useState("");
  if (!registered)
    return (
      <Box title="Become a maker">
        <p>Choose a public name and say whether you are a person or an agent. That choice locks after your first entry, so the Contest stays honest.</p>
        <input className="field" placeholder="Your handle" maxLength={32} value={handle} onChange={(e) => setHandle(e.target.value)} />
        <div className="grid grid-cols-2 gap-1 rounded-full bg-bone/5 p-1">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              type="button"
              onClick={() => setAgent(a)}
              aria-pressed={agent === a}
              className={`flex h-9 items-center justify-center gap-2 rounded-full text-[13.5px] transition-colors ${agent === a ? "bg-bone text-ink" : "text-bone-2 hover:text-bone"}`}
            >
              <KindGlyph agent={a} /> {a ? "Agent" : "Human"}
            </button>
          ))}
        </div>
        <TxButton className="btn-ember" disabled={!handle.trim()} onRun={() => act.register(handle.trim(), agent)} done="Registered">
          Register
        </TxButton>
      </Box>
    );
  return (
    <Box title="Enter this commission" tone={b.verified ? "cyan" : undefined}>
      <SealSteps current={0} />
      <p>
        Like a sealed bid. First you seal your entry: only a fingerprint of the work goes onchain, so nobody can copy it. Then you unveil the work and anyone can check it
        matches the seal.
        {b.verified && b.entryStake > 0n ? ` Sealing puts down a ${usdc(b.entryStake)} USDC stake, returned unless the tests fail.` : ""}
      </p>
      <textarea
        className="field min-h-40 font-mono text-[13px] leading-relaxed"
        placeholder={b.verified ? "export function ..." : "Your deliverable, or a link to it"}
        value={work}
        onChange={(e) => setWork(e.target.value)}
        data-lenis-prevent
      />
      {bal && b.entryStake > bal.wallet && <p className="text-[13px] text-ember-2">You need {usdc(b.entryStake)} USDC for the stake.</p>}
      <TxButton className={b.verified ? "btn-lapis" : "btn-ember"} disabled={!work.trim()} done="Sealed" onRun={() => act.seal(b, work)}>
        Seal your entry
      </TxButton>
    </Box>
  );
}

/** The two steps of a sealed entry: two numbered circles joined by a hairline. */
function SealSteps({ current }: { current: 0 | 1 | 2 }) {
  const labels = ["Seal your entry", "Unveil the work"];
  return (
    <ol className="flex items-center gap-3">
      {labels.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && <li aria-hidden className={`h-px min-w-4 flex-1 ${current > 0 ? "bg-bone-2" : "bg-bone/15"}`} />}
          <li className={`flex items-center gap-2.5 text-[13px] ${i < current ? "text-bone-2" : i === current ? "text-bone" : "text-bone-4"}`}>
            <span
              className={`num grid size-6 shrink-0 place-items-center rounded-full text-[11px] ${
                i < current ? "bg-bone-2 text-ink" : i === current ? "bg-bone text-ink" : "border border-bone/20"
              }`}
            >
              {i + 1}
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/** Your sealed entry, waiting to be unveiled. */
function UnveilBox({ b, entry }: { b: Bounty; entry: Entry }) {
  const { network, account } = useArena();
  const act = useActions();
  const now = useNow();
  const [work, setWork] = useState(() => readSealed(network, b.id, account) ?? "");
  if (entry.revealed) return null;
  const left = entry.revealBy - now;
  if (left <= 0)
    return (
      <Box title="The unveiling window closed">
        <p>A sealed entry must be unveiled within ten minutes. This one was not, so it cannot win.</p>
      </Box>
    );
  return (
    <Box title="Your entry is sealed" tone="cyan">
      <SealSteps current={1} />
      <p>
        Entry {entry.index + 1} is sealed onchain. Now unveil the work so the {b.verified ? "verifier can run the tests" : "patron can judge it"}. It must be exactly the text you
        sealed, within the next <span className="text-bone">{duration(left)}</span>.
      </p>
      <textarea className="field min-h-32 font-mono text-[13px] leading-relaxed" value={work} onChange={(e) => setWork(e.target.value)} aria-label="The sealed work" data-lenis-prevent />
      <TxButton className="btn-lapis" disabled={!work.trim()} done="Unveiled" onRun={() => act.unveil(b, entry, work)}>
        Unveil the work
      </TxButton>
    </Box>
  );
}

function FeatureBox({ b, price }: { b: Bounty; price: bigint }) {
  const act = useActions();
  const [days, setDays] = useState(1);
  const cost = price * BigInt(days);
  return (
    <Box title="Feature it">
      <p>Pin this commission to the top of the list. The fee goes to the protocol.</p>
      <div className="flex flex-wrap items-center gap-3">
        <select className="field h-[46px] w-auto rounded-full py-0 pl-5 text-[14px]" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days">
          {[1, 3, 7, 14].map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
        <TxButton className="btn-ghost" onRun={() => act.feature(b, days, cost)} done="Featured">
          Feature for {usdc(cost)} USDC
        </TxButton>
      </div>
    </Box>
  );
}
