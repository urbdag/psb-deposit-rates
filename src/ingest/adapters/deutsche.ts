import { PrivateTableAdapter } from "./private-base.js";
import type { RateEntry } from "../../types.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";

const DEUTSCHE_FD_URL =
  "https://www.deutsche.bank.in/en/advantage-banking/fixed-deposit-overview/resident-fixed-deposits.html";

/**
 * Deutsche Bank India adapter.
 *
 * Deutsche's RESIDENT retail fixed-deposit page (deutsche.bank.in Adobe
 * Experience Manager site) is client-rendered (renderJs:true). The dedicated
 * resident FD page carries ONE clean rate table with a single header row:
 *
 *   Deposit tenure
 *   | Normal interest rate (% p.a.) <Rs. 3 crore   <- col 1  GENERAL rate
 *   | Senior citizen interest rate (% p.a.) <Rs. 3 crore  <- col 2  SENIOR rate
 *
 * then data rows `<tenure> | <general%> | <senior%>` for 17 tenure buckets
 * (7 Days ... 5 Yrs). So the correct RETAIL columns are generalCol=1 and
 * seniorCol=2. This is the DOMESTIC/RESIDENT INR retail (< Rs. 3 crore) table.
 *
 * Deutsche currently publishes NO senior premium (the senior column equals the
 * general column on every row), but it DOES publish a distinct senior column,
 * so mapping seniorCol=2 is correct: the emitted SENIOR rows equal GENERAL,
 * which is faithful to the source (this is NOT fabrication — the column
 * exists). Tenure labels are compound (e.g. "271 Days - 1 Yr", "> 1 Yr - 1.5
 * Yrs", "> 4 Yrs - <5 Yrs"), which resolvePrivateTenure handles.
 *
 * This dedicated resident-FD URL serves EXACTLY ONE rate table (the resident
 * retail < Rs. 3 crore domestic INR grid); the NRE / NRO / FCNR / savings /
 * tax-saver schedules live on OTHER pages, never on this one. So we SELECT the
 * qualifying data table by SHAPE, not by fragile header text: among the tables
 * whose data rows form a (tenure, general%, senior%) grid with >= 4 distinct
 * tenures and that are NOT clearly a NRE/NRO/FCNR/foreign-currency/tax-saver/
 * savings decoy, we return the one with the MOST distinct tenures (the real
 * 17-tenure ladder wins over any small decoy that slipped through). We do NOT
 * require any positive header token ("crore" / "normal interest rate" /
 * "senior citizen").
 *
 * Root cause of the previous live 0-rows failure (reproduced with a throwaway
 * debug harness that mirrors the BROWSER-REPAIRED serialized DOM): the header
 * cell carries a bare, unescaped "<" ("Normal interest rate (% p.a.) <Rs. 3
 * crore"). The headless browser treats "<Rs. 3 crore</th>" as a malformed tag
 * and DROPS that text when it serializes page.content(), so "crore" (and
 * sometimes the whole header row) is gone from what the adapter parses. The old
 * header-token-dependent isRetail test then failed, and a footer note in the
 * resident table referencing "NRE / NRO / FCNR deposits" / "Savings account"
 * made the whole-table decoy test reject the single correct table -> 0 rows ->
 * ingest kept the bogus 1.5% last-known-good row. Cell extraction always
 * yielded clean rows; only the signature logic was wrong.
 *
 * Two fixes make selection robust: (1) shape selection drops the brittle
 * positive header match; (2) the decoy signature is computed from the section
 * heading + the table's HEADER row only (never the data/footnote rows), so a
 * footnote that merely references NRE/savings pages cannot poison the retail
 * table's signature. A genuine NRE/FCNR table still declares itself in its own
 * column headers and is rejected.
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:2, renderJs)
 * and override {@link findPrivateRateTable} (pattern: csb.ts most-distinct-
 * tenures tie-break + cityunion.ts / rbl.ts decoy rejection, minus the brittle
 * positive header match).
 */
