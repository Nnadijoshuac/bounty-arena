import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { useArenaData } from "../lib/arena";
import { shortAddr } from "../lib/format";
import { Lines, Reveal } from "./motion";

/** The small mark above a heading: an index and a name, like a gallery room number. */
export function Eyebrow({ n, children, className = "" }: { n?: string | number; children: ReactNode; className?: string }) {
  return (
    <div className={`label flex items-center gap-3 text-bone-3 ${className}`}>
      {n != null && <span className="text-bone-2">{typeof n === "number" ? String(n).padStart(2, "0") : n}</span>}
      {n != null && <span className="h-px w-8 bg-bone-4" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

/** A section heading in the display face, rising in line by line. */
export function SectionHead({
  n,
  label,
  lines,
  children,
  className = "",
  aside,
}: {
  n?: number;
  label: string;
  lines: ReactNode[];
  children?: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <header className={`grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end ${className}`}>
      <div>
        <Reveal y={12}>
          <Eyebrow n={n}>{label}</Eyebrow>
        </Reveal>
        <h2 className="display mt-6 text-[clamp(2.6rem,5.6vw,5.6rem)] text-bone">
          <Lines lines={lines} />
        </h2>
        {children && (
          <Reveal delay={0.15} className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-bone-2 copy">
            {children}
          </Reveal>
        )}
      </div>
      {aside && <Reveal delay={0.2}>{aside}</Reveal>}
    </header>
  );
}

/** Human or agent: an ember dot for a person, a lapis ring for a machine. */
export function KindGlyph({ agent, className = "" }: { agent: boolean; className?: string }) {
  return agent ? (
    <span aria-label="agent" title="Agent" className={`inline-block size-[7px] shrink-0 rounded-full border-[1.5px] border-lapis ${className}`} />
  ) : (
    <span aria-label="human" title="Human" className={`inline-block size-[7px] shrink-0 rounded-full bg-ember ${className}`} />
  );
}

/** A maker or patron by handle, linked to their page. */
export function Maker({ address, showKind = true, link = true, className = "" }: { address: Address; showKind?: boolean; link?: boolean; className?: string }) {
  const { data } = useArenaData();
  const h = data?.byAddress.get(address.toLowerCase());
  const name = h?.handle || shortAddr(address);
  const inner = (
    <>
      {showKind && h?.registered && <KindGlyph agent={h.isAgent} />}
      <span>{name}</span>
    </>
  );
  if (!link) return <span className={`inline-flex items-center gap-2 ${className}`}>{inner}</span>;
  return (
    <Link to={`/maker/${address}`} className={`inline-flex items-center gap-2 transition-colors hover:text-bone ${className}`}>
      {inner}
    </Link>
  );
}

export function ProvenBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Proven: the patron's tests decide, and the first entry that passes is paid on the spot"
      className={`label inline-flex h-6 items-center gap-1.5 rounded-full bg-lapis/12 px-2.5 text-lapis ${className}`}
    >
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        <path d="M2.5 6.2 5 8.6l4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Proven
    </span>
  );
}

const PHASE_TONE: Record<string, string> = {
  open: "text-bone",
  review: "text-bone-2",
  timeout: "text-ember",
  awarded: "text-bone-2",
  finalizable: "text-pass",
  disputed: "text-ember",
  paid: "text-bone-3",
  "ghost-paid": "text-bone-3",
  refunded: "text-bone-4",
};

export function PhaseTag({ phase, label }: { phase: string; label: string }) {
  return (
    <span className={`label inline-flex items-center gap-2 ${PHASE_TONE[phase] ?? ""}`}>
      <span className={`relative inline-block size-1.5 rounded-full bg-current ${phase === "open" ? "pulse-dot text-pass" : ""}`} />
      <span className={phase === "open" ? "text-bone" : ""}>{label}</span>
    </span>
  );
}

/** A big number in the display face with a small label under it. */
export function Stat({ value, label, sub, className = "" }: { value: ReactNode; label: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="display text-[clamp(2.4rem,3.6vw,3.6rem)] leading-none text-bone">{value}</div>
      <div className="label mt-3 text-bone-3">{label}</div>
      {sub && <div className="mt-1 text-[13px] text-bone-3">{sub}</div>}
    </div>
  );
}

/** Runs a transaction and reports what happened in plain words. */
export function TxButton({
  onRun,
  children,
  className = "btn-solid",
  disabled,
  done = "Done",
}: {
  onRun: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  done?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className={`btn ${className}`}
        disabled={disabled || state === "busy"}
        onClick={async () => {
          setError(null);
          setState("busy");
          try {
            await onRun();
            setState("done");
            timer.current = window.setTimeout(() => setState("idle"), 2400);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setState("idle");
          }
        }}
      >
        {state === "busy" && <BusyDots />}
        {state === "busy" ? "Waiting for the chain" : state === "done" ? done : children}
      </button>
      {error && <p className="max-w-[44ch] text-[13px] leading-snug text-ember">{error}</p>}
    </div>
  );
}

export function BusyDots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block size-1 rounded-full bg-current" style={{ animation: `pulse-fade 1s ease-in-out ${i * 0.16}s infinite` }} />
      ))}
      <style>{`@keyframes pulse-fade{0%,100%{opacity:.25}50%{opacity:1}}`}</style>
    </span>
  );
}

