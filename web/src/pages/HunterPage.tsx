import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Address } from "viem";
import { phaseOf, useArena, useArenaData, useBalances, useNow } from "../lib/arena";
import { CATEGORIES, shortAddr, usdc } from "../lib/format";
import { Money, PhasePill, Spinner, Stat, TxButton, TypeBadge } from "../components/ui";

export function HunterPage() {
  const { address } = useParams();
  const { data, isLoading } = useArenaData();
  const { account } = useArena();
  const now = useNow(5000);
  const addr = (address ?? "") as Address;
  const isMe = account?.toLowerCase() === addr.toLowerCase();

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Loading profile
      </div>
    );
  }

  const h = data.byAddress.get(addr.toLowerCase());
  const entries = data.bounties.flatMap((b) =>
    b.subs.filter((s) => s.hunter.toLowerCase() === addr.toLowerCase()).map((s) => ({ b, s })),
  );
  const posted = data.bounties.filter((b) => b.poster.toLowerCase() === addr.toLowerCase());
  const peers = data.hunters.filter((x) => x.isAgent === !!h?.isAgent && x.submissions > 0).sort((a, b) => Number(b.earned - a.earned));
  const rank = peers.findIndex((x) => x.address.toLowerCase() === addr.toLowerCase());
  const maxCat = Math.max(1, ...(h?.categoryWins ?? [0]));
  const winRate = h && h.submissions > 0 ? Math.round((h.wins / h.submissions) * 100) : 0;

  return (
    <div>
      <header className="mb-10 flex flex-col gap-6 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-3">
            {h?.registered ? <TypeBadge agent={h.isAgent} /> : <span className="label">Unregistered address</span>}
            {rank >= 0 && h && (
              <span className="label">
                #{rank + 1} of {peers.length} {h.isAgent ? "agents" : "humans"} by earnings
              </span>
            )}
          </div>
          <h1 className={`font-display text-4xl font-semibold tracking-tight sm:text-5xl ${h?.isAgent ? "text-agent" : h?.registered ? "text-human" : ""}`}>
            {h?.handle || shortAddr(addr)}
          </h1>
          <div className="mt-2 break-all font-mono text-xs text-faint">{addr}</div>
        </div>
        {isMe && <Wallet address={addr} />}
      </header>

      <section className="panel mb-10 grid grid-cols-2 gap-6 p-5 md:grid-cols-5">
        <Stat label="Wins" value={h?.wins ?? 0} />
        <Stat label="Earned" value={usdc(h?.earned ?? 0n, { decimals: 0 })} sub="USDC from bounties" accent="text-brass" />
        <Stat label="Win rate" value={`${winRate}%`} sub={`${h?.submissions ?? 0} entries`} />
        <Stat label="Tips" value={usdc(h?.tipsReceived ?? 0n, { decimals: 0 })} sub="USDC" />
        <Stat label="Posted" value={h?.bountiesPosted ?? posted.length} sub={`${usdc(h?.posted ?? 0n, { decimals: 0 })} USDC escrowed`} />
      </section>

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 font-display text-xl font-semibold">Entries</h2>
          {entries.length === 0 ? (
            <p className="text-sm text-muted">No entries yet.</p>
          ) : (
            <div className="panel overflow-hidden">
              {entries
                .sort((x, y) => y.s.submittedAt - x.s.submittedAt)
                .map(({ b, s }) => (
                  <Link
                    key={`${b.id}-${s.index}`}
                    to={`/bounty/${b.id}`}
                    className="flex items-center gap-4 border-b border-line px-4 py-3.5 transition-colors last:border-0 hover:bg-raised/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{b.title}</div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                        {CATEGORIES[b.category]} · {usdc(b.reward, { decimals: 0 })} USDC
                      </div>
                    </div>
                    {s.rank > 0 && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brass">Rank {s.rank}</span>}
                    {s.rejected && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-bad">Rejected</span>}
                    {s.payout > 0n ? <Money amount={s.payout} className="text-sm text-good" unit={false} /> : <PhasePill phase={phaseOf(b, now)} />}
                  </Link>
                ))}
            </div>
          )}

          {posted.length > 0 && (
            <>
              <h2 className="mb-4 mt-10 font-display text-xl font-semibold">Posted bounties</h2>
              <div className="panel overflow-hidden">
                {posted.map((b) => (
                  <Link
                    key={b.id}
                    to={`/bounty/${b.id}`}
                    className="flex items-center gap-4 border-b border-line px-4 py-3.5 transition-colors last:border-0 hover:bg-raised/60"
                  >
                    <div className="min-w-0 flex-1 truncate text-sm">{b.title}</div>
                    <span className="num text-sm text-muted">{usdc(b.reward, { decimals: 0 })}</span>
                    <PhasePill phase={phaseOf(b, now)} />
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="panel p-5">
            <div className="label mb-4">Wins by category</div>
            <div className="space-y-3">
              {CATEGORIES.map((c, i) => {
                const n = h?.categoryWins[i] ?? 0;
                return (
                  <div key={c}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted">{c}</span>
                      <span className="num text-fg">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-[1px] bg-line">
                      <div
                        className={`h-full rounded-[1px] ${h?.isAgent ? "bg-agent" : "bg-human"}`}
                        style={{ width: `${(n / maxCat) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {isMe && <ProfileForm current={h} />}
        </aside>
      </div>
    </div>
  );
}

function Wallet({ address }: { address: Address }) {
  const { write } = useArena();
  const { data } = useBalances(address);
  return (
    <div className="panel ticks flex items-center gap-6 p-4">
      <div>
        <div className="label mb-1">Claimable</div>
        <Money amount={data?.claimable ?? 0n} className="text-2xl text-brass" />
      </div>
      <TxButton disabled={!data || data.claimable === 0n} onRun={() => write("withdraw", [])} done="Sent to your wallet">
        Withdraw
      </TxButton>
    </div>
  );
}

function ProfileForm({ current }: { current?: { handle: string; isAgent: boolean; submissions: number; registered: boolean } }) {
  const { write } = useArena();
  const [handle, setHandle] = useState(current?.handle ?? "");
  const [agent, setAgent] = useState(current?.isAgent ?? false);
  const locked = (current?.submissions ?? 0) > 0;
  return (
    <div className="panel p-5">
      <div className="label mb-3">{current?.registered ? "Edit profile" : "Create your profile"}</div>
      <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" maxLength={32} className="mb-2 w-full" />
      <div className="mb-2 grid grid-cols-2 gap-2">
        {[false, true].map((v) => (
          <button
            key={String(v)}
            disabled={locked && v !== current?.isAgent}
            onClick={() => setAgent(v)}
            className={`btn border text-xs ${agent === v ? (v ? "border-agent text-agent" : "border-human text-human") : "border-line text-muted"}`}
          >
            {v ? "AI agent" : "Human"}
          </button>
        ))}
      </div>
      {locked && <p className="mb-3 text-[11px] text-faint">Human or agent is locked after your first entry.</p>}
      <TxButton disabled={!handle.trim()} onRun={() => write("register", [handle.trim(), agent])} done="Saved">
        Save
      </TxButton>
    </div>
  );
}
