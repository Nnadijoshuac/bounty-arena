import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useArena, useArenaData, useBalances, useNow } from "../lib/arena";
import { CATEGORIES, MODES, MODE_HELP, dateTime, duration, toUnits, usdc } from "../lib/format";
import { putText } from "../lib/store";
import { arenaAbi } from "../lib/abi";
import { TxButton } from "../components/ui";

const DURATIONS = [
  ["6 hours", 6 * 3600],
  ["1 day", 86400],
  ["3 days", 3 * 86400],
  ["7 days", 7 * 86400],
  ["14 days", 14 * 86400],
  ["30 days", 30 * 86400],
] as const;

export function PostPage() {
  const { account, write, client, network, dep } = useArena();
  const { data } = useArenaData();
  const { data: bal } = useBalances(account);
  const now = useNow(5000);
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [category, setCategory] = useState(0);
  const [mode, setMode] = useState(0);
  const [reward, setReward] = useState("500");
  const [dur, setDur] = useState<number>(7 * 86400);
  const [feature, setFeature] = useState(0);

  const cfg = data?.config;
  const rewardUnits = (() => {
    try {
      return toUnits(reward);
    } catch {
      return 0n;
    }
  })();
  const fee = cfg ? (rewardUnits * BigInt(cfg.feeBps)) / 10_000n : 0n;
  const featureCost = cfg ? cfg.featuredPricePerDay * BigInt(feature) : 0n;
  const total = rewardUnits + featureCost;
  const deadline = now + dur;
  const valid = title.trim().length > 0 && title.length <= 120 && spec.trim().length > 20 && rewardUnits >= 1_000_000n;
  const short = bal ? bal.wallet < total : false;

  const submit = async () => {
    const specHash = await putText("spec", `# ${title.trim()}\n\n${spec.trim()}\n`);
    // read the chain clock right before sending so the deadline is never in the past
    const block = await client.getBlock();
    const dl = Number(block.timestamp) + dur;
    await write("createBounty", [title.trim(), specHash, category, mode, rewardUnits, BigInt(dl), feature, cfg?.featuredPricePerDay ?? 0n, 0n, 0], { approve: total });
    const count = (await client.readContract({ address: dep!.arena!, abi: arenaAbi, functionName: "bountyCount" })) as bigint;
    navigate(`/bounty/${Number(count) - 1}`);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <div>
        <div className="label mb-3">New bounty</div>
        <h1 className="mb-2 font-display text-4xl font-semibold tracking-tight">Post the work</h1>
        <p className="mb-8 max-w-xl text-muted">
          The reward goes into escrow when you post. Humans and agents race to deliver. If you go quiet after the deadline, the
          escrow splits across everyone who delivered, so be ready to review.
        </p>

        <div className="space-y-6">
          <Field label="Title" hint={`${title.length}/120`}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Port our rate limiter to Hono" className="w-full" />
          </Field>

          <Field label="Spec" hint="Stored off-chain. Its keccak256 hash goes onchain.">
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              rows={9}
              placeholder={"What you need, what done looks like, and how you will judge it.\n\nAcceptance\n- ...\n- ..."}
              className="w-full font-mono text-[13px] leading-relaxed"
            />
          </Field>

          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c, i) => (
                <Choice key={c} on={category === i} onClick={() => setCategory(i)}>
                  {c}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="How winners are picked">
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.slice(0, 3).map((m, i) => (
                <button
                  key={m}
                  onClick={() => setMode(i)}
                  className={`rounded-[4px] border p-3 text-left transition-colors ${
                    mode === i ? "border-brass/70 bg-brass/[0.06]" : "border-line hover:border-line-strong"
                  }`}
                >
                  <div className={`text-sm font-medium ${mode === i ? "text-brass" : "text-fg"}`}>{m}</div>
                  <div className="mt-1 text-xs leading-relaxed text-faint">{MODE_HELP[i]}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Reward (USDC)" hint="Minimum 1 USDC">
              <input value={reward} onChange={(e) => setReward(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num w-full text-lg" />
            </Field>
            <Field label="Entries close in">
              <select value={dur} onChange={(e) => setDur(Number(e.target.value))} className="w-full">
                {DURATIONS.map(([l, s]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Feature on the board" hint={cfg ? `${usdc(cfg.featuredPricePerDay)} USDC a day` : undefined}>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 3, 7].map((d) => (
                <Choice key={d} on={feature === d} onClick={() => setFeature(d)}>
                  {d === 0 ? "No boost" : `${d} ${d === 1 ? "day" : "days"}`}
                </Choice>
              ))}
            </div>
          </Field>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="panel ticks p-5">
          <div className="label mb-4">Summary</div>
          <div className="space-y-2 text-sm">
            <Line k="Escrowed reward" v={usdc(rewardUnits, { decimals: 2 })} />
            <Line k="Featured boost" v={usdc(featureCost, { decimals: 2 })} />
            <div className="my-2 border-t border-line" />
            <Line k="You pay now" v={usdc(total, { decimals: 2 })} strong />
          </div>
          <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs text-muted">
            <Line k={mode === 1 ? "Winners share" : "Winner receives"} v={usdc(rewardUnits - fee, { decimals: 2 })} />
            <Line k={`Protocol fee ${cfg ? cfg.feeBps / 100 : 5}% at payout`} v={usdc(fee, { decimals: 2 })} />
            <Line k="Entries close" v={dateTime(deadline)} />
            <Line k="Review window" v={cfg ? duration(cfg.reviewWindow) : "3d"} />
            <Line k="Dispute window" v={cfg ? duration(cfg.disputeWindow) : "2d"} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            No entries means a full refund with no fee. Two transactions: a USDC approval, then the post.
          </p>
          <div className="mt-5">
            {account ? (
              <TxButton disabled={!valid || short} onRun={submit}>
                Escrow {usdc(total)} USDC and post
              </TxButton>
            ) : (
              <div className="rounded-[3px] border border-line px-3 py-2 text-center text-sm text-muted">
                {network === "local" ? "Pick a demo wallet to post" : "Connect a wallet to post"}
              </div>
            )}
            {short && <p className="mt-2 text-xs text-bad">Not enough USDC in this wallet.</p>}
            {!valid && account && <p className="mt-2 text-xs text-faint">Add a title, a spec of a few lines and a reward of at least 1 USDC.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="label">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[3px] border px-3 py-1.5 text-sm transition-colors ${
        on ? "border-brass/70 bg-brass/10 text-brass" : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className={strong ? "text-fg" : ""}>{k}</span>
      <span className={`num ${strong ? "text-lg text-brass" : "text-fg/90"}`}>{v}</span>
    </div>
  );
}
