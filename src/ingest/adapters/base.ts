import type { BankRateAdapter } from "../adapter.js";
import type {
  AmountThreshold,
  RateEntry,
  RateSource,
  TenureRange,
} from "../../types.js";
import { fetchText } from "../http.js";
import { fetchRendered } from "../render.js";
import { fetchPdfText } from "../pdf.js";
import { parsePdfRates } from "../pdf-rates.js";
import {
  extractRows,
  extractTables,
  htmlToText,
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
 * best-effort and never blocks FD/RD. An FD failure is deferred, not fatal on
 * its own: savings is always attempted and a savings-only success is still
 * published. The throw fires only when BOTH FD and savings yield nothing. The
 * runner merges by product.
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
  /**
   * PDF rate-card URL(s), tried in order. Used when a bank publishes rates only
   * as a linked PDF (so the HTML page has no table). Tried AFTER html/render
   * candidates fail. Requires `pdf-parse` (installed in the ingest CI job).
   */
  pdfUrl?: string | string[];
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
          // Table parse failed — some banks lay rates out in <div>s, not a
          // <table>. Fall back to the flat-text (PDF-style) line parser on the
          // rendered page's visible text.
          const textParsed = this.parseTextFdRd(
            htmlToText(fdHtml),
            url,
            extractEffectiveDate(fdHtml) ?? today(),
          );
          if (textParsed.length > 0) {
            fdRd = textParsed;
            break;
          }
          attempts.push(`${url} -> 0 rows (rendered); ${diagnoseHtml(fdHtml)}`);
        } catch (e) {
          attempts.push(`${url} -> ${String(e)} (rendered)`);
        }
      }
    }

    // 3) PDF rate-card fallback: if no HTML/rendered URL yielded rows, try any
    //    configured PDF rate cards.
    if (fdRd.length === 0 && this.cfg.pdfUrl) {
      const pdfUrls = Array.isArray(this.cfg.pdfUrl)
        ? this.cfg.pdfUrl
        : [this.cfg.pdfUrl];
      for (const url of pdfUrls) {
        try {
          const parsed = await this.fetchPdfFdRd(url);
          if (parsed.length > 0) {
            fdRd = parsed;
            break;
          }
          attempts.push(`${url} -> 0 rows (pdf)`);
        } catch (e) {
          attempts.push(`${url} -> ${String(e)} (pdf)`);
        }
      }
    }

    // FD is the core product and a hard failure normally throws so the ingest
    // runner keeps last-known-good for the whole bank. But savings is a
    // separate, best-effort product: an FD failure must NOT abort the savings
    // scrape. So we defer the throw — collect FD rows if any, then always
    // attempt savings. We only throw when BOTH FD and savings yielded nothing.
    if (fdRd.length > 0) out.push(...fdRd);
    // Effective date passed to parseSavings: prefer the FD date when FD
    // succeeded, otherwise fall back to the savings page's own date (below).
    const fdEff = fdRd.length > 0 ? fdRd[0].source.effectiveDate : null;

    for (const url of this.cfg.savingsUrls ?? []) {
      let done = false;
      try {
        const savHtml = await fetchText(url);
        const savings = this.parseSavings(
          savHtml,
          extractEffectiveDate(savHtml) ?? fdEff ?? today(),
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
            extractEffectiveDate(savHtml) ?? fdEff ?? today(),
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

    // Only a total washout (no FD *and* no savings) is a hard failure. A
    // savings-only success is still published rather than lost to the FD throw.
    if (out.length === 0) {
      throw new Error(
        `${this.bankId}: no FD rates from any candidate URL:\n    ` +
          attempts.join("\n    "),
      );
    }

    return out;
  }

  /**
   * Pure parser: FD (+ derived RD) from flat page/PDF text using the
   * line-based parser. Used for div-based pages (no <table>) and PDFs.
   */
  parseTextFdRd(
    text: string,
    url: string,
    effectiveDate?: string,
  ): RateEntry[] {
    const source: RateSource = {
      url,
      effectiveDate: effectiveDate ?? extractEffectiveDate(text) ?? today(),
      quality: "OFFICIAL",
    };
    return parsePdfRates(text, {
      bankId: this.bankId,
      source,
      amount: RETAIL,
      rdMinDays: this.cfg.deriveRdFromFd ? this.cfg.rdMinDays : 0,
      schemeNamer: this.cfg.schemeNamer,
    });
  }

  /** Fetch a PDF rate card and parse FD (+ derived RD) rows from its text. */
  async fetchPdfFdRd(url: string): Promise<RateEntry[]> {
    const text = await fetchPdfText(url);
    return this.parsePdfFdRd(text, url);
  }

  /** Pure parser: FD (+ derived RD) from PDF rate-card text. Unit-testable. */
  parsePdfFdRd(text: string, url: string, effectiveDate?: string): RateEntry[] {
    return this.parseTextFdRd(text, url, effectiveDate);
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
    // Sanity guard: a genuine FD rate card has several tenure buckets. If we
    // parsed fewer than 4 distinct FD tenures, we almost certainly latched onto
    // the wrong table (e.g. a footnotes/terms table). Reject so the ingest
    // runner keeps last-known-good instead of publishing junk as "official".
    const fdTenures = new Set(
      out
        .filter((r) => r.product === "FD")
        .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
    );
    if (fdTenures.size < 4) return [];
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

/**
 * A "special" single-value tenure is an exact day-count that is NOT a standard
 * round tenure. Banks quote plain "1 Year" / "2 Years" as single values too;
 * those parse to 365/730 and must NOT be treated as special schemes. Only odd
 * day counts (e.g. 400, 444, 555, 999) are genuine special-tenure products.
 */
export function isSingleDayTenure(t: TenureRange): boolean {
  if (t.maxDays == null || t.minDays !== t.maxDays) return false;
  const d = t.minDays;
  // Standard round tenures: whole months (×30) or whole years (×365).
  const isRoundYear = d % 365 === 0;
  const isRoundMonth = d % 30 === 0;
  return !(isRoundYear || isRoundMonth);
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
/**
 * Diagnostic: summarise a page's tables so a "0 rows" failure is debuggable
 * from CI logs — how many tables, their row/col shape, and a sample first row.
 */
export function diagnoseHtml(html: string): string {
  const tables = extractTables(html);
  const pctSamples = (
    htmlToText(html).match(/\d{1,2}\.\d{1,2}\s*%/g) ?? []
  ).slice(0, 6);
  if (tables.length === 0) {
    const pdfLinks = (html.match(/href="[^"]*\.pdf[^"]*"/gi) ?? []).slice(0, 3);
    return `no <table>; ${html.length} chars; pcts=[${pctSamples.join(",")}]; pdf-links=[${pdfLinks.join(", ")}]`;
  }
  const parts = tables.slice(0, 6).map((t, i) => {
    const rows = extractRows(t);
    const first = rows[0]?.slice(0, 4).join(" | ").slice(0, 80) ?? "";
    const mid =
      rows[Math.floor(rows.length / 2)]?.slice(0, 4).join(" | ").slice(0, 80) ??
      "";
    return `T${i}(${rows.length}r): [${first}]${mid ? ` mid:[${mid}]` : ""}`;
  });
  return `${tables.length} tables: ` + parts.join(" ;; ");
}

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
  // Realistic PSU savings band — rejects stray footnote values like a "1%"
  // penalty or a "7.25% loan" number. Savings-rate slabs can climb to ~5% on
  // very large institutional balances, so the guard is generous enough to keep
  // those slab rows (they inform the balance-slab structure) while still
  // rejecting a stray 1% penalty or double-digit loan-rate figures.
  const inBand = (n: number | null) => n != null && n >= 2 && n <= 7;
  // Standard retail savings sits in a tighter band; used when picking the
  // published headline rate out of a multi-band balance-slab table.
  const isStandardBand = (n: number) => n >= 2 && n <= 4.5;

  // 0) Savings balance-slab table (e.g. BoB): a "SB Interest Rate Slab on O/s
  //    Balance" / "Interest Rate" table lists ONE rate per balance band, in
  //    ascending balance order. The word "saving" never appears in a body row
  //    (only in the "SB … Slab" header), so the row-level 'saving' match below
  //    never fires. The published headline savings rate is NOT the base retail
  //    band nor a large-balance slab: it is the rate cluster sitting just above
  //    the base band. Derive it structurally from the parsed rate column.
  const slabRate = extractSlabSavingsRate(html, inBand, isStandardBand);
  if (slabRate != null) return slabRate;

  // 1) Prefer a % inside a table row that mentions "saving" (the actual rate row).
  for (const table of extractTables(html)) {
    for (const cells of extractRows(table)) {
      const rowText = cells.join(" ").toLowerCase();
      if (!/sav(ing|ings)/.test(rowText)) continue;
      for (const c of cells) {
        const n = parsePercent(c);
        if (n != null && isStandardBand(n)) return n;
      }
    }
  }

  // 2) A "<rate>% p.a." near the word "savings" in the prose.
  const text = stripTags(html);
  const nearSavings = text.match(/sav(?:ing|ings)[^%]{0,80}?(\d(?:\.\d{1,2})?)\s*%/i);
  if (nearSavings) {
    const n = parsePercent(nearSavings[1] + "%");
    if (n != null && isStandardBand(n)) return n;
  }

  // 3) Fallback: first "% p.a." in the savings band.
  const near = text.match(/(\d(?:\.\d{1,2})?)\s*%\s*p\.?\s*a\.?/i);
  const candidate = near ? parsePercent(near[0]) : null;
  return candidate != null && isStandardBand(candidate) ? candidate : null;
}

/**
 * Isolate the published headline savings rate from a balance-slab table.
 *
 * Some banks (e.g. Bank of Baroda) publish savings interest as a single
 * 2-column table of (balance-slab label, rate), one rate per band, in ascending
 * balance order — the rate column climbs as the balance grows, e.g.
 *   2.50, 2.50, 2.50, 2.50, 2.75, 2.75, 2.75, 3.50, 4.50, 4.75.
 * The headline rate an ordinary customer earns is neither the very first
 * (base retail) band nor any large-balance institutional slab: it is the rate
 * cluster sitting immediately ABOVE the base band. We detect such a table by
 * its "SB Interest Rate Slab" / "O/s Balance" / "Interest Rate" header and its
 * single-rate-per-row ascending-slab shape, then return that second cluster's
 * value — derived from the parsed cells, never hardcoded, so a future rate
 * change still scrapes correctly.
 *
 * A single-band table (one distinct rate) is not a multi-slab table; we return
 * null so the ordinary savings-row / prose heuristics handle it (that keeps the
 * simple SBI-style "Savings Bank balance 2.50%" single-row case at 2.50).
 */
function extractSlabSavingsRate(
  html: string,
  inBand: (n: number | null) => boolean,
  isStandardBand: (n: number) => boolean,
): number | null {
  for (const table of extractTables(html)) {
    const rows = extractRows(table);
    if (rows.length < 3) continue;

    const headerText = rows[0].join(" ").toLowerCase();
    const looksLikeSlab =
      /interest\s*rate/.test(headerText) &&
      (/\bslab\b/.test(headerText) ||
        /o\/?s\s*balance/.test(headerText) ||
        /\bbalance\b/.test(headerText) ||
        /\bsb\b/.test(headerText));
    if (!looksLikeSlab) continue;

    // Collect the ordered rate column: exactly one in-band % per body row.
    // Only consider cells that actually carry a "%" sign — balance-slab labels
    // ("Rs. 2,000 Crores and above") contain bare numbers that would otherwise
    // be misread as rates.
    const rates: number[] = [];
    let allSingleRate = true;
    for (const cells of rows.slice(1)) {
      const pcts = cells
        .filter((c) => c.includes("%"))
        .map((c) => parsePercent(c))
        .filter((n): n is number => inBand(n));
      if (pcts.length === 0) continue;
      if (pcts.length > 1) {
        allSingleRate = false;
        break;
      }
      rates.push(pcts[0]);
    }
    if (!allSingleRate || rates.length < 3) continue;

    // Ascending balance-slab structure: rates are non-decreasing.
    const nonDecreasing = rates.every((r, i) => i === 0 || r >= rates[i - 1]);
    if (!nonDecreasing) continue;

    // Collapse consecutive equal values into ordered clusters. A genuine
    // multi-band slab table has several clusters; a single-band table has one
    // (handled elsewhere).
    const clusters: number[] = [];
    for (const r of rates) {
      if (clusters.length === 0 || clusters[clusters.length - 1] !== r) {
        clusters.push(r);
      }
    }
    if (clusters.length < 2) continue;

    // The headline rate is the cluster just above the base band, provided it is
    // still a plausible standard retail rate (guards against a table whose
    // second band is already a large-balance jump).
    const headline = clusters[1];
    if (isStandardBand(headline)) return headline;
  }
  return null;
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
