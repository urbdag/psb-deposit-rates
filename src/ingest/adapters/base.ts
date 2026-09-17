import type { BankRateAdapter } from "../adapter.js";
import type {
  AmountThreshold,
  RateEntry,
  RateSource,
  TenureRange,
} from "../../types.js";
import { fetchText } from "../http.js";
import { fetchRendered } from "../render.js";
import {
  extractRows,
  extractTables,
  parsePercent,
  stripTags,
} from "../html.js";
import { parseTenure } from "../tenure.js";

/**
 * Reusable scraper base for PSU-bank rate pages.
 * -------------------------------------------------------------------------
 * Most public-sector banks publish deposit rates as a simple server-rendered
 * table of (tenure, general %, senior %). This base implements the whole
 * pipeline — fetch, locate the rate table *by content* (not brittle CSS),
 * parse FD rows, derive RD from FD card rates, and read a flat savings rate —
 * driven by a small per-bank `TableAdapterConfig`. A new bank is usually just
 * a config: URLs + optional scheme hints.
 *
 * Zero external deps (global fetch + dependency-free HTML helpers) so it runs
 * in CI with no install step. Pure parsers (`parseFdRd`, `parseSavings`) are
 * split from network fetches for unit testing with fixture HTML.
 *
 * Per-product resilience: FD is the core product and a hard failure (throws) so
 * the ingest runner keeps last-known-good for the whole bank; savings is
 * best-effort and never blocks FD/RD. The runner merges by product.
 */
export interface TableAdapterConfig {
  bankId: string;
  /** FD/term-deposit page URL(s), tried in order (retail, below ₹3 crore). */
  fdUrl: string | string[];
  /** Candidate savings-rate page URLs, tried in order (first hit wins). */
  savingsUrls?: string[];
  /** Whether RD rates track the FD card rate (true for most PSU banks). */
  deriveRdFromFd?: boolean;
  /** Minimum tenure (days) a bank offers RD for. Default 365 (1 year). */
  rdMinDays?: number;
  /** Map a special single-day tenure label → a scheme name. */
  schemeNamer?: (tenureText: string) => string | undefined;
  /**
   * If true, when a plain HTTP fetch of a URL yields no rate table, retry that
   * URL with a headless browser (Playwright) to render client-side content.
   * Requires Playwright to be installed (it is in the ingest CI job).
   */
  renderJs?: boolean;
}

const RETAIL: AmountThreshold = {
  minAmount: 0,
  maxAmount: 30000000,
  label: "Below ₹3 crore (retail)",
};
const ANY_AMOUNT: AmountThreshold = {
  minAmount: 0,
  maxAmount: null,
  label: "Any amount",
};
const ALL_BALANCES: AmountThreshold = {
  minAmount: 0,
  maxAmount: null,
  label: "All balances",
};

export class TableRateAdapter implements BankRateAdapter {
  readonly bankId: string;
  protected readonly cfg: Required<
    Pick<
      TableAdapterConfig,
      "bankId" | "fdUrl" | "deriveRdFromFd" | "rdMinDays"
    >
  > &
    TableAdapterConfig;

  constructor(config: TableAdapterConfig) {
    this.bankId = config.bankId;
    this.cfg = {
      deriveRdFromFd: true,
      rdMinDays: 365,
      savingsUrls: [],
      ...config,
    };
  }

  async fetchRates(): Promise<RateEntry[]> {
    const out: RateEntry[] = [];

    // Try each FD URL candidate until one yields parseable rows.
    const fdUrls = Array.isArray(this.cfg.fdUrl)
      ? this.cfg.fdUrl
      : [this.cfg.fdUrl];
    let fdRd: RateEntry[] = [];
    const attempts: string[] = [];
    for (const url of fdUrls) {
      // 1) Plain HTTP fetch first (fast, no browser).
      try {
        const fdHtml = await fetchText(url);
        const parsed = this.parseFdRd(
          fdHtml,
          extractEffectiveDate(fdHtml) ?? today(),
          url,
        );
        if (parsed.length > 0) {
          fdRd = parsed;
          break;
        }
        attempts.push(`${url} -> 0 rows (http)`);
      } catch (e) {
        attempts.push(`${url} -> ${String(e)} (http)`);
      }
      // 2) If configured, retry with a headless browser (renders JS, passes
      //    many bot checks). Only reached when plain HTTP didn't yield rows.
      if (this.cfg.renderJs) {
        try {
          const fdHtml = await fetchRendered(url);
          const parsed = this.parseFdRd(
            fdHtml,
            extractEffectiveDate(fdHtml) ?? today(),
            url,
          );
          if (parsed.length > 0) {
            fdRd = parsed;
            break;
          }
          attempts.push(`${url} -> 0 rows (rendered)`);
        } catch (e) {
          attempts.push(`${url} -> ${String(e)} (rendered)`);
        }
      }
    }
    if (fdRd.length === 0) {
      throw new Error(
        `${this.bankId}: no FD rates from any candidate URL:\n    ` +
          attempts.join("\n    "),
      );
    }
    out.push(...fdRd);
    const fdEff = fdRd[0].source.effectiveDate;

    for (const url of this.cfg.savingsUrls ?? []) {
      let done = false;
      try {
        const savHtml = await fetchText(url);
        const savings = this.parseSavings(
          savHtml,
          extractEffectiveDate(savHtml) ?? fdEff,
          url,
        );
        if (savings.length > 0) {
          out.push(...savings);
          done = true;
        }
      } catch {
        // fall through to rendered attempt / next candidate
      }
      if (!done && this.cfg.renderJs) {
        try {
          const savHtml = await fetchRendered(url);
          const savings = this.parseSavings(
            savHtml,
            extractEffectiveDate(savHtml) ?? fdEff,
            url,
          );
          if (savings.length > 0) {
            out.push(...savings);
            done = true;
          }
        } catch {
          // ingest keeps last-known-good if all candidates fail
        }
      }
      if (done) break;
    }

    return out;
  }

