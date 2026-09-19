import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";

const SHIVALIK_FD_URL = "https://shivalik.bank.in/interest-rate";

/**
 * Shivalik Small Finance Bank adapter.
 *
 * Shivalik SFB publishes ~10 tables on its single interest-rate page. The
 * RETAIL FD table is the clean 3-column (Tenure, General, Senior Citizen) grid
 * headed "Amount less than Rs.2 Crores"; alongside it sit higher-amount slab
 * tables (Rs.25 Lakhs..., Rs.7 Crore and above) and a savings table (which also
 * carries a 7.00% top slab) that must NOT be selected.
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:2, renderJs)
 * and override {@link findPrivateRateTable} to PIN the "< Rs.2 Crores" retail
 * table by header/content signature, so a page-order change or the presence of
 * the higher-slab / savings tables can never cause us to publish a bulk or
 * savings column under the OFFICIAL retail FD badge. RD is derived from FD card
 * rates for >= 1yr standard buckets.
 */
export class ShivalikAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "shivalik",
      fdUrl: [SHIVALIK_FD_URL],
      renderJs: true,
      generalCol: 1,
      seniorCol: 2,
    });
  }

  /**
   * Pin the retail "< Rs.2 Crores" 3-column FD table. Strategy: prefer a table
   * whose text carries the "less than Rs.2 Crore" (retail) signature and is NOT
   * a higher-amount slab table (Rs.25 Lakh.../Rs.7 Crore and above) nor the
   * savings table; require the (tenure, general%, senior%) shape with >= 4
   * distinct tenures. Falls back to the base picker only if no signed retail
   * table is found.
   */
  protected override findPrivateRateTable(html: string): string[][] | null {
    let fallback: string[][] | null = null;
    for (const table of extractTables(html)) {
      const tableText = table.toLowerCase();

      const dataRows = this.extractDataRows(table);
      if (dataRows == null) continue;

      // Never treat the savings table or a higher-amount bulk slab as retail FD.
      const isSavings = /saving/.test(tableText);
      const isBulk =
        /(?:rs\.?\s*2\s*cr(?:ore)?s?\s*(?:&|and)?\s*above)/.test(tableText) ||
        /(?:rs\.?\s*7\s*cr(?:ore)?)/.test(tableText) ||
        /(?:25\s*lakh)/.test(tableText);
      const isRetail =
        /less than\s*(?:rs\.?)?\s*2\s*cr/.test(tableText) ||
        /below\s*(?:rs\.?)?\s*2\s*cr/.test(tableText) ||
        /(?:<|&lt;)\s*(?:rs\.?)?\s*2\s*cr/.test(tableText);

      if (isSavings || isBulk) continue;
      if (isRetail) return dataRows;
      // Keep the first plausible unsigned table as a fallback (the retail table
      // typically appears before the higher-slab tables in DOM order).
      if (fallback == null) fallback = dataRows;
    }
    return fallback;
  }

  /**
   * Return a table's (tenure, general%, senior%) data rows, or null when the
   * table is not a >= 4-distinct-tenure rate grid.
   */
  private extractDataRows(table: string): string[][] | null {
    const dataRows: string[][] = [];
    for (const cells of extractRows(table)) {
      if (cells.length <= this.seniorCol) continue;
      const tenure = resolvePrivateTenure(cells[0]);
      if (!tenure) continue;
      if (tenure.maxDays != null && tenure.maxDays < tenure.minDays) continue;
      if (parsePercent(cells[this.generalCol]) == null) continue;
      dataRows.push(cells);
    }
    const distinct = new Set(
      dataRows.map((c) => {
        const t = resolvePrivateTenure(c[0]);
        return t ? `${t.minDays}-${t.maxDays}` : "";
      }),
    );
    if (dataRows.length >= 3 && distinct.size >= 4) return dataRows;
    return null;
  }
}
