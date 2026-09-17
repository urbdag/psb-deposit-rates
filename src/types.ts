/**
 * Domain model for Indian public-sector-bank deposit rates.
 *
 * The model is deliberately expressive because real deposit rates vary along
 * several axes at once:
 *   - product type (fixed / savings / recurring deposit)
 *   - tenure (a range of days, since banks quote buckets like "1 year to < 2 years")
 *   - deposit amount threshold (e.g. "below Rs 3 crore" vs bulk deposits)
 *   - customer category (general public vs senior citizen vs super-senior)
 *   - special/limited-period schemes ("special tenure" FDs)
 *
 * Every rate carries provenance (source URL + the date it was effective) so the
 * UI can be honest about where a number came from and how stale it may be.
 */

/** The three deposit product families this app tracks. */
export type ProductType = "FD" | "SAVINGS" | "RD";

/** Customer categories that attract different rates. */
export type CustomerCategory = "GENERAL" | "SENIOR" | "SUPER_SENIOR";

/** A public sector bank. */
export interface Bank {
  /** Stable slug used as an id, e.g. "sbi", "pnb". */
  id: string;
  /** Full display name, e.g. "State Bank of India". */
  name: string;
  /** Short label for compact UI, e.g. "SBI". */
  shortName: string;
  /** Brand/accent colour (hex) used in the UI. */
  color: string;
  /** Official website (informational only). */
  website: string;
}

/**
 * An inclusive-exclusive tenure range measured in days.
 * A one-sided range uses null for the open end.
 * Example: "1 year to < 2 years" => { minDays: 365, maxDays: 729 }.
 */
export interface TenureRange {
  minDays: number;
  /** null means "and above" (no upper bound). */
  maxDays: number | null;
  /** Human label as the bank quotes it, e.g. "1 year to less than 2 years". */
  label: string;
}

/**
 * An amount threshold in Indian Rupees.
 * Example: retail FDs "below Rs 3 crore" => { minAmount: 0, maxAmount: 30000000 }.
 */
export interface AmountThreshold {
  minAmount: number;
  /** null means "and above" (no upper bound). */
  maxAmount: number | null;
  label: string;
}

/** Provenance for a single rate figure. */
export interface RateSource {
  /** URL the rate was (or would be) sourced from. */
  url: string;
  /** ISO date (YYYY-MM-DD) the rate was effective / published. */
  effectiveDate: string;
  /**
   * "OFFICIAL"  - scraped/entered from the bank's own published schedule
   * "SAMPLE"    - representative placeholder data (NOT for financial decisions)
   */
  quality: "OFFICIAL" | "SAMPLE";
}

/**
 * A single rate line item.
 *
 * For FD/RD the tenure range is meaningful. For SAVINGS the tenure range is a
 * full-open range and the amount threshold (balance slab) is what matters.
 */
export interface RateEntry {
  bankId: string;
  product: ProductType;
  customer: CustomerCategory;
  /** Annual percentage rate, e.g. 7.25. */
  ratePercent: number;
  tenure: TenureRange;
  amount: AmountThreshold;
  /** Optional scheme name for special / limited-period products. */
  scheme?: string;
  source: RateSource;
}

/** The full dataset the app renders. */
export interface Dataset {
  banks: Bank[];
  rates: RateEntry[];
  /** ISO timestamp the dataset was assembled. */
  generatedAt: string;
  /** Overall data quality flag, surfaced prominently in the UI. */
  containsSampleData: boolean;
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export interface RateQuery {
  product: ProductType;
  customer: CustomerCategory;
  /** Amount the saver intends to deposit, in Rupees. */
  amount: number;
  /** Desired tenure in days (ignored for SAVINGS). */
  tenureDays?: number;
}

/** A ranked result row: the best applicable rate for a bank given a query. */
export interface RankedRate {
  rank: number;
  bank: Bank;
  entry: RateEntry;
}
