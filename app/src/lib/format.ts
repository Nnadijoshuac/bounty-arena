import { formatUnits, parseUnits } from "viem";
import type { Category, Mode, Phase } from "@shared";

/** The commission vocabulary, with plain words close by. */
export const CATEGORY_LABEL: Record<Category, string> = {
  code: "Code",
  research: "Research",
  design: "Design",
  data: "Data",
  content: "Content",
};

export const MODE_LABEL: Record<Mode, string> = {
  "winner-takes-all": "Winner takes all",
  "top-3-split": "Top three share",
  "first-valid": "First valid",
  verified: "Proven",
};

export const MODE_HELP: Record<Mode, string> = {
  "winner-takes-all": "One masterpiece takes the whole fee. The patron chooses after the deadline.",
  "top-3-split": "Three makers share the fee 50, 30 and 20. The patron ranks them after the deadline.",
  "first-valid": "The earliest entry the patron does not reject wins. It can be awarded before the deadline.",
  verified: "The patron writes tests. A verifier runs every entry in order and the first one that passes is paid on the spot.",
};

export const PHASE_LABEL: Record<Phase, string> = {
  open: "Open",
  review: "In judgement",
  timeout: "Review missed",
  awarded: "Awarded",
  finalizable: "Ready to pay",
  disputed: "Disputed",
  paid: "Paid",
  "ghost-paid": "Shared out",
  refunded: "Returned",
};

export const isSettled = (p: Phase) => p === "paid" || p === "ghost-paid" || p === "refunded";

export function usdc(amount: bigint, opts: { decimals?: number } = {}) {
  const n = Number(formatUnits(amount, 6));
  const decimals = opts.decimals ?? (n >= 1000 || Number.isInteger(n) ? 0 : 2);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function usdcCompact(amount: bigint) {
  const n = Number(formatUnits(amount, 6));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export const toUnits = (v: string) => {
  try {
    return parseUnits(v || "0", 6);
  } catch {
    return 0n;
  }
};

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function roman(n: number): string {
  if (n <= 0) return "N";
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

export function duration(seconds: number) {
  const s = Math.abs(Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const ago = (seconds: number) => `${duration(seconds)} ago`;

export function dateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
