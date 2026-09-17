import type {
  AmountThreshold,
  CustomerCategory,
  RateEntry,
  RateSource,
  TenureRange,
} from "../types.js";
import { BANKS } from "./banks.js";

/**
 * ============================================================================
 *  SAMPLE DATA — READ THIS
 * ============================================================================
 * The rates below are REPRESENTATIVE PLACEHOLDER VALUES used to demonstrate the
 * product end to end. They are structured exactly like real data and are
 * plausible for the 2025–2026 rate environment, but they are NOT scraped from
 * the banks and MUST NOT be used to make financial decisions.
 *
 * To go live, replace these with official figures via the ingestion layer
 * (see src/ingest/). Each entry already carries a `source` with quality
 * "SAMPLE"; official ingestion should stamp quality "OFFICIAL" with the real
 * source URL and effective date.
 * ============================================================================
 */

const SAMPLE_DATE = "2026-01-01";

function sampleSource(bankId: string): RateSource {
  const bank = BANKS.find((b) => b.id === bankId);
  return {
    url: bank ? bank.website : "https://www.rbi.org.in",
    effectiveDate: SAMPLE_DATE,
    quality: "SAMPLE",
  };
}

// --- Reusable range definitions -------------------------------------------

const FULL_TENURE: TenureRange = {
  minDays: 0,
  maxDays: null,
  label: "Any tenure",
};

// Retail: below Rs 3 crore. Bulk: Rs 3 crore and above.
const RETAIL: AmountThreshold = {
  minAmount: 0,
  maxAmount: 30000000,
  label: "Below ₹3 crore (retail)",
};
const BULK: AmountThreshold = {
  minAmount: 30000000,
  maxAmount: null,
  label: "₹3 crore & above (bulk)",
};
const ANY_AMOUNT: AmountThreshold = {
  minAmount: 0,
  maxAmount: null,
  label: "Any amount",
};

// Standard FD tenure buckets (days), matching how banks commonly quote them.
const FD_BUCKETS: TenureRange[] = [
  { minDays: 7, maxDays: 45, label: "7–45 days" },
  { minDays: 46, maxDays: 90, label: "46–90 days" },
  { minDays: 91, maxDays: 180, label: "91–180 days" },
  { minDays: 181, maxDays: 364, label: "181 days to < 1 year" },
  { minDays: 365, maxDays: 729, label: "1 year to < 2 years" },
  { minDays: 730, maxDays: 1094, label: "2 years to < 3 years" },
  { minDays: 1095, maxDays: 1824, label: "3 years to < 5 years" },
  { minDays: 1825, maxDays: 3650, label: "5 years to 10 years" },
];

// RD tenure buckets.
const RD_BUCKETS: TenureRange[] = [
  { minDays: 365, maxDays: 729, label: "1 year to < 2 years" },
  { minDays: 730, maxDays: 1094, label: "2 years to < 3 years" },
  { minDays: 1095, maxDays: 1824, label: "3 years to < 5 years" },
  { minDays: 1825, maxDays: 3650, label: "5 years to 10 years" },
];

// Savings balance slabs.
const SAVINGS_SLABS: AmountThreshold[] = [
  { minAmount: 0, maxAmount: 10000000, label: "Below ₹1 crore" },
  { minAmount: 10000000, maxAmount: null, label: "₹1 crore & above" },
];

const SENIOR_ADDON = 0.5; // percentage points added for senior citizens
const SUPER_SENIOR_ADDON = 0.75; // for super-senior (80+) where offered

/**
 * Per-bank "general public, retail" FD base curve keyed by bucket index.
 * Values are plausible-but-fictional. Peaks are typically at 1–3 year buckets.
 */
const FD_BASE: Record<string, number[]> = {
  //         7-45  46-90 91-180 181-364 1-2yr 2-3yr 3-5yr 5-10yr
  sbi: [3.3, 4.5, 5.25, 6.0, 6.8, 7.0, 6.75, 6.5],
  pnb: [3.5, 4.5, 5.5, 6.25, 6.85, 7.05, 6.6, 6.5],
  bob: [4.25, 5.25, 5.6, 6.25, 6.85, 7.15, 6.8, 6.5],
  canara: [4.0, 5.25, 5.5, 6.15, 6.85, 7.2, 6.8, 6.7],
  union: [3.5, 4.75, 5.5, 6.3, 6.9, 6.6, 6.7, 6.55],
  boi: [3.0, 4.5, 5.0, 6.0, 6.8, 7.25, 6.5, 6.5],
  indian: [3.0, 4.5, 5.25, 6.1, 6.9, 6.7, 6.25, 6.25],
  central: [3.5, 4.75, 5.5, 6.25, 6.85, 6.75, 6.5, 6.5],
  iob: [4.0, 5.0, 5.5, 6.1, 6.9, 7.3, 6.5, 6.5],
  uco: [3.0, 4.5, 5.5, 6.0, 6.8, 6.6, 6.3, 6.2],
  maha: [3.5, 4.6, 5.5, 6.25, 7.0, 6.75, 6.5, 6.5],
  psb: [4.0, 5.05, 5.75, 6.3, 6.95, 6.6, 6.3, 6.3],
};

