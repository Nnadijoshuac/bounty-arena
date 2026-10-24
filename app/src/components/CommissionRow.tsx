import { Link } from "react-router-dom";
import { motion } from "motion/react";
import type { Bounty } from "@shared";
import { useNow, livePhase } from "../lib/arena";
import { useReducedMotion } from "../lib/motion";
import { CATEGORY_LABEL, MODE_LABEL, PHASE_LABEL, duration, usdc } from "../lib/format";
import { EASE } from "./motion";
import { Arrow, Maker, PhaseTag, ProvenBadge } from "./ui";

/** One commission, laid out like a line in an auction catalogue. */
export function CommissionRow({ b, index = 0, clearing = false, animate = true }: { b: Bounty; index?: number; clearing?: boolean; animate?: boolean }) {
  const now = useNow();
  const reduced = useReducedMotion();
  const phase = livePhase(b, now);
  const humans = b.entries.filter((e) => !e.isAgent).length;
  const agents = b.entries.length - humans;
  const featured = b.featuredUntil > now && phase === "open";
  const left = b.deadline - now;
  const winner = b.winners[0];
  return (
    <motion.li
      className={clearing ? "paid-sweep" : ""}
      initial={animate && !reduced ? { opacity: 0, y: 24 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -6% 0px" }}
      transition={{ duration: 0.9, ease: EASE, delay: Math.min(index, 8) * 0.05 }}
      layout="position"
    >
      <Link
        to={`/c/${b.id}`}
        className="group relative grid grid-cols-[1fr_auto] gap-x-6 gap-y-4 border-b border-bone/[0.08] py-7 sm:py-8 md:grid-cols-[4.5rem_1fr_9rem_10rem_2rem] md:items-center"
      >
        {/* a line that draws across the row on hover */}
        <span className="absolute bottom-[-1px] left-0 h-px w-full origin-left scale-x-0 bg-bone/50 transition-transform duration-700 group-hover:scale-x-100" style={{ transitionTimingFunction: "var(--ease-out-soft)" }} aria-hidden />

        <span className="num hidden self-start pt-2 text-[12px] text-bone-4 md:block">{String(b.id + 1).padStart(3, "0")}</span>

        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PhaseTag phase={phase} label={PHASE_LABEL[phase]} />
            {b.verified && <ProvenBadge />}
            {featured && <span className="label text-ember-2">Featured</span>}
          </div>
          <h3 className="display mt-3 text-[clamp(1.6rem,2.3vw,2.35rem)] leading-[1.08] tracking-[-0.03em] text-bone transition-transform duration-700 group-hover:translate-x-2" style={{ transitionTimingFunction: "var(--ease-out-soft)" }}>
            {b.title}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-bone-3">
            <span>{CATEGORY_LABEL[b.category]}</span>
            <span className="text-bone-4">/</span>
            <span>{MODE_LABEL[b.mode]}</span>
            <span className="text-bone-4">/</span>
            {phase === "open" ? (
              <span className={left < 3600 * 6 ? "text-ember-2" : ""}>{duration(left)} left</span>
            ) : winner ? (
              <span className="inline-flex items-center gap-1.5">
                won by <Maker address={winner.hunter} link={false} className="text-bone-2" />
              </span>
            ) : (
              <span>closed</span>
            )}
            <span className="hidden text-bone-4 sm:inline">/</span>
            <span className="hidden sm:inline">
              by <Maker address={b.poster} showKind={false} link={false} className="text-bone-2" />
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:block" title={`${humans} human and ${agents} agent entries`}>
          <span className="flex flex-wrap gap-[5px]" aria-hidden>
            {b.entries.slice(0, 10).map((e) =>
              e.isAgent ? (
                <span key={e.index} className={`size-[7px] rounded-full border-[1.5px] border-lapis ${e.check === "failed" || e.rejected ? "opacity-30" : ""}`} />
              ) : (
                <span key={e.index} className={`size-[7px] rounded-full bg-ember ${e.check === "failed" || e.rejected ? "opacity-30" : ""}`} />
              ),
            )}
            {b.entries.length === 0 && <span className="size-[7px] rounded-full border border-bone/25" />}
          </span>
          <span className="label text-bone-3 md:mt-2.5 md:block">
            {b.entries.length} {b.entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="text-right">
          <div className="display text-[clamp(2.1rem,3vw,3rem)] leading-none text-bone">{usdc(b.reward)}</div>
          <div className="label mt-2 text-bone-3">USDC</div>
        </div>

        <span className="hidden justify-self-end text-bone-3 transition-colors group-hover:text-bone md:block">
          <Arrow />
        </span>
      </Link>
    </motion.li>
  );
}
