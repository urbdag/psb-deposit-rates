import type { RateEntry } from "./types.js";

/** Compact stable key for a rate line (mirrors scripts/history.mjs). */
export function rateKey(r: {
  bankId: string;
  product: string;
  customer: string;
  tenure: { minDays: number; maxDays: number | null };
  scheme?: string;
}): string {
  const max = r.tenure?.maxDays ?? "";
  return `${r.bankId}|${r.product}|${r.customer}|${r.tenure?.minDays ?? ""}|${max}|${r.scheme || ""}`;
}

export interface Snapshot {
  date: string;
  rates: Record<string, number>;
}
export interface History {
  snapshots: Snapshot[];
}

export interface RateChange {
  key: string;
  bankId: string;
  product: string;
  customer: string;
  from: number;
  to: number;
  delta: number;
  date: string;
}

/** Most recent change per rate key (latest snapshot vs last different value). */
export function recentChanges(history: History): RateChange[] {
  const snaps = history.snapshots;
  if (!snaps || snaps.length < 2) return [];
  const latest = snaps[snaps.length - 1];
  const out: RateChange[] = [];
  for (const [key, to] of Object.entries(latest.rates)) {
    let from: number | null = null;
    for (let i = snaps.length - 2; i >= 0; i--) {
      const v = snaps[i].rates[key];
      if (v == null) continue;
      if (v !== to) {
        from = v;
        break;
      }
    }
    if (from != null) {
      const [bankId, product, customer] = key.split("|");
      out.push({
        key,
        bankId,
        product,
        customer,
        from,
        to,
        delta: Math.round((to - from) * 100) / 100,
        date: latest.date,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

/** How many distinct banks changed any rate in the latest snapshot. */
export function banksChangedCount(history: History): number {
  return new Set(recentChanges(history).map((c) => c.bankId)).size;
}

/**
 * Build the series of values for one rate key across all snapshots (carrying
 * forward the last known value for gaps). Returns [] if too few points.
 */
export function seriesForKey(history: History, key: string): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (const s of history.snapshots) {
    const v = s.rates[key];
    if (v != null) last = v;
    if (last != null) out.push(last);
  }
  return out;
}

/** A tiny inline SVG sparkline for a numeric series. Empty string if <2 points. */
export function sparklineSvg(
  values: number[],
  color: string,
  w = 96,
  h = 26,
): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1];
  const first = values[0];
  const trendUp = last >= first;
  const lastX = pad + (values.length - 1) * stepX;
  const lastY = h - pad - ((last - min) / span) * (h - pad * 2);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}" opacity="0.85"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.4" fill="${trendUp ? "#10b981" : "#ef4444"}"/>
  </svg>`;
}

export type { RateEntry };
