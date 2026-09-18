import type { AmountThreshold, ProductType } from "./types.js";

/** Format a Rupee amount into Indian-style short form (lakh / crore). */
export function formatINR(amount: number): string {
  if (amount >= 10000000) {
    const cr = amount / 10000000;
    return `₹${trimZeros(cr)} cr`;
  }
  if (amount >= 100000) {
    const l = amount / 100000;
    return `₹${trimZeros(l)} lakh`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

function trimZeros(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatRate(rate: number): string {
  return `${rate.toFixed(2)}%`;
}

export function formatTenureDays(days: number): string {
  if (days % 365 === 0) {
    const y = days / 365;
    return `${y} year${y > 1 ? "s" : ""}`;
  }
  if (days >= 30 && days % 30 === 0) {
    const m = days / 30;
    return `${m} month${m > 1 ? "s" : ""}`;
  }
  return `${days} days`;
}

export function productLabel(p: ProductType): string {
  switch (p) {
    case "FD":
      return "Fixed Deposit";
    case "SAVINGS":
      return "Savings Account";
    case "RD":
      return "Recurring Deposit";
  }
}

export function amountLabel(a: AmountThreshold): string {
  return a.label;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Data-freshness assessment for the whole dataset. */
export type FreshnessLevel = "fresh" | "aging" | "stale" | "unknown";

export interface Freshness {
  level: FreshnessLevel;
  ageDays: number | null;
  label: string;
}

/**
 * Classify how old the dataset is based on its `generatedAt` timestamp.
 * A stale result is the signal that the daily ingestion may have stalled.
 * Thresholds: fresh < 2 days, aging 2–7 days, stale > 7 days.
 */
export function assessFreshness(
  generatedAtIso: string,
  now: Date = new Date(),
): Freshness {
  const t = new Date(generatedAtIso).getTime();
  if (Number.isNaN(t))
    return { level: "unknown", ageDays: null, label: "Update time unknown" };
  const ageDays = Math.floor((now.getTime() - t) / 86400000);
  if (ageDays <= 1)
    return { level: "fresh", ageDays, label: relativeLabel(ageDays) };
  if (ageDays <= 7)
    return { level: "aging", ageDays, label: relativeLabel(ageDays) };
  return { level: "stale", ageDays, label: relativeLabel(ageDays) };
}

function relativeLabel(ageDays: number): string {
  if (ageDays <= 0) return "updated today";
  if (ageDays === 1) return "updated yesterday";
  if (ageDays < 7) return `updated ${ageDays} days ago`;
  if (ageDays < 14) return "updated over a week ago";
  if (ageDays < 60) return `updated ${Math.floor(ageDays / 7)} weeks ago`;
  return `updated ${Math.floor(ageDays / 30)} months ago`;
}

/**
 * Parse a human-typed amount into Rupees. Accepts plain/comma numbers and
 * shorthand like "5L", "5 lakh", "1.5cr", "2 crore", "50k". Null if unparseable.
 */
export function parseAmountInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/₹/g, "").trim();
  if (!s) return null;
  const m = s.match(
    /^([\d.]+)\s*(k|thousand|l|lac|lakh|lakhs|cr|crore|crores)?$/,
  );
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? "";
  let mult = 1;
  if (unit === "k" || unit === "thousand") mult = 1000;
  else if (/^(l|lac|lakh)/.test(unit)) mult = 100000;
  else if (/^(cr|crore)/.test(unit)) mult = 10000000;
  return Math.round(n * mult);
}

/** Full Indian-grouped amount, e.g. 500000 -> "₹5,00,000". */
export function formatINRFull(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

/**
 * FD maturity value with quarterly compounding (the Indian bank convention for
 * cumulative FDs). principal in ₹, annual rate in %, tenure in days.
 * Returns the maturity amount rounded to the nearest rupee.
 */
export function maturityValue(
  principal: number,
  annualRatePercent: number,
  tenureDays: number,
): number {
  const years = tenureDays / 365;
  const r = annualRatePercent / 100;
  const n = 4; // quarterly
  return Math.round(principal * Math.pow(1 + r / n, n * years));
}

/** Interest earned = maturity - principal. */
export function interestEarned(
  principal: number,
  annualRatePercent: number,
  tenureDays: number,
): number {
  return maturityValue(principal, annualRatePercent, tenureDays) - principal;
}
