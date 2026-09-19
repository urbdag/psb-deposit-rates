import { PrivateTableAdapter } from "./private-base.js";
import { extractRows, extractTables, parsePercent, stripTags } from "../html.js";
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
    findPrivateRateTable(html) {
        let fallback = null;
        for (const table of extractTables(html)) {
            const dataRows = this.extractDataRows(table);
            if (dataRows == null)
                continue;
            // The amount-slab label ("less than Rs.2 Crores" / "Rs.2 Crore and above"
            // / "Savings") is on the real page a HEADING or section label ABOVE the
            // table, not text inside the <table> markup. So test the signature
            // against BOTH the table's own text AND the preceding heading/section
            // context, otherwise the retail pin never fires and selection silently
            // falls back to DOM order (a reorder could then ship bulk rates).
            const signature = (this.sectionContextFor(html, table) +
                " " +
                stripTags(table)).toLowerCase();
            // Never treat the savings table or a higher-amount bulk slab as retail FD.
            const isSavings = /saving/.test(signature);
            const isBulk = /(?:rs\.?\s*2\s*cr(?:ore)?s?\s*(?:&|and)?\s*above)/.test(signature) ||
                /(?:rs\.?\s*7\s*cr(?:ore)?)/.test(signature) ||
                /(?:25\s*lakh)/.test(signature);
            const isRetail = /less than\s*(?:rs\.?)?\s*2\s*cr/.test(signature) ||
                /below\s*(?:rs\.?)?\s*2\s*cr/.test(signature) ||
                /(?:<|&lt;)\s*(?:rs\.?)?\s*2\s*cr/.test(signature);
            if (isSavings || isBulk)
                continue;
            if (isRetail)
                return dataRows;
            // Keep the first plausible unsigned table as a fallback (the retail table
            // typically appears before the higher-slab tables in DOM order).
            if (fallback == null)
                fallback = dataRows;
        }
        return fallback;
    }
    /**
     * Return the section-heading context immediately preceding a table: the HTML
     * slice between the nearest preceding <h1..h6> (or section-label heading) and
     * the table, stripped to plain text. Used so the retail/bulk/savings slab
     * label is visible to the signature test even when it lives ABOVE the table
     * rather than inside it. Dependency-free and forgiving: returns "" if no
     * preceding heading is found.
     */
    sectionContextFor(html, table) {
        const idx = html.indexOf(table);
        if (idx < 0)
            return "";
        const before = html.slice(0, idx);
        // Take only the NEAREST preceding heading block: match all heading tags
        // before the table and keep the last one (covers "<h3>label</h3> ...
        // <table>" without absorbing earlier sections' headings).
        const heads = before.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi);
        if (!heads || heads.length === 0)
            return "";
        return stripTags(heads[heads.length - 1]);
    }
    /**
     * Return a table's (tenure, general%, senior%) data rows, or null when the
     * table is not a >= 4-distinct-tenure rate grid.
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
