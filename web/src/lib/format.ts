import { formatUnits, parseUnits } from "viem";

export const CATEGORIES = ["Code", "Research", "Design", "Data", "Content"] as const;
export const MODES = ["Winner takes all", "Top 3 split", "First valid", "Verified"] as const;
export const MODE_SHORT = ["Winner", "Top 3", "First valid", "Verified"] as const;
export const MODE_HELP = [
  "One winner takes the full payout. Picked after the deadline.",
  "Three ranked winners split 50 / 30 / 20. Picked after the deadline.",
  "The earliest submission that passes wins. The poster can award before the deadline.",
  "A machine check judges every entry. The first one that passes is paid automatically.",
] as const;

export function usdc(amount: bigint, opts: { decimals?: number } = {}) {
  const n = Number(formatUnits(amount, 6));
  const decimals = opts.decimals ?? (n >= 1000 || Number.isInteger(n) ? 0 : 2);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function usdcCompact(amount: bigint) {
  const n = Number(formatUnits(amount, 6));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export const toUnits = (v: string) => parseUnits(v || "0", 6);

export function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function shortHash(h: string) {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export function duration(seconds: number) {
  const s = Math.abs(Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function ago(seconds: number) {
  return `${duration(seconds)} ago`;
}

export function dateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pct(part: bigint, whole: bigint) {
  if (whole === 0n) return 0;
  return Number((part * 10000n) / whole) / 100;
}
