import {
  TableRateAdapter,
  defaultScheme,
  isSingleDayTenure,
} from "./base.js";
import type { RateEntry, RateSource } from "../../types.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";

const CSB_FD_URL = "https://csb.bank.in/interest-rates";

/**
 * CSB Bank (formerly Catholic Syrian Bank) adapter.
 *
 * CSB's interest-rates page (csb.bank.in/interest-rates) is client-rendered
 * (renderJs:true) and carries ~31 tables. The RETAIL FD table is titled
 * "INTEREST RATES (P.A.) ON DOMESTIC TERM DEPOSITS (W.E.F ...)" and has a
 * LEADING SERIAL-NUMBER column:
 *
 *   header: Slab | Deposit Tenor | Below Rs. 3 Crore (Rate of Interest p.a.) | Rs 2 Crore and above
 *   data:   <serial> | <tenor> | <below-3cr rate%> | <bulk rate%> [| Daily Quotes]
 *
 * So the tenor sits in cells[1] (NOT cells[0], which is a serial number) and
 * the RETAIL general rate is cells[2] (the "Below Rs. 3 Crore" column) — NOT
 * cells[3], which is the "Rs 2 Crore and above" BULK rate. A generic
 * (tenure,%,%) parser would read the serial column as the tenure and/or the
 * bulk column as a customer rate, so a bespoke parseFdRd is required (pattern:
 * pnb.ts / canara.ts leading-serial-column table selection).
 *
 * IMPORTANT: this term-deposit table publishes GENERAL rates ONLY (there is no
 * per-row senior-citizen column). CSB's senior rates are published separately
 * (typically a flat add-on / distinct table) and cannot be matched by tenor
 * from this table. Per the project hard rule we therefore publish GENERAL-only
 * OFFICIAL rows rather than copying general into senior or fabricating a senior
 * ladder. RD is derived from FD card rates for >= 1yr standard buckets.
 *
 * The DOMESTIC TERM DEPOSITS table is pinned by its title signature; the
 * savings-slab table (titled "DOMESTIC SAVINGS BANK DEPOSITS") is skipped. The
 * >= 4-distinct-FD-tenures junk guard is preserved so a future page redesign
 * keeps last-known-good rather than shipping a partial slice as OFFICIAL.
 */
export class CsbAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "csb",
      fdUrl: [CSB_FD_URL],
      renderJs: true,
    });
  }

  override parseFdRd(
    html: string,
    effectiveDate: string,
    url?: string,
  ): RateEntry[] {
    const fdUrl = url ?? CSB_FD_URL;
    const source: RateSource = {
      url: fdUrl,
      effectiveDate,
      quality: "OFFICIAL",
    };

    const table = findCsbDomesticTermTable(html);
    if (!table) return [];

    const out: RateEntry[] = [];
    for (const cells of table) {
      // cells: [Serial, Tenor, Below-3cr(general), Rs2cr+&above(bulk), ...]
      const tenureText = cells[1];
      const tenure = resolvePrivateTenure(tenureText);
      if (!tenure) continue;
      if (tenure.maxDays != null && tenure.maxDays < tenure.minDays) continue;

      // RETAIL general = the "Below Rs. 3 Crore" column (cells[2]); never the
      // "Rs 2 Crore and above" bulk column (cells[3]).
      const general = parsePercent(cells[2]);
      if (general == null) continue;

      const isSpecial = isSingleDayTenure(tenure);
      const scheme = isSpecial
        ? (this.cfg.schemeNamer?.(tenureText) ?? defaultScheme(tenureText))
        : undefined;

      // GENERAL-only: this table carries no senior column, so we do NOT emit
      // any SENIOR rows (never copy general into senior).
      out.push(this.fd("GENERAL", general, tenure, source, scheme));

      if (
        this.cfg.deriveRdFromFd &&
        !isSpecial &&
        tenure.minDays >= this.cfg.rdMinDays
      ) {
        out.push(this.rd("GENERAL", general, tenure, source));
      }
    }

    // Junk guard (mirrors the base): a genuine retail ladder has several tenure
    // buckets. Reject if fewer than 4 distinct FD tenures parsed so a future
    // redesign keeps last-known-good rather than shipping a partial slice.
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
 * Return the section-heading context immediately preceding a table (the HTML
 * slice from the nearest preceding <h1..h6> to the table, stripped to plain
 * text) so the "DOMESTIC TERM DEPOSITS" / "DOMESTIC SAVINGS BANK DEPOSITS"
 * title is visible to the signature test even when it lives ABOVE the table
 * (as a heading) rather than inside the <table> markup.
 */
function sectionContextFor(html: string, table: string): string {
  const idx = html.indexOf(table);
  if (idx < 0) return "";
  const before = html.slice(0, idx);
  const heads = before.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi);
  if (!heads || heads.length === 0) return "";
  return stripTags(heads[heads.length - 1]);
}

/**
 * Locate CSB's retail "DOMESTIC TERM DEPOSITS" ladder and return its data rows.
 *
 * The table leads with a serial-number column, so the tenor sits in cells[1]
 * and the retail ("Below Rs. 3 Crore") general rate in cells[2]. Identified by
 * a "term deposit" title signature (read from the table markup AND the
 * preceding heading context, since the title is a heading ABOVE the table on
 * the real page) while rejecting the savings table ("domestic savings bank
 * deposits") and any NRE/NRO foreign-currency tables. Requires the leading
 * serial-number shape (cells[0] numeric, cells[1] a tenure, cells[2] a percent)
 * so a plain (tenure,%,%) table is not misread with a serial offset. Among
 * qualifying tables we return the one yielding the MOST distinct FD tenures so
 * the full ladder wins over any partial special table.
 */
function findCsbDomesticTermTable(html: string): string[][] | null {
  let best: string[][] | null = null;
  let bestCount = 0;

  for (const table of extractTables(html)) {
    const signature = (
      sectionContextFor(html, table) +
      " " +
      stripTags(table)
    ).toLowerCase();

    // Reject savings and foreign-currency tables outright.
    if (/savings?\s*bank\s*deposit|domestic\s*savings/.test(signature)) continue;
    if (/\bnre\b|\bfcnr\b|foreign\s*currency/.test(signature)) continue;
    // Must be a TERM deposit table (title lives in the heading above the table).
    if (!/term\s*deposit/.test(signature)) continue;

    const rows = extractRows(table);
    const dataRows: string[][] = [];
    for (const cells of rows) {
      // Need at least [Serial, Tenor, Below-3cr] with a leading serial number,
      // a tenure in cells[1], and a retail percent in cells[2].
      if (cells.length < 3) continue;
      if (!/^\d+$/.test(cells[0].trim())) continue; // leading serial column
      const tenure = resolvePrivateTenure(cells[1]);
      if (!tenure) continue;
      if (tenure.maxDays != null && tenure.maxDays < tenure.minDays) continue;
      if (parsePercent(cells[2]) == null) continue; // retail general required
      dataRows.push(cells);
    }

    const distinctTenures = new Set(
      dataRows.map((c) => {
        const t = resolvePrivateTenure(c[1]);
        return t ? `${t.minDays}-${t.maxDays}` : "";
      }),
    );
    if (
      dataRows.length >= 4 &&
      distinctTenures.size >= 4 &&
      distinctTenures.size > bestCount
    ) {
      best = dataRows;
      bestCount = distinctTenures.size;
    }
  }

  return best;
}
