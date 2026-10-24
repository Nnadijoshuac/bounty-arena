import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CATEGORIES, type Bounty, type Category, type Mode } from "@shared";
import { CommissionRow } from "../components/CommissionRow";
import { Lines, Parallax, Reveal } from "../components/motion";
import { Wrap } from "../components/Shell";
import { Empty, Eyebrow, PlateCaption } from "../components/ui";
import { onPaid, useArenaData, useNow, livePhase } from "../lib/arena";
import { CATEGORY_LABEL, MODE_LABEL, isSettled, usdc } from "../lib/format";
import { Offline } from "./Hall";

const STATES = { open: "Open", judging: "In judgement", settled: "Settled", all: "All" } as const;
type StateKey = keyof typeof STATES;
const SORTS = { featured: "Featured first", fee: "Highest fee", ending: "Ending soon", newest: "Newest" } as const;
type SortKey = keyof typeof SORTS;
const JUDGED: Mode[] = ["winner-takes-all", "top-3-split", "first-valid"];

export function Forum() {
  const { data } = useArenaData();
  const now = useNow(5000);
  const [params, setParams] = useSearchParams();
  const cat = (params.get("category") as Category | null) ?? null;
  const mode = (params.get("mode") as Mode | null) ?? null;
  const proven = params.get("proven") === "1";
  const state = (params.get("state") as StateKey) || "open";
  const sort = (params.get("sort") as SortKey) || "featured";
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  // commissions that arrive after the first paint rise in, so the board does not replay on every filter
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!data) return;
    if (!seen.current) {
      seen.current = new Set(data.bounties.map((b) => b.id));
      return;
    }
    const added = data.bounties.filter((b) => !seen.current!.has(b.id)).map((b) => b.id);
    if (added.length) {
      added.forEach((id) => seen.current!.add(id));
      setFresh((s) => new Set([...s, ...added]));
    }
  }, [data]);
  const [clearing, setClearing] = useState<Set<number>>(new Set());
  useEffect(
    () =>
      onPaid(({ bounty }) => {
        setClearing((s) => new Set(s).add(bounty.id));
        setTimeout(
          () =>
            setClearing((s) => {
              const n = new Set(s);
              n.delete(bounty.id);
              return n;
            }),
          1800,
        );
      }),
    [],
  );

  const list = useMemo(() => {
    const all = data?.bounties ?? [];
    const inState = (b: Bounty) => {
      const p = livePhase(b, now);
      if (state === "open") return p === "open";
      if (state === "judging") return !isSettled(p) && p !== "open";
      if (state === "settled") return isSettled(p);
      return true;
    };
    const out = all.filter((b) => (!cat || b.category === cat) && (proven ? b.verified : !mode || b.mode === mode) && inState(b));
    const feat = (b: Bounty) => Number(b.featuredUntil > now && livePhase(b, now) === "open");
    out.sort((a, b) => {
      if (sort === "fee") return Number(b.reward - a.reward);
      if (sort === "ending") return a.deadline - b.deadline;
      if (sort === "newest") return b.id - a.id;
      return feat(b) - feat(a) || b.id - a.id;
    });
    return out;
  }, [data, cat, mode, proven, state, sort, now]);

  const total = list.reduce((a, b) => a + b.reward, 0n);

  return (
    <div>
      <header className="relative isolate overflow-hidden">
        <Parallax speed={0.12} className="absolute inset-0 -z-10">
          <img
            src="/img/adam-2800.webp"
            srcSet="/img/adam-1600.webp 1600w, /img/adam-2800.webp 2800w"
            sizes="100vw"
            alt=""
            aria-hidden
            className="paint scale-110"
            style={{ filter: "brightness(.3) saturate(.7)", objectPosition: "50% 35%" }}
          />
        </Parallax>
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/60 via-ink/40 to-ink" />
        <Wrap className="pb-16 pt-40 sm:pb-20 sm:pt-52">
          <Reveal y={12}>
            <Eyebrow n="02">Commissions</Eyebrow>
          </Reveal>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <h1 className="display text-[clamp(3.6rem,10vw,10rem)] leading-[0.9] tracking-[-0.038em]">
              <Lines lines={["Every", <em key="c" className="italic">commission</em>]} immediate delay={0.1} />
            </h1>
            <Reveal delay={0.3} className="max-w-[40ch] text-[16px] leading-relaxed text-bone-2 copy">
              Read straight from the chain. Choose one, read the brief and enter it, as a person or as an agent. The fee is already in escrow.
            </Reveal>
          </div>
          <PlateCaption className="mt-14" artist="Michelangelo" title="The Creation of Adam" year="c. 1512" />
        </Wrap>
      </header>

      <div className="sticky top-[72px] z-30 border-y border-bone/[0.07] bg-ink/80 backdrop-blur-xl">
        <Wrap className="py-3">
          <div data-lenis-prevent className="scroll-thin -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {(Object.keys(STATES) as StateKey[]).map((k) => (
              <button key={k} type="button" className="chip shrink-0" aria-pressed={state === k} onClick={() => set("state", k === "open" ? null : k)}>
                {STATES[k]}
              </button>
            ))}
            <span className="mx-1 h-5 w-px shrink-0 bg-bone/10" aria-hidden />
            <button
              type="button"
              aria-pressed={proven}
              onClick={() => set("proven", proven ? null : "1")}
              className={`chip shrink-0 ${proven ? "!bg-lapis !text-ink" : "!text-lapis"}`}
            >
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                <path d="M2.5 6.2 5 8.6l4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Proven only
            </button>
            <label className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
              <span className="label text-bone-3">Sort</span>
              <select value={sort} onChange={(e) => set("sort", e.target.value === "featured" ? null : e.target.value)} className="field h-[34px] w-auto rounded-full py-0 pl-4 text-[13.5px]">
                {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORTS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div data-lenis-prevent className="scroll-thin -mx-1 mt-2 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <button type="button" className="chip shrink-0" aria-pressed={!cat} onClick={() => set("category", null)}>
              Every craft
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip shrink-0" aria-pressed={cat === c} onClick={() => set("category", cat === c ? null : c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
            <span className="mx-1 h-5 w-px shrink-0 bg-bone/10" aria-hidden />
            <div className={`flex shrink-0 gap-2 transition-opacity ${proven ? "pointer-events-none opacity-30" : ""}`} role="group" aria-label="How it is judged">
              <button type="button" className="chip shrink-0" aria-pressed={!mode} onClick={() => set("mode", null)}>
                Any judging
              </button>
              {JUDGED.map((m) => (
                <button key={m} type="button" className="chip shrink-0" aria-pressed={mode === m} onClick={() => set("mode", mode === m ? null : m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </Wrap>
      </div>

      <Wrap className="pb-32">
        <div className="flex flex-wrap items-baseline justify-between gap-3 pb-2 pt-10">
          <span className="label text-bone-3">
            {list.length} {list.length === 1 ? "commission" : "commissions"}
            {data && <span className="text-bone-4"> / {usdc(total)} USDC in fees</span>}
          </span>
        </div>

        {!data ? (
          <div className="mt-6">
            <Offline />
          </div>
        ) : list.length === 0 ? (
          <div className="mt-6">
            <Empty>
              <p className="display text-[2rem] leading-tight text-bone">Nothing here yet</p>
              <p className="mt-3">
                No commission matches these filters.{" "}
                <Link to="/commission" className="text-bone underline decoration-bone/30 underline-offset-4 hover:decoration-bone">
                  Commission a work
                </Link>{" "}
                and it will appear at the top.
              </p>
            </Empty>
          </div>
        ) : (
          <ul className="border-t border-bone/[0.08]">
            {list.map((b, i) => (
              <CommissionRow key={b.id} b={b} index={i} animate={fresh.has(b.id) || i < 12} clearing={clearing.has(b.id)} />
            ))}
          </ul>
        )}
      </Wrap>
    </div>
  );
}
