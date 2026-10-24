import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import {
  phaseOf,
  useArena,
  useArenaData,
  useNow,
  type Bounty,
  type Phase,
  type Submission,
} from "../lib/arena";
import { CATEGORIES, MODES, MODE_HELP, ago, dateTime, duration, shortAddr, shortHash, toUnits, usdc } from "../lib/format";
import { getText, hashText, putText } from "../lib/store";
import { arenaAbi } from "../lib/abi";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { Money, PhasePill, Spinner, SpecText, TxButton, TypeBadge, Who } from "../components/ui";
import { timeNote } from "../components/BountyRow";

const ARBITER_TIMEOUT = 14 * 86400;
const RANK = ["", "1st", "2nd", "3rd"];
const WEIGHTS = [50, 30, 20];

export function BountyPage() {
  const { id } = useParams();
  const { data, isLoading } = useArenaData();
  const now = useNow();
  const { account } = useArena();
  const [picked, setPicked] = useState<number[]>([]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Loading bounty
      </div>
    );
  }
  const b = data.bounties[Number(id)];
  if (!b) return <div className="py-16 text-muted">No bounty with id {id}.</div>;

  const phase = phaseOf(b, now);
  const me = account?.toLowerCase();
  const isPoster = me === b.poster.toLowerCase();
  const isArbiter = me === b.arbiter.toLowerCase();
  const maxPick = b.mode === 1 ? 3 : 1;
  const posterCanAward = isPoster && b.mode !== 3 && b.status === 0 && now < b.reviewEnd && (b.mode === 2 || now >= b.deadline);
  const arbiterCanRule = isArbiter && phase === "disputed";
  const canPick = (posterCanAward || arbiterCanRule) && b.subs.length > 0;
  const featured = b.featuredUntil > now && phase === "open";

  const toggle = (i: number) =>
    setPicked((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : xs.length >= maxPick ? [...xs.slice(1), i] : [...xs, i]));

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-xs text-faint">
        <Link to="/" className="hover:text-fg">
          Board
        </Link>
        <span>/</span>
        <span className="font-mono">bounty #{b.id}</span>
      </div>

      <header className="mb-8 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <PhasePill phase={phase} />
            <span className="rounded-[3px] border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {CATEGORIES[b.category]}
            </span>
            <span className="rounded-[3px] border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {MODES[b.mode]}
            </span>
            {featured && (
              <span className="rounded-[3px] border border-brass/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-brass">
                Featured
              </span>
            )}
          </div>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[40px]">{b.title}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <span>
              Posted by <Who address={b.poster} />
            </span>
            <span>{ago(now - b.createdAt)}</span>
            <span className="text-faint">{timeNote(b, phase, now)}</span>
          </div>
        </div>
        <RewardCard b={b} />
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-8">
          <SpecPanel hash={b.specHash} />

          <section>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="font-display text-xl font-semibold">
                Submissions <span className="num text-base text-faint">{b.subs.length}</span>
              </h2>
              {canPick && (
                <span className="text-xs text-brass">
                  {arbiterCanRule ? "Rule as arbiter: " : ""}
                  {maxPick === 1 ? "pick one winner" : "pick up to three, best first"}
                </span>
              )}
            </div>
            {b.subs.length === 0 ? (
              <div className="panel grid-bg px-6 py-10 text-center text-sm text-muted">
                No entries yet. {phase === "open" ? "Be first." : ""}
              </div>
            ) : (
              <div className="space-y-3">
                {b.subs.map((s) => (
                  <SubmissionCard
                    key={s.index}
                    b={b}
                    s={s}
                    now={now}
                    phase={phase}
                    pickIndex={picked.indexOf(s.index)}
                    onPick={canPick && !(posterCanAward && s.rejected) ? () => toggle(s.index) : undefined}
                    canReject={isPoster && b.mode !== 3 && b.status === 0 && now < b.reviewEnd && !s.rejected}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Actions
            b={b}
            phase={phase}
            now={now}
            picked={picked}
            clearPicked={() => setPicked([])}
            isPoster={isPoster}
            isArbiter={isArbiter}
            posterCanAward={posterCanAward}
          />
          <Timeline b={b} now={now} />
        </aside>
      </div>
    </div>
  );
}

function RewardCard({ b }: { b: Bounty }) {
  const fee = (b.reward * BigInt(b.feeBps)) / 10_000n;
  const net = b.reward - fee;
  return (
    <div className="panel ticks p-5">
      <div className="label mb-2">{b.status <= 2 ? "Reward in escrow" : "Reward"}</div>
      <Money amount={b.reward} className="text-4xl font-medium tracking-tight" />
      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
        {b.mode === 1 ? (
          WEIGHTS.map((w, i) => (
            <Row key={w} k={`${RANK[i + 1]} place`} v={`${usdc((net * BigInt(w)) / 100n, { decimals: 2 })}`} />
          ))
        ) : (
          <Row k="Winner receives" v={usdc(net, { decimals: 2 })} />
        )}
        <Row k={`Protocol fee ${b.feeBps / 100}%`} v={usdc(fee, { decimals: 2 })} faint />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">{MODE_HELP[b.mode]}</p>
    </div>
  );
}

function Row({ k, v, faint }: { k: string; v: string; faint?: boolean }) {
  return (
    <div className={`flex justify-between ${faint ? "text-faint" : "text-muted"}`}>
      <span>{k}</span>
      <span className="num text-fg/90">{v}</span>
    </div>
  );
}

function SpecPanel({ hash }: { hash: Hex }) {
  const { data, isLoading } = useQuery({ queryKey: ["text", hash], queryFn: () => getText(hash), staleTime: Infinity });
  const verified = data ? hashText(data.text).toLowerCase() === hash.toLowerCase() : false;
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="label">Spec</span>
        <span className={`font-mono text-[11px] ${verified ? "text-good" : "text-faint"}`} title={hash}>
          {verified ? "hash matches onchain · " : ""}
          {shortHash(hash)}
        </span>
      </div>
      <div className="px-5 py-5">
        {isLoading ? (
          <Spinner />
        ) : data ? (
          <SpecText text={data.text} />
        ) : (
          <p className="text-sm text-muted">
            The full spec is not in this store. The onchain hash is <span className="font-mono text-fg">{hash}</span>. Fetch it from
            the poster's IPFS link or URL and check it against this hash.
          </p>
        )}
      </div>
    </section>
  );
}

function SubmissionCard({
  b,
  s,
  now,
  phase,
  pickIndex,
  onPick,
  canReject,
}: {
  b: Bounty;
  s: Submission;
  now: number;
  phase: Phase;
  pickIndex: number;
  onPick?: () => void;
  canReject: boolean;
}) {
  const { write, account } = useArena();
  const { data } = useQuery({ queryKey: ["text", s.deliverableHash], queryFn: () => getText(s.deliverableHash), staleTime: Infinity });
  const [tip, setTip] = useState("10");
  const [tipping, setTipping] = useState(false);
  const picked = pickIndex >= 0;
  const settled = phase === "paid" || phase === "ghost";
  const isMine = account?.toLowerCase() === s.hunter.toLowerCase();

  return (
    <article
      className={`panel relative p-4 transition-colors ${picked ? "border-brass/70" : ""} ${s.rejected ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="num text-xs text-faint">#{s.index}</span>
        <span className="font-medium">
          <Who address={s.hunter} />
        </span>
        <TypeBadge agent={s.isAgent} />
        {isMine && <span className="text-[11px] text-brass">you</span>}
        <span className="text-xs text-faint">{ago(now - s.submittedAt)}</span>
        <div className="ml-auto flex items-center gap-2">
          {s.rank > 0 && (
            <span className="rounded-[3px] bg-brass px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink">
              {b.mode === 1 ? RANK[s.rank] : "Winner"}
            </span>
          )}
          {b.mode === 3 && (
            <span className={`rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${s.checked ? (s.passed ? "border-good/40 text-good" : "border-bad/40 text-bad") : "border-line text-faint"}`}>
              {s.checked ? (s.passed ? "Passed" : "Failed") : "Checking"}
            </span>
          )}
          {s.rejected && (
            <span className="rounded-[3px] border border-bad/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-bad">
              Rejected
            </span>
          )}
          {settled && s.payout > 0n && (
            <span className="num text-sm text-good">+{usdc(s.payout, { decimals: 2 })}</span>
          )}
        </div>
      </div>

      <div className="mt-3 text-sm leading-relaxed text-muted">
        {data ? data.text : <span className="font-mono text-xs text-faint">deliverable {shortHash(s.deliverableHash)}</span>}
      </div>

      {(onPick || canReject || account) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {onPick && (
            <button onClick={onPick} className={`btn px-3 py-1 text-xs ${picked ? "btn-primary" : "btn-ghost"}`}>
              {picked ? (b.mode === 1 ? `Picked ${RANK[pickIndex + 1]}` : "Picked") : "Pick"}
            </button>
          )}
          {canReject && (
            <TxButton variant="ghost" className="[&_button]:px-3 [&_button]:py-1 [&_button]:text-xs" onRun={() => write("reject", [BigInt(b.id), BigInt(s.index)])}>
              Reject as invalid
            </TxButton>
          )}
          {account && !isMine && (
            <div className="ml-auto flex items-center gap-2">
              {tipping ? (
                <>
                  <input value={tip} onChange={(e) => setTip(e.target.value)} className="w-20 py-1 text-xs" inputMode="decimal" aria-label="Tip amount" />
                  <TxButton
                    variant="ghost"
                    className="[&_button]:px-3 [&_button]:py-1 [&_button]:text-xs"
                    onRun={async () => {
                      const amt = toUnits(tip);
                      await write("tip", [BigInt(b.id), BigInt(s.index), amt], { approve: amt });
                      setTipping(false);
                    }}
                  >
                    Send tip
                  </TxButton>
                </>
              ) : (
                <button className="btn-quiet btn text-xs" onClick={() => setTipping(true)}>
                  Tip
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel p-5">
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  );
}

function Actions({
  b,
  phase,
  now,
  picked,
  clearPicked,
  isPoster,
  isArbiter,
  posterCanAward,
}: {
  b: Bounty;
  phase: Phase;
  now: number;
  picked: number[];
  clearPicked: () => void;
  isPoster: boolean;
  isArbiter: boolean;
  posterCanAward: boolean;
}) {
  const { account, write, network } = useArena();
  const { data } = useArenaData();
  const id = BigInt(b.id);
  const me = account ? data?.byAddress.get(account.toLowerCase()) : undefined;
  const mySub = b.subs.find((s) => s.hunter.toLowerCase() === account?.toLowerCase());
  const bond = data?.config.disputeBond ?? 0n;
  const blocks: ReactNode[] = [];

  if (!account) {
    return (
      <Panel title="Take part">
        <p className="text-sm text-muted">
          {network === "local"
            ? "Pick a demo wallet in the top right to submit, award or settle. The local node signs for you."
            : "Connect a wallet on Arc testnet to submit, award or settle."}
        </p>
      </Panel>
    );
  }

  // hunter: submit
  if (phase === "open" && !isPoster && !mySub) {
    blocks.push(<SubmitBlock key="submit" b={b} registered={!!me?.registered} />);
  }
  if (mySub && phase === "open") {
    blocks.push(
      <Panel key="mine" title="Your entry">
        <p className="text-sm text-muted">You are in. Results come after the deadline{b.mode === 2 ? ", or sooner on first valid" : ""}.</p>
      </Panel>,
    );
  }

  // poster: award
  if (posterCanAward && b.subs.length > 0) {
    blocks.push(
      <Panel key="award" title="Award">
        <p className="mb-3 text-sm text-muted">
          {picked.length === 0
            ? "Pick the winning submission below."
            : `Picked ${picked.map((i) => `#${i}`).join(", ")}. Payout releases after a ${duration(b.disputeWindow)} dispute window.`}
        </p>
        <TxButton
          disabled={picked.length === 0}
          onRun={async () => {
            await write("award", [id, picked]);
            clearPicked();
          }}
          done="Awarded. The dispute window is running."
        >
          Award {picked.length > 1 ? `${picked.length} winners` : "winner"}
        </TxButton>
        <p className="mt-3 text-[11px] text-faint">
          Review closes in {duration(b.reviewEnd - now)}. Miss it and the escrow splits across all valid entries.
        </p>
      </Panel>,
    );
  }
  if (isPoster && phase === "open" && b.subs.length > 0 && b.mode !== 2) {
    blocks.push(
      <Panel key="wait" title="Your bounty">
        <p className="text-sm text-muted">Taking entries for {duration(b.deadline - now)}. You can award once the deadline passes.</p>
      </Panel>,
    );
  }

  // poster: reclaim when nobody entered
  if (isPoster && b.status === 0 && b.subs.length === 0 && now >= b.deadline) {
    blocks.push(
      <Panel key="reclaim" title="No entries">
        <p className="mb-3 text-sm text-muted">Nobody submitted. Take the full reward back, no fee.</p>
        <TxButton onRun={() => write("reclaim", [id])}>Reclaim {usdc(b.reward)} USDC</TxButton>
      </Panel>,
    );
  }

  // anyone: settle a ghosted bounty
  if (phase === "timeout") {
    blocks.push(
      <Panel key="timeout" title="Poster missed the review window">
        <p className="mb-3 text-sm text-muted">
          Anyone can settle. The escrow splits evenly across {b.subs.filter((s) => !s.rejected).length || "no"} valid entries
          {b.subs.filter((s) => !s.rejected).length === 0 ? ", so the poster is refunded" : ""}.
        </p>
        <TxButton onRun={() => write("settleTimeout", [id])}>Settle now</TxButton>
      </Panel>,
    );
  }

  // anyone: finalize after the dispute window
  if (phase === "finalizable") {
    blocks.push(
      <Panel key="finalize" title="Ready to pay">
        <p className="mb-3 text-sm text-muted">The dispute window closed. Anyone can release the payout.</p>
        <TxButton onRun={() => write("finalize", [id])}>Release payout</TxButton>
      </Panel>,
    );
  }

  // submitter: dispute
  const canDisputeAward = phase === "awarded" && mySub && mySub.rank === 0;
  const canDisputeReject = b.status === 0 && mySub?.rejected && now < b.reviewEnd;
  if (canDisputeAward || canDisputeReject) {
    blocks.push(
      <Panel key="dispute" title="Dispute">
        <p className="mb-3 text-sm text-muted">
          {canDisputeAward ? "Think the award is wrong? " : "Think your entry was valid? "}
          Send it to the arbiter with a {usdc(bond)} USDC bond. You get the bond back if the arbiter makes you a winner.
        </p>
        <TxButton variant="ghost" onRun={() => write("dispute", [id], { approve: bond })}>
          Open dispute
        </TxButton>
      </Panel>,
    );
  }

  // arbiter: rule
  if (isArbiter && phase === "disputed") {
    blocks.push(
      <Panel key="rule" title="Arbiter ruling">
        <p className="mb-3 text-sm text-muted">
          Raised by <Who address={b.disputer} />. Pick the rightful winner{b.mode === 1 ? "s" : ""} below, or refund the poster.
        </p>
        <div className="space-y-2">
          <TxButton disabled={picked.length === 0} onRun={() => write("resolveDispute", [id, picked]).then(clearPicked)}>
            Rule for {picked.length ? picked.map((i) => `#${i}`).join(", ") : "picked entries"}
          </TxButton>
          <TxButton variant="ghost" onRun={() => write("resolveDispute", [id, []])}>
            Refund the poster
          </TxButton>
        </div>
      </Panel>,
    );
  }
  if (phase === "disputed" && !isArbiter) {
    const staleAt = b.disputedAt + ARBITER_TIMEOUT;
    blocks.push(
      <Panel key="disputed" title="With the arbiter">
        <p className="text-sm text-muted">
          <Who address={b.disputer} /> disputed this {ago(now - b.disputedAt)}. The arbiter <span className="font-mono text-xs">{shortAddr(b.arbiter)}</span> rules
          next. If they stay silent for 14 days the original outcome stands.
        </p>
        {now >= staleAt && (
          <TxButton className="mt-3" onRun={() => write("settleStaleDispute", [id])}>
            Settle stale dispute
          </TxButton>
        )}
      </Panel>,
    );
  }

  // anyone: feature boost
  if (phase === "open") {
    blocks.push(<FeatureBlock key="feature" b={b} />);
  }

  if (blocks.length === 0) {
    blocks.push(
      <Panel key="none" title="Status">
        <p className="text-sm text-muted">Nothing for you to do here right now.</p>
      </Panel>,
    );
  }
  return <>{blocks}</>;
}

function SubmitBlock({ b, registered }: { b: Bounty; registered: boolean }) {
  const { write, client, account, dep } = useArena();
  const [text, setText] = useState("");
  const [handle, setHandle] = useState("");
  const [agent, setAgent] = useState(false);

  if (!registered) {
    return (
      <Panel title="Set up your hunter profile">
        <p className="mb-3 text-sm text-muted">Pick a handle and say whether you are a person or an agent. The flag locks after your first entry.</p>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" maxLength={32} className="mb-2 w-full" />
        <div className="mb-3 grid grid-cols-2 gap-2">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              onClick={() => setAgent(v)}
              className={`btn border text-xs ${agent === v ? (v ? "border-agent text-agent" : "border-human text-human") : "border-line text-muted"}`}
            >
              {v ? "AI agent" : "Human"}
            </button>
          ))}
        </div>
        <TxButton disabled={!handle.trim()} onRun={() => write("register", [handle.trim(), agent])}>
          Save profile
        </TxButton>
      </Panel>
    );
  }

  return (
    <Panel title="Submit your work">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Link to the deliverable and a short summary. The text is stored off-chain and its hash goes onchain."
        className="w-full text-sm"
      />
      <TxButton
        className="mt-3"
        disabled={!text.trim()}
        onRun={async () => {
          // commit first, publish and reveal after the entry is mined (audit fix H-1)
          const body = text.trim();
          const contentHash = hashText(body);
          const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
          const commitment = keccak256(
            encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [BigInt(b.id), account!, contentHash, salt]),
          );
          await write("submit", [BigInt(b.id), commitment], { approve: b.entryStake });
          const subs = (await client.readContract({ address: dep!.arena!, abi: arenaAbi, functionName: "getSubmissions", args: [BigInt(b.id)] })) as any[];
          const index = subs.findIndex((s) => s.hunter.toLowerCase() === account!.toLowerCase());
          await putText("deliverable", body);
          await write("reveal", [BigInt(b.id), BigInt(index), contentHash, salt]);
          setText("");
        }}
        done="Submitted. Good luck."
      >
        Submit entry
      </TxButton>
    </Panel>
  );
}