  /** Pure parser: FD (+ derived RD) from a term-deposit page. Unit-testable. */
  parseFdRd(html: string, effectiveDate: string, url?: string): RateEntry[] {
    const fdUrl =
      url ??
      (Array.isArray(this.cfg.fdUrl) ? this.cfg.fdUrl[0] : this.cfg.fdUrl);
    const source: RateSource = {
      url: fdUrl,
      effectiveDate,
      quality: "OFFICIAL",
    };
    const table = findRateTable(html);
    if (!table) return [];

    const out: RateEntry[] = [];
    for (const row of table) {
      const tenure = parseTenure(row.tenureText);
      if (!tenure) continue;

      const isSpecial = isSingleDayTenure(tenure);
      const scheme = isSpecial
        ? (this.cfg.schemeNamer?.(row.tenureText) ??
          defaultScheme(row.tenureText))
        : undefined;

      out.push(this.fd("GENERAL", row.general, tenure, source, scheme));
      if (row.senior != null)
        out.push(this.fd("SENIOR", row.senior, tenure, source, scheme));

      if (
        this.cfg.deriveRdFromFd &&
        !isSpecial &&
        tenure.minDays >= this.cfg.rdMinDays
      ) {
        out.push(this.rd("GENERAL", row.general, tenure, source));
        if (row.senior != null)
          out.push(this.rd("SENIOR", row.senior, tenure, source));
      }
    }
    return out;
  }

  /** Pure parser: flat savings rate. Unit-testable. */
  parseSavings(html: string, effectiveDate: string, url?: string): RateEntry[] {
    const firstFd = Array.isArray(this.cfg.fdUrl)
      ? this.cfg.fdUrl[0]
      : this.cfg.fdUrl;
    const source: RateSource = {
      url: url ?? this.cfg.savingsUrls?.[0] ?? firstFd,
      effectiveDate,
      quality: "OFFICIAL",
    };
    const rate = extractSavingsRate(html);
    if (rate == null) return [];
    const base = {
      bankId: this.bankId,
      product: "SAVINGS" as const,
      ratePercent: rate,
      tenure: { minDays: 0, maxDays: null, label: "Any tenure" } as TenureRange,
      amount: ALL_BALANCES,
      source,
    };
    return [
      { ...base, customer: "GENERAL" as const },
      { ...base, customer: "SENIOR" as const },
    ];
  }

  protected fd(
    customer: "GENERAL" | "SENIOR",
    ratePercent: number,
    tenure: TenureRange,
    source: RateSource,
    scheme?: string,
  ): RateEntry {
    return {
      bankId: this.bankId,
      product: "FD",
      customer,
      ratePercent,
      tenure,
      amount: RETAIL,
      ...(scheme ? { scheme } : {}),
      source,
    };
  }

  protected rd(
    customer: "GENERAL" | "SENIOR",
    ratePercent: number,
    tenure: TenureRange,
    source: RateSource,
  ): RateEntry {
    return {
      bankId: this.bankId,
      product: "RD",
      customer,
      ratePercent,
      tenure,
      amount: ANY_AMOUNT,
      source,
    };
  }
}

// --- shared helpers --------------------------------------------------------

export function isSingleDayTenure(t: TenureRange): boolean {
  return t.maxDays != null && t.minDays === t.maxDays;
}

/** Generic special-scheme namer from a tenure label. */
export function defaultScheme(tenureText: string): string {
  const m = tenureText.match(/(\d+)\s*days?/i);
  return m ? `${m[1]}-day Special` : "Special Tenure";
}

/**
 * Scan all tables; return the first whose rows look like
 * (tenure text, general %, senior %). Requires ≥3 valid rows.
 */
export function findRateTable(
  html: string,
): { tenureText: string; general: number; senior: number | null }[] | null {
  for (const table of extractTables(html)) {
    const parsed: {
      tenureText: string;
      general: number;
      senior: number | null;
    }[] = [];
    for (const cells of extractRows(table)) {
      if (cells.length < 2) continue;
      const tenure = parseTenure(cells[0]);
      if (!tenure) continue;
      const pcts = cells
        .slice(1)
        .map((c) => parsePercent(c))
        .filter((n): n is number => n != null);
      if (pcts.length === 0) continue;
      parsed.push({
        tenureText: cells[0],
        general: pcts[0],
        senior: pcts.length > 1 ? pcts[1] : null,
      });
    }
    if (parsed.length >= 3) return parsed;
  }
  return null;
}

export function extractSavingsRate(html: string): number | null {
  const text = stripTags(html);
  const near = text.match(/(\d(?:\.\d{1,2})?)\s*%\s*p\.?\s*a\.?/i);
  const candidate = near ? parsePercent(near[0]) : parsePercent(text);
  if (candidate == null) return null;
  return candidate >= 0.5 && candidate <= 5 ? candidate : null;
}

export function extractEffectiveDate(html: string): string | null {
  const text = html.replace(/<[^>]*>/g, " ");
  const m = text.match(
    /(?:w\.?e\.?f\.?|effective(?:\s+from)?)\s*:?\s*(\d{1,2})[.\-/\s]([A-Za-z]+|\d{1,2})[.\-/\s](\d{2,4})/i,
  );
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  let month = m[2];
  if (/[A-Za-z]/.test(month)) {
    month = months[month.slice(0, 3).toLowerCase()] ?? "01";
  } else {
    month = month.padStart(2, "0");
  }
  return `${year}-${month}-${day}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