export class DeutscheAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "deutsche",
      fdUrl: [DEUTSCHE_FD_URL],
      renderJs: true,
      generalCol: 1,
      seniorCol: 2,
    });
  }

  /**
   * Select the resident retail FD grid by SHAPE (not fragile header text).
   *
   * This URL serves exactly one rate table (the resident < Rs. 3 crore INR
   * grid); NRE/NRO/FCNR/savings/tax-saver schedules live on other pages. So we
   * iterate tables, keep only those whose data rows form a valid
   * (tenure, general%, senior%) grid with >= 4 distinct tenures (a strong junk
   * guard that skips header/note rows naturally), REJECT any that a SAFE
   * signature clearly marks as a NRE/NRO/FCNR/foreign-currency/tax-saver/
   * savings decoy, and among the survivors return the one with the MOST
   * distinct tenures (the real 17-tenure ladder wins over any small decoy).
   *
   * We deliberately do NOT require any positive header token ("crore" /
   * "normal interest rate" / "senior citizen"): the headless browser repairs
   * the bare "<" in the header ("... <Rs. 3 crore") away when it serializes the
   * DOM, so those tokens may be gone. A >= 4-distinct-tenure (tenure, %, %)
   * grid that is not a decoy IS the retail table on this single-table page.
   *
   * The decoy signature is built from the section heading + the table's HEADER
   * row only (see {@link headerSignature}), never the data/footnote rows, so a
   * footnote that merely references NRE/savings pages cannot cause a false
   * decoy rejection of the correct resident table. \bsaving\b uses a word
   * boundary and the signature strips markup (bare "<" neutralised so "crore"
   * survives), so a `cmp-savings-grid` class or `data-nre` attribute can never
   * trigger a decoy match.
   */
  protected override findPrivateRateTable(html: string): string[][] | null {
    let best: string[][] | null = null;
    let bestCount = 0;

    for (const table of extractTables(html)) {
      const dataRows = this.extractDataRows(table);
      if (dataRows == null) continue;

      const sig = this.headerSignature(html, table);
      // Reject only a table whose header/heading clearly marks it a genuine
      // non-retail-INR decoy: NRE / FCNR / foreign-currency / tax-saver /
      // savings.
      //
      // We deliberately do NOT reject on "nro". Deutsche titles its combined
      // resident + NRO-rupee schedule "Domestic and NRO Fixed Deposit rates":
      // NRO here means Non-Resident ORDINARY *rupee* (INR) deposits, which earn
      // the SAME rupee rates as resident deposits and are quoted in the same
      // "< Rs. 3 crore" retail INR table. That is exactly the domestic retail
      // INR data we want, NOT foreign-currency. The genuine decoys are NRE
      // (Non-Resident External, repatriable, often different rates), FCNR
      // (foreign-currency), tax-saver and savings; NRO-rupee at resident rates
      // is retail and must stay selectable. (CI instrumentation confirmed the
      // real page's single correct table carries the heading "Domestic and NRO
      // Fixed Deposit rates" and was being wrongly rejected by a "\bnro\b"
      // decoy match.)
      const decoyRe =
        /\bnre\b|\bfcnr\b|foreign\s*currency|tax\s*saver|\bsaving\b/;
      if (decoyRe.test(sig)) continue;

      // Among non-decoy valid grids, pick the one with the MOST distinct
      // tenures (the full ladder wins over any small decoy that slipped by).
      const distinct = this.distinctTenureCount(dataRows);
      if (distinct > bestCount) {
        best = dataRows;
        bestCount = distinct;
      }
    }
    return best;
  }

  /** Count distinct resolvable tenures across a set of data rows. */
  private distinctTenureCount(dataRows: string[][]): number {
    const distinct = new Set(
      dataRows.map((c) => {
        const t = resolvePrivateTenure(c[0]);
        return t ? `${t.minDays}-${t.maxDays}` : "";
      }),
    );
    return distinct.size;
  }

  /**
   * Build the SAFE decoy signature for a table: the section heading immediately
   * above it + the table's HEADER row (the first <tr>) only, markup removed and
   * bare "<" neutralised. Using only the heading + header row (not the data or
   * footnote rows) means a genuine NRE/FCNR/savings table (which declares
   * itself in its own column headers) is still rejected, while a footnote in
   * the resident table that merely references "NRE / NRO / FCNR" or "Savings
   * account" cannot poison the retail table's signature.
   */
  private headerSignature(html: string, table: string): string {
    const headerRow = table.match(/<tr\b[\s\S]*?<\/tr>/i)?.[0] ?? "";
    return this.signatureText(
      this.sectionContextFor(html, table) + " " + headerRow,
    );
  }

  /**
   * Produce a SAFE signature text for a table (+ its preceding heading): the
   * visible cell/heading text only, with all markup removed but the bare-"<"
   * amount tokens preserved.
   *
   * Deutsche's resident FD header cells contain a BARE, unescaped "<" before
   * the amount band ("Normal interest rate (% p.a.) <Rs. 3 crore") and one data
   * label is "> 4 Yrs - <5 Yrs". A plain stripTags() would treat "<Rs. 3 crore"
   * / "<5 Yrs" as a tag and delete the amount token. So we first replace bare
   * "<" (one followed by whitespace, a digit, "=", or "Rs") with the "&lt;"
   * entity, then stripTags (which discards genuine tags AND decodes "&lt;"
   * back to "<"). The result keeps "crore" / "5 yrs" while dropping every
   * class name, attribute, and other markup, so the decoy test can never match
   * a substring hidden inside markup (e.g. a `cmp-savings-grid` class).
   */
  private signatureText(html: string): string {
    const neutralised = html
      .replace(/<(?=\s|=|\d)/g, "&lt;")
      .replace(/<(?=rs\b)/gi, "&lt;");
    return stripTags(neutralised).toLowerCase();
  }

  /**
   * Disable the flat-text (PDF-style line) fallback for Deutsche.
   *
   * base.ts `fetchRates` (renderJs branch) calls `this.parseTextFdRd(...)` on
   * the rendered page's visible text whenever the structured table parse yields
   * no rows. For Deutsche that fallback is UNSAFE: the tenure labels contain
   * decimal "Yrs" tokens ("> 1 Yr - 1.5 Yrs", "> 1.5 Yrs - 2 Yrs") that the
   * line parser misreads as rates (it published a bogus single "> 1 Yr -" /
   * 1.5% row under the OFFICIAL badge). Deutsche's rates ONLY come from the
   * structured resident table, so we neutralise the text fallback: if the table
   * can't be parsed, emit 0 rows (ingest keeps last-known-good) rather than
   * fabricating a row.
   */
  override parseTextFdRd(): RateEntry[] {
    return [];
  }

  /**
   * Return the section-heading context immediately preceding a table (the HTML
   * slice from the nearest preceding <h1..h6> to the table, stripped to plain
   * text) so the "< Rs. 3 crore" retail label is visible to the signature test
   * even when it lives ABOVE the table rather than inside it.
   */
  private sectionContextFor(html: string, table: string): string {
    const idx = html.indexOf(table);
    if (idx < 0) return "";
    const before = html.slice(0, idx);
    const heads = before.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi);
    if (!heads || heads.length === 0) return "";
    return stripTags(heads[heads.length - 1]);
  }

  /**
   * Return a table's data rows when it is a >= 4-distinct-tenure rate grid with
   * a resolvable tenure in cells[0] and parseable percentages in the configured
   * general AND senior columns; else null. Requiring the senior column
   * (cells[2]) to parse ensures a 2-column savings table cannot be mistaken for
   * the 3-column retail grid. The header row carries no resolvable tenure in
   * cells[0], so it is skipped naturally.
   */
  private extractDataRows(table: string): string[][] | null {
    const dataRows: string[][] = [];
    for (const cells of extractRows(table)) {
      if (cells.length <= this.seniorCol) continue;
      const tenure = resolvePrivateTenure(cells[0]);
      if (!tenure) continue;
      if (tenure.maxDays != null && tenure.maxDays < tenure.minDays) continue;
      if (parsePercent(cells[this.generalCol]) == null) continue;
      if (parsePercent(cells[this.seniorCol]) == null) continue;
      dataRows.push(cells);
    }
    if (dataRows.length >= 4 && this.distinctTenureCount(dataRows) >= 4)
      return dataRows;
    return null;
  }
}
