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

/** A bank tracked by the app (public-sector or private-sector). */
export interface Bank {
  /** Stable slug used as an id, e.g. "sbi", "pnb". */
  id: string;
  /**
   * Sector category the bank belongs to:
   *   "PUBLIC"        - public sector / nationalised bank (majority GoI-owned)
   *   "PRIVATE"       - private sector bank
   *   "SMALL_FINANCE" - RBI-licensed scheduled small finance bank; deposits
   *                     DICGC-insured but NOT Government-of-India owned
   *   "PAYMENTS_BANK" - RBI-licensed payments bank; savings-account deposits
   *                     only (no FD/RD) with a per-customer balance cap
   *                     (currently ~Rs 2 lakh). Deposits DICGC-insured up to
   *                     Rs 5,00,000 but (except India Post Payments Bank,
   *                     which is Government-of-India owned via India Post)
   *                     NOT Government-of-India owned.
   * Used to segment rankings and peer-averages so a small finance FD is never
   * compared head-to-head against a PSU or private FD.
   */
  category: "PUBLIC" | "PRIVATE" | "SMALL_FINANCE" | "PAYMENTS_BANK";
  /** Full display name, e.g. "State Bank of India". */
  name: string;
  /** Short label for compact UI, e.g. "SBI". */
  shortName: string;
  /** Brand/accent colour (hex) used in the UI. */
  color: string;
  /** Official website (informational only). */
  website: string;
  /** City of headquarters (sourced fact). */
  headquarters?: string;
  /** Year the bank was established/founded (sourced fact). */
  established?: number;
  /**
   * Approximate branch count. A rounded, widely-published public figure used
   * only for the profile-page "institution snapshot"; NOT an exact number.
   * Omit for banks where a confident figure is not known.
   */
  branches?: number;
  /**
   * Approximate ATM/cash-recycler count. A rounded, widely-published public
   * figure used only for the profile-page snapshot; NOT exact. Omit if unknown.
   */
  atms?: number;
  /**
   * Approximate total business (deposits + advances) in Rs crore. The commonly
   * published PSU headline figure; rounded and approximate, used only for the
   * profile-page snapshot. Omit for banks where a confident figure is unknown.
   */
  totalBusinessCrore?: number;
  /**
   * Approximate total assets in Rs crore. Optional companion to
   * totalBusinessCrore; rounded, approximate public figure. Omit if unknown.
   */
  assetsCrore?: number;
  /**
   * Ownership descriptor, e.g. "Government of India (majority stakeholder)".
   * A definitional fact for the 12 PSU banks (not a guessed figure).
   */
  ownership?: string;
  /**
   * The year the approximate snapshot figures (branches/atms/totalBusinessCrore)
   * are "as of", surfaced in the UI so readers know their vintage.
   */
  statsAsOf?: number;
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
   * "OFFICIAL"   - scraped from the bank's own published rate page
   * "AGGREGATOR"  - compiled from a third-party aggregator / news source
   * "SAMPLE"     - representative placeholder data (NOT for financial decisions)
   */
  quality: "OFFICIAL" | "AGGREGATOR" | "SAMPLE";
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
  /**
   * Optional sector filter. When set, only banks of this category are ranked
   * ("PUBLIC", "PRIVATE", "SMALL_FINANCE" or "PAYMENTS_BANK").
   * When omitted, banks of all categories are ranked (unchanged behaviour).
   */
  category?: "PUBLIC" | "PRIVATE" | "SMALL_FINANCE" | "PAYMENTS_BANK";
}

/** A ranked result row: the best applicable rate for a bank given a query. */
export interface RankedRate {
  rank: number;
  bank: Bank;
  entry: RateEntry;
}