/** Waiting for the chain: a line of light that crosses a hairline. */
export function Loader({ label = "Reading the chain", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`grid justify-items-center gap-5 ${className}`} role="status" aria-label={label}>
      <div className="relative h-px w-40 overflow-hidden bg-bone/10">
        <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-bone to-transparent" style={{ animation: "loader-run 1.4s cubic-bezier(.65,0,.35,1) infinite" }} />
      </div>
      <span className="label shimmer">{label}</span>
      <style>{`@keyframes loader-run{from{left:-35%}to{left:100%}}`}</style>
    </div>
  );
}

/** The life of a commission: a hairline with a lit segment for where it stands. */
export function Timeline({ steps, current }: { steps: { label: string; sub?: string }[]; current: number }) {
  return (
    <ol className="grid gap-3" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={s.label} className="min-w-0">
            <div className="relative h-px bg-bone/12">
              <span
                className={`absolute inset-y-0 left-0 transition-[width] duration-1000 ${state === "next" ? "w-0" : state === "now" ? "w-1/2 bg-bone" : "w-full bg-bone-2"}`}
                style={{ transitionTimingFunction: "var(--ease-out-soft)" }}
              />
              {state === "now" && <span className="pulse-dot absolute -top-[3px] left-1/2 size-[7px] -translate-x-1/2 rounded-full bg-bone text-bone" />}
            </div>
            <div className={`label mt-3 truncate ${state === "next" ? "text-bone-4" : state === "now" ? "text-bone" : "text-bone-2"}`}>{s.label}</div>
            {s.sub && <div className="mt-1 truncate text-[12.5px] text-bone-3">{s.sub}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** A thin proportional bar. */
export function Bar({ value, max, tone = "bone", align = "left", className = "" }: { value: number; max: number; tone?: "bone" | "ember" | "lapis"; align?: "left" | "right"; className?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  const color = tone === "ember" ? "bg-ember" : tone === "lapis" ? "bg-lapis" : "bg-bone";
  return (
    <div className={`relative h-[3px] overflow-hidden rounded-full bg-bone/8 ${className}`} aria-hidden>
      <span
        className={`absolute inset-y-0 rounded-full ${color} transition-[width] duration-[1400ms] ${align === "right" ? "right-0" : "left-0"}`}
        style={{ width: `${pct}%`, transitionTimingFunction: "var(--ease-out-soft)" }}
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card px-8 py-14 text-center text-bone-2">{children}</div>;
}

/** An arrow that slides on hover of its parent group. */
export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 transition-transform duration-500 group-hover:translate-x-1 ${className}`} style={{ transitionTimingFunction: "var(--ease-out-soft)" }} aria-hidden>
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The museum caption for a painting. */
export function PlateCaption({ artist, title, year, className = "" }: { artist: string; title: string; year: string; className?: string }) {
  return (
    <div className={`label text-bone-3 ${className}`}>
      <span className="text-bone-2">{artist}</span>
      <span className="mx-2 text-bone-4">/</span>
      <span className="normal-case tracking-normal font-display text-[15px] italic text-bone-2">{title}</span>
      <span className="mx-2 text-bone-4">/</span>
      {year}
    </div>
  );
}
