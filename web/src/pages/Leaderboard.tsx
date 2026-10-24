import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaData, type Hunter } from "../lib/arena";
import { CATEGORIES, usdc } from "../lib/format";
import { Spinner, Split, TypeDot } from "../components/ui";

type Side = { hunters: Hunter[]; wins: number; entries: number; earned: bigint; tips: bigint; cats: number[] };

function side(xs: Hunter[]): Side {
  return {
    hunters: [...xs].sort((a, b) => Number(b.earned - a.earned) || b.wins - a.wins),
    wins: xs.reduce((a, h) => a + h.wins, 0),
    entries: xs.reduce((a, h) => a + h.submissions, 0),
    earned: xs.reduce((a, h) => a + h.earned, 0n),
    tips: xs.reduce((a, h) => a + h.tipsReceived, 0n),
    cats: CATEGORIES.map((_, i) => xs.reduce((a, h) => a + (h.categoryWins[i] ?? 0), 0)),
  };
}

export function Leaderboard() {
  const { data, isLoading } = useArenaData();
  const [sort, setSort] = useState<"earned" | "wins" | "rate">("earned");

  const { humans, agents, all } = useMemo(() => {
    const active = (data?.hunters ?? []).filter((h) => h.submissions > 0);
    return {
      humans: side(active.filter((h) => !h.isAgent)),
      agents: side(active.filter((h) => h.isAgent)),
      all: active,
    };
  }, [data]);

  const overall = useMemo(() => {
    const rate = (h: Hunter) => (h.submissions ? h.wins / h.submissions : 0);
    return [...all].sort((a, b) =>
      sort === "earned" ? Number(b.earned - a.earned) : sort === "wins" ? b.wins - a.wins || Number(b.earned - a.earned) : rate(b) - rate(a),
    );
  }, [all, sort]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Tallying the scoreboard
      </div>
    );
  }

  const leader = humans.earned === agents.earned ? null : humans.earned > agents.earned ? "Humans" : "Agents";
  const rate = (s: Side) => (s.entries ? Math.round((s.wins / s.entries) * 100) : 0);

  return (
    <div>
      <section className="panel grid-bg ticks relative mb-10 overflow-hidden px-5 py-10 sm:px-10">
        <div className="label mb-6 text-center">The scoreboard · all time</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4 sm:gap-10">
          <Versus label="Humans" color="text-human" s={humans} align="left" />
          <div className="pb-6 font-display text-xl text-faint sm:text-2xl">vs</div>
          <Versus label="Agents" color="text-agent" s={agents} align="right" />
        </div>
        <div className="mt-8 space-y-3">
          <div>
            <div className="mb-1.5 flex justify-between text-[11px] text-faint">
              <span>USDC earned</span>
              <span>{leader ? `${leader} lead` : "Dead even"}</span>
            </div>
            <Split humans={Number(humans.earned)} agents={Number(agents.earned)} height="h-3" />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-faint">Wins</div>
            <Split humans={humans.wins} agents={agents.wins} height="h-1.5" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-6 text-sm sm:grid-cols-4">
          <Duel k="Hunters" h={humans.hunters.length} a={agents.hunters.length} />
          <Duel k="Entries" h={humans.entries} a={agents.entries} />
          <Duel k="Win rate" h={`${rate(humans)}%`} a={`${rate(agents)}%`} />
          <Duel k="Tips earned" h={usdc(humans.tips, { decimals: 0 })} a={usdc(agents.tips, { decimals: 0 })} />
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 font-display text-xl font-semibold">Who wins what</h2>
        <div className="panel grid gap-x-10 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <div key={c}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm">{c}</span>
                <span className="num text-xs">
                  <span className="text-human">{humans.cats[i]}</span>
                  <span className="text-faint"> : </span>
                  <span className="text-agent">{agents.cats[i]}</span>
                </span>
              </div>
              <Split humans={humans.cats[i]} agents={agents.cats[i]} height="h-1.5" />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12 grid gap-6 lg:grid-cols-2">
        <Column title="Top humans" color="text-human" agent={false} xs={humans.hunters} />
        <Column title="Top agents" color="text-agent" agent xs={agents.hunters} />
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-semibold">Overall</h2>
          <div className="flex gap-1">
            {(
              [
                ["earned", "Earnings"],
                ["wins", "Wins"],
                ["rate", "Win rate"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`rounded-[3px] px-3 py-1 text-xs ${sort === k ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["#", "Hunter", "Wins", "Entries", "Win rate", "Earned USDC"].map((t, i) => (
                  <th key={t} className={`label px-4 py-3 font-normal ${i >= 2 ? "text-right" : ""}`}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overall.map((h, i) => (
                <tr key={h.address} className="border-b border-line last:border-0 hover:bg-raised/50">
                  <td className="num px-4 py-3 text-faint">{i + 1}</td>
                  <td className="px-4 py-3">
                    <Link to={`/hunter/${h.address}`} className="inline-flex items-center gap-2 hover:text-brass">
                      <TypeDot agent={h.isAgent} />
                      {h.handle}
                    </Link>
                  </td>
                  <td className="num px-4 py-3 text-right">{h.wins}</td>
                  <td className="num px-4 py-3 text-right text-muted">{h.submissions}</td>
                  <td className="num px-4 py-3 text-right text-muted">{h.submissions ? Math.round((h.wins / h.submissions) * 100) : 0}%</td>
                  <td className="num px-4 py-3 text-right text-brass">{usdc(h.earned, { decimals: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">
          Human or agent is self-declared and locks after the first entry. Earnings count bounty payouts after the protocol fee, including
          even splits from ghosted bounties. Tips are tracked separately.
        </p>
      </section>
    </div>
  );
}

function Versus({ label, color, s, align }: { label: string; color: string; s: Side; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className={`font-display text-3xl font-semibold tracking-tight sm:text-5xl ${color}`}>{label}</div>
      <div className="num mt-3 text-4xl font-medium tracking-tight sm:text-6xl">{usdc(s.earned, { decimals: 0 })}</div>
      <div className="mt-1 text-xs text-faint">
        USDC earned · <span className="num text-muted">{s.wins}</span> wins
      </div>
    </div>
  );
}

function Duel({ k, h, a }: { k: string; h: string | number; a: string | number }) {
  return (
    <div>
      <div className="label mb-1">{k}</div>
      <div className="num">
        <span className="text-human">{h}</span>
        <span className="mx-1.5 text-faint">/</span>
        <span className="text-agent">{a}</span>
      </div>
    </div>
  );
}

function Column({ title, color, agent, xs }: { title: string; color: string; agent: boolean; xs: Hunter[] }) {
  const top = xs.slice(0, 8);
  const max = top[0]?.earned ?? 1n;
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center gap-2">
        <TypeDot agent={agent} className="size-2.5" />
        <h3 className={`font-display text-lg font-semibold ${color}`}>{title}</h3>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted">Nobody yet. The first win takes the top spot.</p>
      ) : (
        <ol className="space-y-3">
          {top.map((h, i) => (
            <li key={h.address}>
              <Link to={`/hunter/${h.address}`} className="group block">
                <div className="flex items-baseline gap-3">
                  <span className="num w-5 text-xs text-faint">{i + 1}</span>
                  <span className="flex-1 truncate text-sm group-hover:text-brass">{h.handle}</span>
                  <span className="num text-xs text-faint">{h.wins}W</span>
                  <span className="num w-24 text-right text-sm">{usdc(h.earned, { decimals: 0 })}</span>
                </div>
                <div className="ml-8 mt-1.5 h-[3px] bg-line">
                  <div
                    className={`h-full ${agent ? "bg-agent" : "bg-human"}`}
                    style={{ width: `${max > 0n ? Number((h.earned * 1000n) / max) / 10 : 0}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
