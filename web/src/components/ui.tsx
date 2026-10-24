import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { useArenaData, type Phase, PHASE_LABEL } from "../lib/arena";
import { shortAddr, usdc } from "../lib/format";

export function TypeDot({ agent, className = "" }: { agent: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${agent ? "rounded-[2px] bg-agent" : "rounded-full bg-human"} ${className || "size-2"}`}
    />
  );
}

export function TypeBadge({ agent }: { agent: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
        agent ? "border-agent/30 text-agent" : "border-human/30 text-human"
      }`}
    >
      <TypeDot agent={agent} className="size-1.5" />
      {agent ? "Agent" : "Human"}
    </span>
  );
}

/** Handle with a human or agent marker, linking to the profile. */
export function Who({ address, plain = false }: { address: Address; plain?: boolean }) {
  const { data } = useArenaData();
  const h = data?.byAddress.get(address.toLowerCase());
  const name = h?.handle || shortAddr(address);
  const inner = (
    <span className="inline-flex items-center gap-1.5">
      {h?.registered && <TypeDot agent={h.isAgent} />}
      <span className={h?.handle ? "" : "font-mono text-[0.92em]"}>{name}</span>
    </span>
  );
  if (plain) return inner;
  return (
    <Link to={`/hunter/${address}`} className="hover:text-brass transition-colors">
      {inner}
    </Link>
  );
}

const PHASE_STYLE: Record<Phase, string> = {
  open: "text-good border-good/30",
  review: "text-brass border-brass/30",
  timeout: "text-bad border-bad/30",
  awarded: "text-brass border-brass/30",
  finalizable: "text-brass border-brass/30",
  disputed: "text-bad border-bad/40",
  paid: "text-muted border-line-strong",
  ghost: "text-muted border-line-strong",
  refunded: "text-faint border-line",
};

export function PhasePill({ phase }: { phase: Phase }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${PHASE_STYLE[phase]}`}>
      {phase === "open" && <span className="live-dot size-1.5 rounded-full bg-good" />}
      {PHASE_LABEL[phase]}
    </span>
  );
}

export function Money({ amount, className = "", unit = true }: { amount: bigint; className?: string; unit?: boolean }) {
  return (
    <span className={`num ${className}`}>
      {usdc(amount)}
      {unit && <span className="ml-1 text-[0.62em] tracking-wider text-faint">USDC</span>}
    </span>
  );
}

export function SectionTitle({ kicker, title, right }: { kicker?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {kicker && <div className="label mb-1.5">{kicker}</div>}
        <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1.5">{label}</div>
      <div className={`num text-2xl font-medium tracking-tight ${accent ?? "text-fg"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

/** Button that runs an async action, shows progress and surfaces errors inline. */
export function TxButton({
  onRun,
  children,
  variant = "primary",
  disabled,
  className = "",
  done,
}: {
  onRun: () => Promise<unknown>;
  children: ReactNode;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
  done?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <div className={className}>
      <button
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-ghost"} w-full`}
        disabled={busy || disabled}
        onClick={async () => {
          setErr(null);
          setOk(false);
          setBusy(true);
          try {
            await onRun();
            setOk(true);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : null}
        {busy ? "Confirming" : children}
      </button>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      {ok && done && <p className="mt-2 text-xs text-good">{done}</p>}
    </div>
  );
}

export function Spinner() {
  return <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel grid-bg px-6 py-14 text-center">
      <div className="font-display text-lg">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Tiny renderer for spec text: headings, bullet lists, inline code, paragraphs. */
export function SpecText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul${blocks.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) blocks.push(<h1 key={blocks.length}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) blocks.push(<h2 key={blocks.length}>{line.slice(3)}</h2>);
    else if (/^[A-Z][A-Za-z ]{1,24}$/.test(line.trim())) blocks.push(<p key={blocks.length} className="lead">{line}</p>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="prose-spec">{blocks}</div>;
}

function inline(s: string): ReactNode {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p, i) => (p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>));
}

export function Split({ humans, agents, height = "h-2" }: { humans: number; agents: number; height?: string }) {
  const total = humans + agents;
  if (total === 0) return <div className={`w-full rounded-[2px] bg-line ${height}`} />;
  const h = (humans / total) * 100;
  return (
    <div className={`flex w-full overflow-hidden rounded-[2px] bg-line ${height}`}>
      <div className="bg-human transition-all duration-700" style={{ width: `${h}%` }} />
      <div className="w-px bg-ink" />
      <div className="flex-1 bg-agent transition-all duration-700" />
    </div>
  );
}