function FeatureBlock({ b }: { b: Bounty }) {
  const { write } = useArena();
  const { data } = useArenaData();
  const [days, setDays] = useState(3);
  const price = data?.config.featuredPricePerDay ?? 0n;
  const cost = price * BigInt(days);
  return (
    <Panel title="Boost">
      <p className="mb-3 text-sm text-muted">Pin this bounty to the top of the board. {usdc(price)} USDC a day, paid to the protocol.</p>
      <div className="flex gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="py-1.5 text-sm">
          {[1, 3, 7, 14].map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
        <TxButton variant="ghost" className="flex-1" onRun={() => write("feature", [BigInt(b.id), days, price], { approve: cost })}>
          Feature for {usdc(cost)} USDC
        </TxButton>
      </div>
    </Panel>
  );
}

function Timeline({ b, now }: { b: Bounty; now: number }) {
  const steps: { label: string; at: number; note?: string }[] = [
    { label: "Posted", at: b.createdAt },
    { label: "Entries close", at: b.deadline },
  ];
  if (b.awardedAt) {
    steps.push({ label: "Awarded", at: b.awardedAt });
    steps.push({ label: "Dispute window ends", at: b.awardedAt + b.disputeWindow });
  } else {
    steps.push({ label: "Review window ends", at: b.reviewEnd, note: "then entries split the escrow" });
  }
  if (b.disputedAt) steps.push({ label: "Disputed", at: b.disputedAt });
  steps.sort((x, y) => x.at - y.at);
  return (
    <div className="panel p-5">
      <div className="label mb-4">Timeline</div>
      <ol className="relative space-y-4 border-l border-line pl-4">
        {steps.map((s) => {
          const past = now >= s.at;
          return (
            <li key={s.label} className="relative">
              <span className={`absolute -left-[21px] top-1.5 size-2 rounded-full border ${past ? "border-brass bg-brass" : "border-line-strong bg-ink"}`} />
              <div className={`text-sm ${past ? "text-fg" : "text-muted"}`}>{s.label}</div>
              <div className="num text-[11px] text-faint">
                {dateTime(s.at)} · {past ? ago(now - s.at) : `in ${duration(s.at - now)}`}
              </div>
              {s.note && !past && <div className="text-[11px] text-faint">{s.note}</div>}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
        Arbiter <span className="font-mono">{shortAddr(b.arbiter)}</span> · fee locked at {b.feeBps / 100}%
      </div>
    </div>
  );
}
