import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";
const DEUTSCHE_FD_URL = "https://www.deutsche.bank.in/en/advantage-banking/fixed-deposit-overview/resident-fixed-deposits.html";
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
 * The landing interest-rates.html page renders several tables (savings, NRE,
 * NRO, FCNR foreign-currency, tax-saver), so we PIN the retail resident FD
 * table by signature ("normal interest rate" / "senior citizen" + "< Rs. 3
 * crore") and REJECT any savings / NRE / NRO / FCNR / foreign-currency /
 * tax-saver decoy table. A page reorder or the presence of those tables can
 * then never cause us to publish a non-retail column under the OFFICIAL badge.
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:2, renderJs)
 * and override {@link findPrivateRateTable} (pattern: cityunion.ts / rbl.ts).
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
     * Pin the resident retail "< Rs. 3 crore" normal/senior grid. Strategy:
     * prefer a table whose text (or preceding heading context) carries the
     * "normal interest rate" / "senior citizen" + "< Rs. 3 crore" retail
     * signature and is NOT a savings / NRE / NRO / FCNR / foreign-currency /
     * tax-saver table; require the (tenure, general%, senior%) shape with >= 4
     * distinct tenures. Falls back to the first plausible unsigned rate table
     * only if no signed retail table is found.
     */
    findPrivateRateTable(html) {
        let fallback = null;
        for (const table of extractTables(html)) {
            const dataRows = this.extractDataRows(table);
            if (dataRows == null)
                continue;
            const signature = (this.sectionContextFor(html, table) +
                " " +
                stripTags(table)).toLowerCase();
            // Never treat a savings, NRE/NRO, FCNR/foreign-currency, or tax-saver
            // table as the domestic/resident retail FD table.
            const isDecoy = /\bnre\b|\bnro\b|\bfcnr\b|foreign\s*currency|tax\s*saver|saving/.test(signature);
            const isRetail = /normal\s*interest\s*rate/.test(signature) &&
                /senior\s*citizen/.test(signature) &&
                /(?:<|&lt;|less than|below)\s*(?:rs\.?|inr|₹)?\s*3\s*cr/.test(signature);
            if (isDecoy)
                continue;
            if (isRetail)
                return dataRows;
            if (fallback == null)
                fallback = dataRows;
        }
        return fallback;
    }
    /**
     * Return the section-heading context immediately preceding a table (the HTML
     * slice from the nearest preceding <h1..h6> to the table, stripped to plain
     * text) so the "< Rs. 3 crore" retail label is visible to the signature test
     * even when it lives ABOVE the table rather than inside it.
     */
    sectionContextFor(html, table) {
        const idx = html.indexOf(table);
        if (idx < 0)
            return "";
        const before = html.slice(0, idx);
        const heads = before.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi);
        if (!heads || heads.length === 0)
            return "";
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
    extractDataRows(table) {
        const dataRows = [];
        for (const cells of extractRows(table)) {
            if (cells.length <= this.seniorCol)
                continue;
            const tenure = resolvePrivateTenure(cells[0]);
            if (!tenure)
                continue;
            if (tenure.maxDays != null && tenure.maxDays < tenure.minDays)
                continue;
            if (parsePercent(cells[this.generalCol]) == null)
                continue;
            if (parsePercent(cells[this.seniorCol]) == null)
                continue;
            dataRows.push(cells);
        }
        const distinct = new Set(dataRows.map((c) => {
            const t = resolvePrivateTenure(c[0]);
            return t ? `${t.minDays}-${t.maxDays}` : "";
        }));
        if (dataRows.length >= 4 && distinct.size >= 4)
            return dataRows;
        return null;
    }
}
