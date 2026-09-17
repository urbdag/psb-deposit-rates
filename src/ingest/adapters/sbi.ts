import type { BankRateAdapter } from "../adapter.js";
import type {
  AmountThreshold,
  RateEntry,
  RateSource,
  TenureRange,
} from "../../types.js";
import { fetchText } from "../http.js";
import {
  extractRows,
  extractTables,
  parsePercent,
  stripTags,
} from "../html.js";
import { parseTenure } from "../tenure.js";

/**
 * State Bank of India adapter — scrapes official rates for all three products:
 *   - FD  : retail (< ₹3 crore) domestic term-deposit table, incl. the 444-day
 *           "Amrit Vrishti" special tenure that SBI lists inline in that table.
 *   - RD  : SBI sets Recurring Deposit rates equal to the FD "card rate" for the
 *           matching tenure, so RD rows are derived from the scraped FD buckets.
 *   - SAVINGS : flat rate read from SBI's savings-account page.
 *
 * Design notes
 * ------------
 * - No external deps: global fetch + dependency-free HTML helpers → runs in CI
 *   with no install step.
 * - Resilient table location: pick the table whose rows parse as
 *   (tenure, general%, senior%), not brittle CSS selectors.
 * - Pure parsers (`parseFdRd`, `parseSavings`) are split from network fetches so
 *   they are unit-testable with fixture HTML. See scripts/test-sbi-adapter.mjs.
 *
 * Per-product resilience: each product is fetched independently and failures are
 * swallowed per product (returning [] for that product) so a change to, say, the
 * savings page never blocks the FD scrape. The ingest runner then merges by
 * product and keeps last-known-good for any product that yields nothing.
 */
export class SbiAdapter implements BankRateAdapter {
  readonly bankId = "sbi";

  static readonly FD_URL =
    "https://sbi.co.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits";
  static readonly SAVINGS_URL =
    "https://sbi.co.in/web/interest-rates/deposit-rates/savings-bank-rate";

  private readonly retail: AmountThreshold = {
    minAmount: 0,
    maxAmount: 30000000,
    label: "Below ₹3 crore (retail)",
  };
  private readonly anyAmount: AmountThreshold = {
    minAmount: 0,
    maxAmount: null,
    label: "Any amount",
  };
  private readonly allBalances: AmountThreshold = {
    minAmount: 0,
    maxAmount: null,
    label: "All balances",
  };

  async fetchRates(): Promise<RateEntry[]> {
    const out: RateEntry[] = [];

    // FD + RD (RD derived from FD). Failure here is a hard failure for the bank
    // (FD is the core product) — throw so the runner keeps last-known-good.
    const fdHtml = await fetchText(SbiAdapter.FD_URL);
    const fdEff = extractEffectiveDate(fdHtml) ?? today();
    const fdRd = this.parseFdRd(fdHtml, fdEff);
    if (fdRd.length === 0) {
      throw new Error(
        "SbiAdapter: no FD rates parsed (page structure may have changed)",
      );
    }
    out.push(...fdRd);

    // Savings — best-effort; never let it break the FD/RD scrape.
    try {
      const savHtml = await fetchText(SbiAdapter.SAVINGS_URL);
      const savEff = extractEffectiveDate(savHtml) ?? fdEff;
      out.push(...this.parseSavings(savHtml, savEff));
    } catch {
      // Leave savings to last-known-good via the ingest merge.
    }

    return out;
  }

  /**
   * Pure parser for FD (+ derived RD) from the retail term-deposit page.
   * Standard multi-day buckets become FD + RD; single-day tenures (e.g. the
   * 444-day Amrit Vrishti) become FD-only special-scheme rows.
   */
  parseFdRd(html: string, effectiveDate: string): RateEntry[] {
    const source: RateSource = {
      url: SbiAdapter.FD_URL,
      effectiveDate,
      quality: "OFFICIAL",
    };
    const table = this.findRateTable(html);
    if (!table) return [];

    const out: RateEntry[] = [];
    for (const row of table) {
      const tenure = parseTenure(row.tenureText);
      if (!tenure) continue;

      const isSpecial = isSingleDayTenure(tenure);
      const scheme = isSpecial ? detectScheme(row.tenureText) : undefined;

      // FD (general + senior)
      out.push(this.fd("GENERAL", row.general, tenure, source, scheme));
      if (row.senior != null)
        out.push(this.fd("SENIOR", row.senior, tenure, source, scheme));

      // RD tracks the FD card rate for the SAME standard tenure (not specials).
      // SBI offers RD for tenures of 1 year and above.
      if (!isSpecial && tenure.minDays >= 365) {
        out.push(this.rd("GENERAL", row.general, tenure, source));
        if (row.senior != null)
          out.push(this.rd("SENIOR", row.senior, tenure, source));
      }
    }
    return out;
  }

  /** Pure parser: extract the flat SBI savings rate from the savings page. */
  parseSavings(html: string, effectiveDate: string): RateEntry[] {
    const source: RateSource = {
      url: SbiAdapter.SAVINGS_URL,
      effectiveDate,
      quality: "OFFICIAL",
    };
    const rate = extractSavingsRate(html);
    if (rate == null) return [];
    // SBI savings is a single flat rate across all balances, no senior add-on.
    return [
      {
        bankId: this.bankId,
        product: "SAVINGS",
        customer: "GENERAL",
        ratePercent: rate,
        tenure: { minDays: 0, maxDays: null, label: "Any tenure" },
        amount: this.allBalances,
        source,
      },
      {
        bankId: this.bankId,
        product: "SAVINGS",
        customer: "SENIOR",
        ratePercent: rate,
        tenure: { minDays: 0, maxDays: null, label: "Any tenure" },
        amount: this.allBalances,
        source,
      },
    ];
  }

  private fd(
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
      amount: this.retail,
      ...(scheme ? { scheme } : {}),
      source,
    };
  }

  private rd(
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
      amount: this.anyAmount,
      source,
    };
  }

  /**
   * Scan all tables; return the first whose data rows look like
   * (tenure text, general %, senior %). Requires ≥3 valid rows to avoid
   * matching an unrelated 3-column table.
   */
  private findRateTable(
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
        if (!tenure) continue; // header rows / non-tenure rows skipped
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
}

function isSingleDayTenure(t: TenureRange): boolean {
  return t.maxDays != null && t.minDays === t.maxDays;
}

/** Name known SBI special schemes from the tenure label; generic otherwise. */
function detectScheme(tenureText: string): string {
  const t = tenureText.toLowerCase();
  if (t.includes("amrit vrishti") || /\b444\b/.test(t))
    return "Amrit Vrishti 444 days";
  const m = tenureText.match(/(\d+)\s*days?/i);
  return m ? `${m[1]}-day Special` : "Special Tenure";
}

/**
 * Extract the flat savings rate. SBI states it in prose / a small table like
 * "2.50% p.a.". Take the first plausible savings percentage (0.5–5%).
 */
function extractSavingsRate(html: string): number | null {
  const text = stripTags(html);
  // Prefer a value adjacent to "p.a." to avoid grabbing unrelated numbers.
  const near = text.match(/(\d(?:\.\d{1,2})?)\s*%\s*p\.?\s*a\.?/i);
  const candidate = near ? parsePercent(near[0]) : parsePercent(text);
  if (candidate == null) return null;
  return candidate >= 0.5 && candidate <= 5 ? candidate : null;
}

/** Read an "w.e.f. <date>" / "effective <date>" string off the page. */
function extractEffectiveDate(html: string): string | null {
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
