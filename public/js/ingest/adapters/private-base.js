import { TableRateAdapter, defaultScheme, isSingleDayTenure } from "./base.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";
/**
 * Base adapter for private-sector banks.
 *
 * Private banks publish the same conceptual (tenure, general%, senior%) retail
 * term-deposit card as PSU banks, but with two wrinkles the PSU base cannot
 * handle on its own:
 *
 *   1. Compound tenure labels ("3 Years 1 day to < 4 Years 7 Months",
 *      "2 Years 11 Months (35 months)") that the PSU tenure parser inverts.
 *      This base resolves them via {@link resolvePrivateTenure}.
 *   2. Multi-column amount-slab grids where the retail general/senior columns
 *      are not simply cells[1]/cells[2] (e.g. Kotak / ICICI put a "₹3cr–₹5cr"
 *      column between them). `generalCol` / `seniorCol` pick the right columns.
 *
 * Everything else (OFFICIAL tagging, RD-derived-from-FD, single-day specials,
 * savings, the >=4-distinct-FD-tenures junk guard) is inherited from the PSU
 * base by re-using its `fd`/`rd` emitters and mirroring its row loop.
 */
export class PrivateTableAdapter extends TableRateAdapter {
    constructor(config) {
        super(config);
        this.generalCol = config.generalCol ?? 1;
        this.seniorCol = config.seniorCol ?? 2;
    }
    parseFdRd(html, effectiveDate, url) {
        const fdUrl = url ??
            (Array.isArray(this.cfg.fdUrl) ? this.cfg.fdUrl[0] : this.cfg.fdUrl);
        const source = { url: fdUrl, effectiveDate, quality: "OFFICIAL" };
        const table = this.findPrivateRateTable(html);
        if (!table)
            return [];
        const out = [];
        for (const cells of table) {
            const tenureText = cells[0];
            const tenure = resolvePrivateTenure(tenureText);
            if (!tenure)
                continue;
            // Guard inverted ranges that slipped through (never publish max<min).
            if (tenure.maxDays != null && tenure.maxDays < tenure.minDays)
                continue;
            const general = parsePercent(cells[this.generalCol]);
            if (general == null)
                continue;
            const senior = cells.length > this.seniorCol ? parsePercent(cells[this.seniorCol]) : null;
            const isSpecial = isSingleDayTenure(tenure);
            const scheme = isSpecial
                ? (this.cfg.schemeNamer?.(tenureText) ?? defaultScheme(tenureText))
                : undefined;
            out.push(this.fd("GENERAL", general, tenure, source, scheme));
            if (senior != null)
                out.push(this.fd("SENIOR", senior, tenure, source, scheme));
            if (this.cfg.deriveRdFromFd &&
                !isSpecial &&
                tenure.minDays >= this.cfg.rdMinDays) {
                out.push(this.rd("GENERAL", general, tenure, source));
                if (senior != null)
                    out.push(this.rd("SENIOR", senior, tenure, source));
            }
        }
        // Junk guard (mirrors the base): a real retail card has several tenure
        // buckets. Reject on < 4 distinct FD tenures so a page redesign that breaks
        // the column mapping keeps last-known-good rather than shipping junk.
        const fdTenures = new Set(out
            .filter((r) => r.product === "FD")
            .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`));
        if (fdTenures.size < 4)
            return [];
        return out;
    }
    /**
     * Locate the retail term-deposit table. Picks the first table whose data rows
     * carry a resolvable tenure in cells[0] and a parseable percentage in the
     * configured general column, with >= 4 distinct tenures. Subclasses may
     * override to disambiguate when several rate tables are present.
     */
    findPrivateRateTable(html) {
        for (const table of extractTables(html)) {
            const rows = extractRows(table);
            const dataRows = [];
            for (const cells of rows) {
                if (cells.length <= this.generalCol)
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
            if (dataRows.length >= 3 && distinct.size >= 4)
                return dataRows;
        }
        return null;
    }
}