/** Per-bank savings account rates by slab index [below 1cr, 1cr+]. */
const SAVINGS_RATES: Record<string, [number, number]> = {
  sbi: [2.7, 3.0],
  pnb: [2.7, 3.0],
  bob: [2.75, 3.05],
  canara: [2.9, 3.1],
  union: [2.75, 3.1],
  boi: [2.75, 2.9],
  indian: [2.75, 2.8],
  central: [2.8, 3.35],
  iob: [3.0, 3.3],
  uco: [2.75, 2.9],
  maha: [2.75, 3.0],
  psb: [2.8, 3.1],
};

/** One "special / limited-period" FD per bank to exercise scheme handling. */
const SPECIAL_FDS: {
  bankId: string;
  days: number;
  label: string;
  rate: number;
  scheme: string;
}[] = [
  {
    bankId: "sbi",
    days: 444,
    label: "444 days (Amrit Vrishti)",
    rate: 7.25,
    scheme: "Amrit Vrishti 444 days",
  },
  {
    bankId: "bob",
    days: 400,
    label: "400 days (bob Utsav)",
    rate: 7.3,
    scheme: "bob Utsav 400 days",
  },
  {
    bankId: "boi",
    days: 400,
    label: "400 days special",
    rate: 7.3,
    scheme: "400-day Special",
  },
  {
    bankId: "iob",
    days: 444,
    label: "444 days special",
    rate: 7.3,
    scheme: "444-day Special",
  },
  {
    bankId: "union",
    days: 456,
    label: "456 days special",
    rate: 7.3,
    scheme: "456-day Special",
  },
  {
    bankId: "canara",
    days: 444,
    label: "444 days special",
    rate: 7.25,
    scheme: "444-day Special",
  },
];

function withCategory(base: number, category: CustomerCategory): number {
  if (category === "SENIOR") return round2(base + SENIOR_ADDON);
  if (category === "SUPER_SENIOR") return round2(base + SUPER_SENIOR_ADDON);
  return round2(base);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CATEGORIES: CustomerCategory[] = ["GENERAL", "SENIOR", "SUPER_SENIOR"];

function buildRates(): RateEntry[] {
  const entries: RateEntry[] = [];

  for (const bank of BANKS) {
    const src = sampleSource(bank.id);

    // ---- Fixed Deposits: standard buckets x categories x (retail + bulk) ----
    const curve = FD_BASE[bank.id];
    FD_BUCKETS.forEach((bucket, i) => {
      for (const category of CATEGORIES) {
        // Super-senior only meaningfully differs on longer tenures; still list it.
        entries.push({
          bankId: bank.id,
          product: "FD",
          customer: category,
          ratePercent: withCategory(curve[i], category),
          tenure: bucket,
          amount: RETAIL,
          source: src,
        });
      }
      // Bulk deposits: senior add-on generally does NOT apply; slightly lower.
      entries.push({
        bankId: bank.id,
        product: "FD",
        customer: "GENERAL",
        ratePercent: round2(curve[i] - 0.15),
        tenure: bucket,
        amount: BULK,
        source: src,
      });
    });

    // ---- Special / limited-period FDs (retail only) ----
    const special = SPECIAL_FDS.find((s) => s.bankId === bank.id);
    if (special) {
      const tenure: TenureRange = {
        minDays: special.days,
        maxDays: special.days,
        label: special.label,
      };
      for (const category of CATEGORIES) {
        entries.push({
          bankId: bank.id,
          product: "FD",
          customer: category,
          ratePercent: withCategory(special.rate, category),
          tenure,
          amount: RETAIL,
          scheme: special.scheme,
          source: src,
        });
      }
    }

    // ---- Savings account: slabs x (general + senior share same rate) ----
    const [slab0, slab1] = SAVINGS_RATES[bank.id];
    const savingsBySlab = [slab0, slab1];
    SAVINGS_SLABS.forEach((slab, i) => {
      // Savings rates typically do not carry a senior add-on; list GENERAL + SENIOR equal.
      for (const category of ["GENERAL", "SENIOR"] as CustomerCategory[]) {
        entries.push({
          bankId: bank.id,
          product: "SAVINGS",
          customer: category,
          ratePercent: round2(savingsBySlab[i]),
          tenure: FULL_TENURE,
          amount: slab,
          source: src,
        });
      }
    });

    // ---- Recurring Deposits: buckets x categories, any amount ----
    // RD rates broadly track the matching FD bucket; reuse the FD curve tail.
    RD_BUCKETS.forEach((bucket) => {
      // Map RD bucket to the FD curve index by matching minDays.
      const fdIndex = FD_BUCKETS.findIndex((b) => b.minDays === bucket.minDays);
      const baseRate = curve[fdIndex] ?? curve[curve.length - 1];
      for (const category of CATEGORIES) {
        entries.push({
          bankId: bank.id,
          product: "RD",
          customer: category,
          ratePercent: withCategory(baseRate, category),
          tenure: bucket,
          amount: ANY_AMOUNT,
          source: src,
        });
      }
    });
  }

  return entries;
}

export const RATES: RateEntry[] = buildRates();
