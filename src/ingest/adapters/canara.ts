import {
  TableRateAdapter,
  defaultScheme,
  isSingleDayTenure,
} from "./base.js";
import type { RateEntry, RateSource } from "../../types.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { parseTenure } from "../tenure.js";

const CANARA_TERM_DEPOSIT_URL =
  "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.";

/**
 * Canara Bank adapter.
 *
 * Targets the combined domestic term-deposit rate page (retail, below ₹3
 * crore). That page's retail table is NOT a plain (tenure, general%, senior%)
 * grid: each data row carries a multi-column layout of
 *
 *   [tenure,
 *    Callable-GeneralPublic-RoI, Callable-GeneralPublic-AnnualisedYield,
 *    Callable-SeniorCitizen-RoI, Callable-SeniorCitizen-AnnualisedYield,
 *    NonCallable-GeneralPublic-RoI, NonCallable-GeneralPublic-Yield,
 *    NonCallable-SeniorCitizen-RoI, NonCallable-SeniorCitizen-Yield]
 *
 * The correct retail rates are cells[1] (general RoI) and cells[3] (senior
 * RoI). cells[2]/cells[4] are ANNUALISED YIELDS. The generic findRateTable
 * would take cells[2] (a yield) as the senior rate, which is wrong, so Canara
 * needs a bespoke parser that maps the correct columns.
 *
 * RD is NOT separately published by Canara (the recurring-deposit page has only
 * a policy table), so RD is DERIVED from FD (deriveRdFromFd, default true) and
 * inherits the OFFICIAL FD source. Savings is not parseable on this page; it is
 * best-effort and simply falls back to the aggregator savings rows via the
 * runner's merge-by-product.
 */
export class CanaraAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "canara",
      // The user's combined term-deposit page is first (the trailing period is
      // part of the URL). The older special-tenure pages remain as fallbacks.
      fdUrl: [
        CANARA_TERM_DEPOSIT_URL,
        "https://www.canarabank.bank.in/444-days-deposit",
        "https://www.canarabank.bank.in/kamadhenu-deposit",
      ],
      // Best-effort: the term-deposit page has no parseable savings rate, so
      // this yields nothing and Canara falls back to its existing aggregator
      // savings rows via merge-by-product. That is acceptable and expected.
      savingsUrls: [CANARA_TERM_DEPOSIT_URL],
      renderJs: true,
      schemeNamer: (t) => {
        const m = t.match(/(\d+)\s*days?/i);
        return m ? `Canara ${m[1]} Days Deposit` : defaultScheme(t);
      },
    });
  }

  /**
   * Canara-specific FD (+ derived RD) parser. Locates the retail
   * (Less than Rs.3 Crore) term-deposit table by its multi-column
   * Callable/Non-Callable signature and maps the correct RoI columns, ignoring
   * the annualised-yield columns. Bulk (≥3 crore) slab tables, Green Deposit,
   * NRE and the Hindi duplicate are not the retail table and are skipped.
   */
  override parseFdRd(
    html: string,
    effectiveDate: string,
    url?: string,
  ): RateEntry[] {
    const fdUrl = url ?? CANARA_TERM_DEPOSIT_URL;
    const source: RateSource = {
      url: fdUrl,
      effectiveDate,
      quality: "OFFICIAL",
    };

    const table = findCanaraRetailTable(html);
    if (!table) return [];

    const out: RateEntry[] = [];
    for (const cells of table) {
      const tenureText = cells[0];
      const tenure = parseTenure(tenureText);
      if (!tenure) continue;

      // Guard the broken 'Above 1 Year 3 months to less than 2 Years (Except
      // 555 days)' row (exactly 60 chars) that parses to max<min. Dropping it
      // loses no distinct rate (it duplicates the standard 1-3yr buckets).
      if (tenure.maxDays != null && tenure.maxDays < tenure.minDays) continue;

      // Correct retail columns: cells[1] = general RoI, cells[3] = senior RoI.
      // cells[2] / cells[4] are annualised YIELDS and must be skipped.
      const general = parsePercent(cells[1]);
      if (general == null) continue;
      const senior = cells.length > 3 ? parsePercent(cells[3]) : null;

      const isSpecial = isSingleDayTenure(tenure);
      const scheme = isSpecial
        ? (this.cfg.schemeNamer?.(tenureText) ?? defaultScheme(tenureText))
        : undefined;

      out.push(this.fd("GENERAL", general, tenure, source, scheme));
      if (senior != null)
        out.push(this.fd("SENIOR", senior, tenure, source, scheme));

      if (
        this.cfg.deriveRdFromFd &&
        !isSpecial &&
        tenure.minDays >= this.cfg.rdMinDays
      ) {
        out.push(this.rd("GENERAL", general, tenure, source));
        if (senior != null) out.push(this.rd("SENIOR", senior, tenure, source));
      }
    }

    // Sanity guard (mirrors the base): a genuine retail rate card has several
    // tenure buckets. Reject if we parsed fewer than 4 distinct FD tenures so a
    // future page redesign that breaks the column mapping keeps last-known-good
    // rather than publishing junk as OFFICIAL.
    const fdTenures = new Set(
      out
        .filter((r) => r.product === "FD")
        .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
    );
    if (fdTenures.size < 4) return [];
    return out;
  }
}

/**
 * Locate the Canara RETAIL (Less than Rs.3 Crore) term-deposit table and return
 * its data rows (each an array of cleaned cell text). Identified by the
 * multi-column Callable/Non-Callable retail signature: the table's header/text
 * mentions "Less than Rs.3 Crore" (or "Callable") and its data rows carry a
 * tenure in cells[0] plus at least the general + senior RoI columns.
 *
 * Bulk (≥3 crore) slab tables, Green Deposit, NRE and Hindi-duplicate tables do
 * NOT carry the retail signature and are skipped.
 */
function findCanaraRetailTable(html: string): string[][] | null {
  for (const table of extractTables(html)) {
    const tableText = table.toLowerCase();
    // Retail signature: "less than rs.3 crore" (retail below ₹3cr) or
    // "callable" (the retail Callable/Non-Callable column split). Reject bulk
    // tables that quote "3 crore & above" / "above rs.3 crore" only.
    const isRetail =
      /less than\s*(?:rs\.?)?\s*3\s*cr/.test(tableText) ||
      /non[-\s]?callable/.test(tableText) ||
      /callable/.test(tableText);
    // Never treat a bulk (≥3 crore) or NRE-only slab table as retail.
    const isBulk =
      /(?:3\s*cr(?:ore)?s?\s*(?:&|and)?\s*above)/.test(tableText) &&
      !/less than\s*(?:rs\.?)?\s*3\s*cr/.test(tableText);
    if (!isRetail || isBulk) continue;

    const rows = extractRows(table);
    const dataRows: string[][] = [];
    for (const cells of rows) {
      if (cells.length < 4) continue; // need at least tenure + gen RoI + yield + sr RoI
      const tenure = parseTenure(cells[0]);
      if (!tenure) continue;
      if (parsePercent(cells[1]) == null) continue; // general RoI required
      dataRows.push(cells);
    }
    // A real retail table has several tenure buckets; use the base guard's
    // threshold so a stray table with one or two parseable rows is not picked.
    const distinctTenures = new Set(
      dataRows.map((c) => {
        const t = parseTenure(c[0]);
        return t ? `${t.minDays}-${t.maxDays}` : "";
      }),
    );
    if (dataRows.length >= 3 && distinctTenures.size >= 4) return dataRows;
  }
  return null;
}
