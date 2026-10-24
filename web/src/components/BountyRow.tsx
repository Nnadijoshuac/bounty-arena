import { Link } from "react-router-dom";
import { type Bounty, type Phase, phaseOf } from "../lib/arena";
import { CATEGORIES, MODE_SHORT, duration, usdc } from "../lib/format";
import { PhasePill, TypeDot, Who } from "./ui";

export function timeNote(b: Bounty, phase: Phase, now: number) {
  switch (phase) {
    case "open":
      return `${duration(b.deadline - now)} left`;
    case "review":
      return `review ends in ${duration(b.reviewEnd - now)}`;
    case "timeout":
      return "poster missed review, anyone can settle";
    case "awarded":
      return `pays out in ${duration(b.awardedAt + b.disputeWindow - now)}`;
    case "finalizable":
      return "dispute window closed, ready to release";
    case "disputed":
      return "with the arbiter";
    case "paid":
      return "winners paid";
    case "ghost":
      return "split across submitters";
    case "refunded":
      return "no entries, poster refunded";
  }
}

export function Entrants({ b, max = 10 }: { b: Bounty; max?: number }) {
  const shown = b.subs.slice(0, max);
  const humans = b.subs.filter((s) => !s.isAgent).length;
  const agents = b.subs.length - humans;
  if (b.subs.length === 0) return <span className="text-xs text-faint">No entries yet</span>;
  return (
    <span className="inline-flex items-center gap-2" title={`${humans} human, ${agents} agent`}>
      <span className="inline-flex items-center gap-[3px]">
        {shown.map((s) => (
          <TypeDot key={s.index} agent={s.isAgent} className={`size-[7px] ${s.rejected ? "opacity-30" : ""}`} />
        ))}
      </span>
      <span className="num text-xs text-faint">
        {b.subs.length} {b.subs.length === 1 ? "entry" : "entries"}
      </span>
    </span>
  );
}

export function BountyRow({ b, now }: { b: Bounty; now: number }) {
  const phase = phaseOf(b, now);
  const featured = b.featuredUntil > now && phase === "open";
  const winner = b.subs.find((s) => s.rank === 1);
  return (
    <Link
      to={`/bounty/${b.id}`}
      className={`group relative grid grid-cols-1 gap-x-6 gap-y-3 border-b border-line px-4 py-5 transition-colors hover:bg-raised/60 sm:grid-cols-[150px_1fr_220px] sm:px-5 ${
        featured ? "bg-brass/[0.035]" : ""
      }`}
    >
      {featured && <span className="absolute inset-y-0 left-0 w-[2px] bg-brass" />}
      <div className="flex items-baseline gap-2 sm:block">
        <div className="num text-[26px] font-medium leading-none tracking-tight text-fg">
          {usdc(b.reward, { decimals: 0 })}
        </div>
        <div className="label mt-1.5">USDC · {MODE_SHORT[b.mode]}</div>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {featured && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-brass">Featured</span>}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{CATEGORIES[b.category]}</span>
          <span className="font-mono text-[10px] text-faint">#{b.id}</span>
        </div>
        <h3 className="font-display text-[17px] font-medium leading-snug tracking-tight text-fg transition-colors group-hover:text-brass">
          {b.title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            by <Who address={b.poster} plain />
          </span>
          <Entrants b={b} />
          {winner && (phase === "paid" || phase === "awarded" || phase === "finalizable") && (
            <span>
              won by <Who address={winner.hunter} plain />
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
        <PhasePill phase={phase} />
        <span className="text-right text-xs text-faint">{timeNote(b, phase, now)}</span>
      </div>
    </Link>
  );
}
