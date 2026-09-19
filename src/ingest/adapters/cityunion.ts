import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";

const CITYUNION_FD_URL =
  "https://www.cityunionbank.com/deposit-interest-rate";

/**
 * City Union Bank adapter.
 *
 * City Union's deposit-interest-rate page (cityunionbank.com/deposit-interest-rate)
 * is client-rendered (renderJs:true) and carries ~19 tables (savings, NRE,
 * FCNR, RD and several term-deposit variants). The RETAIL FD table is the one
 * titled "Domestic/NRO Callable Term Deposit". It has TWO stacked header rows:
 *
 *   row A: Period | Rate of Interest % p.a
 *   row B:        | General | Senior Citizen | Super Senior Citizen
 *
 * then data rows: `<tenure> | <general%> | <senior%> | <super-senior%>`.
 *
 * So the correct RETAIL columns are generalCol=1 and seniorCol=2; column 3 is
 * the super-senior rate and must NOT be published as the retail senior rate.
 * There is a single amount tier (no < ₹3 crore split), so there is no bulk
 * column risk, but the page carries savings + NRE/FCNR + other higher tables,
 * so we PIN the "Callable Term Deposit" general/senior grid by signature. A
 * page reorder or the presence of the savings / NRE tables can then never cause
 * us to publish a savings or NRE column under the OFFICIAL retail FD badge.
 *
 * Specials present (444 days 7.10/7.35, 555 days 7.25/7.50) are odd single-day
 * tenures, scheme-tagged automatically by isSingleDayTenure. RD is derived from
 * FD card rates for >= 1yr standard buckets.
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:2, renderJs)
 * and override {@link findPrivateRateTable} (pattern: shivalik.ts / rbl.ts).
 */
export class CityunionAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "cityunion",
      fdUrl: [CITYUNION_FD_URL],
      renderJs: true,
      generalCol: 1,
      seniorCol: 2,
    });
  }

  /**
   * Pin the retail "Domestic/NRO Callable Term Deposit" grid. Strategy: prefer
   * a table whose text (or preceding heading context) carries the "callable
   * term deposit" retail signature and is NOT a savings, NRE/FCNR, or
   * non-callable/bulk table; require the (tenure, general%, senior%) shape with
   * >= 4 distinct tenures. Falls back to the first plausible unsigned rate
   * table only if no signed retail table is found.
   */
  protected override findPrivateRateTable(html: string): string[][] | null {
    let fallback: string[][] | null = null;
    for (const table of extractTables(html)) {
      const dataRows = this.extractDataRows(table);
      if (dataRows == null) continue;

      const signature = (
        this.sectionContextFor(html, table) +
        " " +
        stripTags(table)
      ).toLowerCase();

      // Never treat the savings or the NRE/FCNR foreign-currency tables as the
      // domestic retail FD table.
      const isSavings = /saving/.test(signature);
      const isForeign = /\bnre\b|\bnro\s*foreign|\bfcnr\b|foreign\s*currency/.test(
        signature,
      );
      const isRetail = /callable\s*term\s*deposit/.test(signature);

      if (isSavings || isForeign) continue;
      if (isRetail) return dataRows;
      if (fallback == null) fallback = dataRows;
    }
    return fallback;
  }

  /**
   * Return the section-heading context immediately preceding a table (the HTML
   * slice from the nearest preceding <h1..h6> to the table, stripped to plain
   * text) so the "Callable Term Deposit" retail label is visible to the
   * signature test even when it lives ABOVE the table rather than inside it.
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
   * (cells[2]) to parse means a 2-column savings/NRE table cannot be mistaken
   * for the multi-column retail grid. The two stacked header rows carry no
   * resolvable tenure in cells[0], so they are skipped naturally.
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
    const distinct = new Set(
      dataRows.map((c) => {
        const t = resolvePrivateTenure(c[0]);
        return t ? `${t.minDays}-${t.maxDays}` : "";
      }),
    );
    if (dataRows.length >= 4 && distinct.size >= 4) return dataRows;
    return null;
  }
}
