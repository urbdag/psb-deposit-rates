import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";

const RBL_FD_URL = "https://www.rblbank.com/interest-rates";

/**
 * RBL Bank adapter.
 *
 * RBL's interest-rate page (rblbank.com/interest-rates) is client-rendered
 * (renderJs:true) and carries multiple tables. In DOM order:
 *
 *   table[0] = SAVINGS balance-slab table (must NOT be picked).
 *   table[1] = the RETAIL FD grid headed "Deposits below INR 3 crore".
 *
 * The retail grid has a 7-column shape that interleaves EFFECTIVE ANNUALISED
 * YIELD columns between the actual rate columns:
 *
 *   Period of Deposit
 *   | Interest Rates (per annum)               <- col 1  GENERAL rate
 *   | Effective Annualised Yield               <- col 2  (yield, IGNORE)
 *   | Senior Citizen Interest Rates (per annum)<- col 3  SENIOR rate
 *   | Effective Annualised Yield               <- col 4  (yield, IGNORE)
 *   | Super Senior Citizen Interest Rates ...  <- col 5  (super-senior, IGNORE)
 *   | Effective Annualised Yield               <- col 6  (yield, IGNORE)
 *
 * So the correct RETAIL columns are generalCol=1 and seniorCol=3. Columns
 * 2/4/6 are annualised yields and column 5 is super-senior; a naive
 * (tenure,%,%) parser would wrongly take the yield in col 2 as the senior rate.
 *
 * Cells can carry a trailing suffix such as "7.20% Highest"; parsePercent
 * tolerates trailing text (it extracts the leading number), verified in the
 * offline fixture test.
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:3, renderJs)
 * and override {@link findPrivateRateTable} to PIN the "below INR 3 crore"
 * retail grid by signature, so a page reorder or the presence of the savings
 * slab / any bulk table can never cause us to publish a savings, bulk, or yield
 * column under the OFFICIAL retail FD badge. RD is derived from FD card rates
 * for >= 1yr standard buckets.
 */
export class RblAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "rbl",
      fdUrl: [RBL_FD_URL],
      renderJs: true,
      generalCol: 1,
      seniorCol: 3,
    });
  }

  /**
   * Pin the retail "Deposits below INR 3 crore" grid. Strategy: prefer a table
   * whose text (or preceding heading context) carries the "below INR 3 crore"
   * retail signature and is NOT a savings table nor a higher-amount bulk table;
   * require the (tenure, general%, ..., senior%) shape with >= 4 distinct
   * tenures. Falls back to the first plausible unsigned rate table only if no
   * signed retail table is found.
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

      // Never treat the savings table or a higher-amount (>= 3 crore) bulk slab
      // as the retail FD table.
      const isSavings = /saving/.test(signature);
      const isBulk =
        /(?:inr|rs\.?|₹)?\s*3\s*cr(?:ore)?s?\s*(?:&|and)?\s*above/.test(
          signature,
        ) ||
        /(?:above|over)\s*(?:inr|rs\.?|₹)?\s*3\s*cr/.test(signature) ||
        /(?:inr|rs\.?|₹)?\s*5\s*cr(?:ore)?/.test(signature);
      const isRetail =
        /below\s*(?:inr|rs\.?|₹)?\s*3\s*cr/.test(signature) ||
        /less than\s*(?:inr|rs\.?|₹)?\s*3\s*cr/.test(signature) ||
        /(?:<|&lt;)\s*(?:inr|rs\.?|₹)?\s*3\s*cr/.test(signature);

      if (isSavings) continue;
      if (isRetail) return dataRows;
      if (isBulk) continue;
      if (fallback == null) fallback = dataRows;
    }
    return fallback;
  }

  /**
   * Return the section-heading context immediately preceding a table (the HTML
   * slice from the nearest preceding <h1..h6> to the table, stripped to plain
   * text) so the "below INR 3 crore" retail label is visible to the signature
   * test even when it lives ABOVE the table rather than inside it.
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
   * (cells[3]) to parse ensures a 3-column savings/bulk table cannot be
   * mistaken for the 7-column retail grid.
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
