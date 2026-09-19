import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";
const DBS_FD_URL = "https://www.dbs.bank.in/in/treasures/deposits/your-accounts/fixed-deposits";
/**
 * DBS Bank India adapter.
 *
 * DBS Treasures' fixed-deposit page (dbs.bank.in, Next.js + Adobe) is
 * client-rendered (renderJs:true). Its retail INR rate table has TWO stacked
 * header rows and INTERLEAVES an ANNUALISED-YIELD column after each rate
 * column:
 *
 *   row A: Tenor | <general group> | Senior Citizens
 *   row B:       | Interest Rate | Interest Rate | Interest Rate | Interest Rate
 *
 * so each data row carries FOUR percentages:
 *
 *   <tenor>
 *   | <general rate%>              <- col 1  GENERAL rate
 *   | <general annualised yield%>  <- col 2  (yield, IGNORE)
 *   | <senior rate%>              <- col 3  SENIOR rate
 *   | <senior annualised yield%>  <- col 4  (yield, IGNORE)
 *
 * e.g. "1 year | 5.75% | 5.88% | 6.25% | 6.40%". So the correct RETAIL columns
 * are generalCol=1 and seniorCol=3; columns 2 and 4 are ANNUALISED YIELD and
 * must NEVER be published as a rate. A naive (tenure,%,%) parser would wrongly
 * take the yield in col 2 as the senior rate. DBS DOES give a senior premium
 * (6.25 vs 5.75 at 1yr), so the SENIOR rows are genuine.
 *
 * This page's ladder is annual-tenure only (1-5 years = 5 distinct tenures,
 * which satisfies the >= 4-distinct junk guard). The shorter-tenure ladder on
 * interest-rates.page is single-column general-only and is intentionally NOT
 * used (keeps a clean GENERAL/SENIOR set).
 *
 * The page also renders savings / NRE / FCNR / foreign-currency decoy tables,
 * so we PIN the retail FD grid by signature ("tenor" + "senior citizens") and
 * REJECT those decoys, and require parseable percentages in BOTH generalCol(1)
 * and seniorCol(3) so a 2-3 column decoy cannot be mistaken for the 5-column
 * grid. We deliberately do NOT reject on "nro": NRO = Non-Resident ORDINARY
 * *rupee* (INR) deposits, which earn the SAME rupee rates as resident deposits
 * and are quoted in the same "< Rs. 3 crore" retail INR table, so a
 * "Domestic and NRO" heading is retail data, not a decoy (mirrors deutsche.ts).
 *
 * We extend {@link PrivateTableAdapter} (generalCol:1, seniorCol:3, renderJs)
 * and override {@link findPrivateRateTable} (pattern: rbl.ts).
 */
export class DbsAdapter extends PrivateTableAdapter {
    constructor() {
        super({
            bankId: "dbs",
            fdUrl: [DBS_FD_URL],
            renderJs: true,
            generalCol: 1,
            seniorCol: 3,
        });
    }
    /**
     * Pin the retail DBS FD grid. Strategy: prefer a table whose text (or
     * preceding heading context) carries the "tenor" + "senior citizens"
     * signature and is NOT a savings / NRE / FCNR / foreign-currency table;
     * require the interleaved-yield (tenure, general%, yield, senior%, yield)
     * shape with >= 4 distinct tenures. Falls back to the first plausible
     * unsigned rate table only if no signed retail table is found.
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
            // Never treat a savings, NRE, or FCNR/foreign-currency table as the
            // domestic/resident retail FD table. We deliberately do NOT reject on
            // "nro": NRO (Non-Resident ORDINARY *rupee*) deposits earn resident INR
            // rates and are quoted in the same "< Rs. 3 crore" retail table, so a
            // "Domestic and NRO" heading is retail data, not a decoy. The retail pin
            // ("tenor" + "senior citizens") plus requiring parseable % in BOTH
            // generalCol(1) and seniorCol(3) still rejects a genuine NRE/FCNR grid.
            // (Mirrors deutsche.ts, whose live table heading is exactly "Domestic and
            // NRO Fixed Deposit rates".)
            const isDecoy = /\bnre\b|\bfcnr\b|foreign\s*currency|saving/.test(signature);
            const isRetail = /\btenor\b/.test(signature) && /senior\s*citizens?/.test(signature);
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
     * text) so the "Tenor" / "Senior Citizens" retail labels are visible to the
     * signature test even when they live ABOVE the table rather than inside it.
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
     * general (cells[1]) AND senior (cells[3]) columns; else null. Requiring the
     * senior column (cells[3]) to parse ensures a 2-3 column savings/NRE table
     * cannot be mistaken for the 5-column interleaved-yield retail grid. The two
     * stacked header rows carry no resolvable tenure in cells[0], so they are
     * skipped naturally.
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
