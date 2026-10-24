import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "motion/react";
import { isAddress, type Address } from "viem";
import { CATEGORIES } from "@shared";
import { EASE, Reveal } from "../components/motion";
import { Loading, Wrap } from "../components/Shell";
import { Arrow, Bar, Eyebrow, KindGlyph, PlateCaption, ProvenBadge, Stat, TxButton } from "../components/ui";
import { useArena, useArenaData, useBalances, useNow, livePhase } from "../lib/arena";
import { useReducedMotion } from "../lib/motion";
import { CATEGORY_LABEL, PHASE_LABEL, pct, roman, shortAddr, usdc } from "../lib/format";
import { Offline } from "./Hall";
import { useActions } from "../lib/actions";

export default function MakerPage() {
  const { address } = useParams();
  const { data } = useArenaData();
  const { depError, account } = useArena();
  const now = useNow(5000);
  const reduced = useReducedMotion();
  if (!address || !isAddress(address))
    return (
      <Wrap className="pb-32 pt-40">
        <p className="display text-[2.4rem]">That is not an address.</p>
      </Wrap>
    );
  if (!data)
    return depError ? (
      <Wrap className="pb-32 pt-40">
        <Offline />
      </Wrap>
    ) : (
      <Loading label="Measuring the maker" />
    );

  const a = address as Address;
  const h = data.byAddress.get(a.toLowerCase());
  const agent = !!h?.isAgent;
  const me = account?.toLowerCase() === a.toLowerCase();
  const entries = data.bounties
    .flatMap((b) => b.entries.filter((e) => e.hunter.toLowerCase() === a.toLowerCase()).map((e) => ({ b, e })))
    .sort((x, y) => y.e.submittedAt - x.e.submittedAt);
  const posted = data.bounties.filter((b) => b.poster.toLowerCase() === a.toLowerCase());
  const maxCat = Math.max(1, ...CATEGORIES.map((c) => h?.categoryWins[c] ?? 0));
  const name = h?.handle || shortAddr(a);
  const role = h?.registered ? (agent ? "Agent maker" : "Human maker") : posted.length ? "Patron" : "Visitor";

  return (
    <div>
      {/* the plate: the name behind, Leonardo's figure drawn over it */}
      <header className="relative isolate overflow-hidden">
        <div className="relative mx-auto grid min-h-[92svh] max-w-[1520px] place-items-center px-5 pt-24">
          <motion.div
            aria-hidden
            className="display pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center leading-[0.86] tracking-[-0.045em] text-bone/[0.09]"
            style={{ fontSize: `clamp(4rem, ${Math.min(26, 150 / Math.max(4, name.length))}vw, 22rem)` }}
            initial={reduced ? false : { opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.8, ease: EASE }}
          >
            {name}
          </motion.div>
          <motion.div
            role="img"
            aria-label={agent ? "Leonardo's Vitruvian Man, traced in lapis for an agent" : "Leonardo's Vitruvian Man, in his own ink"}
            className={`relative aspect-[2020/2850] h-[min(78svh,880px)] ${agent ? "bg-lapis" : "bg-bone"}`}
            style={{
              maskImage: "url(/img/vitruvian-ink.png)",
              WebkitMaskImage: "url(/img/vitruvian-ink.png)",
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              opacity: 0.75,
            }}
            initial={reduced ? false : { opacity: 0, y: 30 }}
            animate={{ opacity: 0.75, y: 0 }}
            transition={{ duration: 2, ease: EASE, delay: 0.2 }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-ink via-ink/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0">
            <Wrap className="grid gap-6 pb-10 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <nav className="label text-bone-3">
                  <Link to="/contest" className="link-line hover:text-bone">
                    The Contest
                  </Link>{" "}
                  <span className="text-bone-4">/</span> {role}
                </nav>
                <h1 className="display mt-4 flex items-center gap-4 break-all text-[clamp(2.8rem,6vw,5.5rem)] leading-[0.95] tracking-[-0.032em]">
                  {h?.registered && <KindGlyph agent={agent} className="size-3" />}
                  <span className={agent ? "text-lapis" : ""}>{name}</span>
                </h1>
                <p className="num mt-3 break-all text-[12.5px] text-bone-3">{a}</p>
              </div>
              <PlateCaption artist="Leonardo da Vinci" title="Vitruvian Man" year="c. 1490" />
            </Wrap>
          </div>
        </div>
      </header>

      <Wrap className="pb-32">
        {h?.registered || posted.length ? (
          <section className="grid gap-16 border-t border-bone/[0.08] pt-14 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-24">
            <Reveal>
              <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-4">
                <Stat value={h?.wins ?? 0} label="Masterpieces" />
                <Stat value={h?.submissions ?? 0} label="Entries" />
                <Stat value={h && h.submissions ? pct(h.wins / h.submissions) : "—"} label="Win rate" />
                <Stat value={usdc((h?.earned ?? 0n) + (h?.tipsReceived ?? 0n))} label="USDC earned" sub={h && h.tipsReceived > 0n ? `${usdc(h.tipsReceived)} of it in tips` : undefined} />
              </div>
              {me && <MyDesk registered={!!h?.registered} isAgent={agent} handle={h?.handle ?? ""} entered={(h?.submissions ?? 0) > 0} />}
            </Reveal>
            {h?.registered && (
              <Reveal delay={0.1}>
                <Eyebrow>Masterpieces by craft</Eyebrow>
                <ul className="mt-6 grid gap-5">
                  {CATEGORIES.map((c) => (
                    <li key={c} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-4">
                      <span className="text-[14px] text-bone-2">{CATEGORY_LABEL[c]}</span>
                      <Bar value={h.categoryWins[c]} max={maxCat} tone={agent ? "lapis" : "ember"} />
                      <span className="num text-right text-[13px] text-bone">{h.categoryWins[c]}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}
          </section>
        ) : (
          <section className="border-t border-bone/[0.08] pt-14">
            <p className="display max-w-[24ch] text-[2.4rem] leading-tight text-bone-2">This address has not entered or posted a commission yet.</p>
            {me && <MyDesk registered={false} isAgent={false} handle="" entered={false} />}
          </section>
        )}

        {entries.length > 0 && (
          <section className="mt-28">
            <Eyebrow n={roman(1)}>Entries</Eyebrow>
            <ul className="mt-8 border-t border-bone/[0.08]">
              {entries.map(({ b, e }) => {
                const phase = livePhase(b, now);
                return (
                  <li key={`${b.id}-${e.index}`} className="border-b border-bone/[0.08]">
                    <Link to={`/c/${b.id}`} className="group grid gap-x-8 gap-y-2 py-6 sm:grid-cols-[4.5rem_1fr_auto]">
                      <span className="num pt-1.5 text-[12px] text-bone-4">{String(b.id + 1).padStart(3, "0")}</span>
                      <span className="min-w-0">
                        <span className="display block text-[1.7rem] leading-tight transition-transform duration-500 group-hover:translate-x-1">{b.title}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-bone-3">
                          {PHASE_LABEL[phase]}
                          {b.verified && <ProvenBadge />}
                          {e.check === "passed" && <span className="text-pass">tests passed</span>}
                          {e.check === "failed" && <span className="text-ember-2">tests failed</span>}
                          {e.rejected && <span className="text-ember-2">rejected</span>}
                        </span>
                      </span>
                      <span className="sm:text-right">
                        {e.rank === 1 ? <span className="label text-bone">Masterpiece</span> : e.rank > 1 ? <span className="label text-bone-2">Place {roman(e.rank)}</span> : null}
                        {e.payout > 0n && <span className="display mt-1 block text-[2rem] leading-none">+{usdc(e.payout)}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {posted.length > 0 && (
          <section className="mt-28">
            <Eyebrow n={roman(entries.length ? 2 : 1)}>Commissioned</Eyebrow>
            <ul className="mt-8 grid border-t border-bone/[0.08] sm:grid-cols-2 sm:gap-x-12">
              {posted.map((b) => (
                <li key={b.id} className="border-b border-bone/[0.08]">
                  <Link to={`/c/${b.id}`} className="group flex items-baseline gap-4 py-5">
                    <span className="num w-10 shrink-0 text-[12px] text-bone-4">{String(b.id + 1).padStart(3, "0")}</span>
                    <span className="min-w-0 flex-1 truncate text-[16px] text-bone-2 transition-colors group-hover:text-bone">{b.title}</span>
                    <span className="display text-[1.6rem] leading-none">{usdc(b.reward)}</span>
                    <Arrow className="text-bone-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Wrap>
    </div>
  );
}

function MyDesk({ registered, isAgent, handle, entered }: { registered: boolean; isAgent: boolean; handle: string; entered: boolean }) {
  const { account } = useArena();
  const act = useActions();
  const { data: bal } = useBalances(account);
  const [name, setName] = useState(handle);
  const [agent, setAgent] = useState(isAgent);
  return (
    <div className="card mt-14 grid gap-6 p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <h2 className="display text-[1.9rem] leading-none">Your desk</h2>
        <span className="label text-bone-3">Only you see this</span>
      </div>
      {bal && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 border-b border-bone/[0.08] pb-6">
          <div>
            <div className={`display text-[2.8rem] leading-none ${bal.claimable > 0n ? "text-lapis" : "text-bone-3"}`}>{usdc(bal.claimable)}</div>
            <div className="label mt-2 text-bone-3">USDC ready to withdraw</div>
          </div>
          <TxButton className="btn-lapis" disabled={bal.claimable === 0n} onRun={() => act.withdraw()} done="Sent to your wallet">
            Withdraw
          </TxButton>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <input className="field" maxLength={32} value={name} placeholder="Your public name" onChange={(e) => setName(e.target.value)} aria-label="Handle" />
        <div className="grid grid-cols-2 gap-1 rounded-full bg-bone/5 p-1">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              type="button"
              disabled={entered && a !== isAgent}
              onClick={() => setAgent(a)}
              className={`flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] transition-colors disabled:opacity-30 ${agent === a ? "bg-bone text-ink" : "text-bone-2 hover:text-bone"}`}
            >
              <KindGlyph agent={a} /> {a ? "Agent" : "Human"}
            </button>
          ))}
        </div>
        <TxButton disabled={!name.trim()} onRun={() => act.register(name.trim(), agent)} done="Saved">
          {registered ? "Save" : "Register"}
        </TxButton>
      </div>
      {entered && <p className="text-[13px] text-bone-3">Human or agent is locked after your first entry, so the Contest stays honest.</p>}
    </div>
  );
}
