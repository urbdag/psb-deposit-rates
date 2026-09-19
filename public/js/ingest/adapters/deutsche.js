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
            // The retail header on the REAL page carries a BARE "<Rs. 3 crore" (an
            // unescaped "<" before "Rs"), and one data row is "> 4 Yrs - <5 Yrs".
            // stripTags() uses /<[^>]*>/ and eats everything from that bare "<" up to
            // the next ">", so "Rs. 3 crore" (and "5 Yrs") are DELETED from the
            // stripped text. The old signature hard-required a "< ... 3 crore" token,
            // which therefore never matched the real table — so it fell through to
            // the flat-text fallback in base.ts, which mis-read the "1.5 Yrs" tenure
            // label as a 1.5% rate and published a single bogus OFFICIAL row.
            //
            // Fix: build the signature from BOTH the tag-stripped text (for the
            // decoy tokens, which survive) AND the RAW table html (where "3 crore" /
            // "crore" survives the bare-angle-bracket hazard). Base the retail test
            // on tokens that survive stripping ("normal interest rate" + "senior
            // citizen") and treat the "crore" amount token flexibly (matched against
            // the raw html), rather than hard-requiring the fragile "< 3 crore".
            const stripped = (this.sectionContextFor(html, table) +
                " " +
                stripTags(table)).toLowerCase();
            const raw = (this.sectionContextFor(html, table) + " " + table)
                .toLowerCase()
                .replace(/\s+/g, " ");
            // Never treat a savings, NRE/NRO, FCNR/foreign-currency, or tax-saver
            // table as the domestic/resident retail FD table. Test both the stripped
            // text and the raw html so a decoy token hidden by the angle-bracket
            // hazard is still caught.
            const decoyRe = /\bnre\b|\bnro\b|\bfcnr\b|foreign\s*currency|tax\s*saver|saving/;
            const isDecoy = decoyRe.test(stripped) || decoyRe.test(raw);
            // Retail resident grid: a "normal/general interest rate" + "senior
            // citizen" header for a "< 3 crore" (retail) amount band. The "crore"
            // token is matched against the RAW html so the bare "<Rs. 3 crore"
            // header still qualifies even though stripTags eats "Rs. 3 crore".
            const isRetail = /(?:normal|general)\s*interest\s*rate/.test(stripped) &&
                /senior\s*citizen/.test(stripped) &&
                /crore/.test(raw);
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
    parseTextFdRd() {
        return [];
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
