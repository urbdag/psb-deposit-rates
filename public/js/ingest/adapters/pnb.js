import { TableRateAdapter, defaultScheme, isSingleDayTenure, } from "./base.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { parseTenure } from "../tenure.js";
const PNB_FD_URL = "https://pnb.bank.in/interest-rates-deposit.html";
/**
 * Punjab National Bank adapter.
 *
 * PNB's term-deposit page (pnb.bank.in/interest-rates-deposit.html) carries
 * ~24 tables: savings balance-slab tables, several NRE/bulk (₹3cr–₹10cr)
 * tables, a PNB TAX SAVER table (with a staff / Existing-vs-Revised column
 * split), a long-tenure "PNB Uttam" special table AND the main retail
 * "Domestic/NRO Fixed Deposit Scheme" ladder. The main ladder is the one that
 * spans the full 7-day-to-10-year tenure range, but its data rows lead with a
 * serial-number column:
 *
 *   [Sl. No, Period, Revised Rates For Public, *Senior Citizens, #Super Senior]
 *
 * i.e. the tenure is in cells[1] (NOT cells[0]) and the general/senior rates
 * are cells[2]/cells[3]. The generic findRateTable (base.ts) reads cells[0] as
 * the tenure, so every row of the main ladder fails to parse; it then falls
 * through to the first table whose cells[0] IS a tenure — the PNB TAX SAVER
 * table, which lists only 5-year-and-longer buckets. That is why PNB used to
 * publish only 4 FD rows, all ≥5 years, and dropped out of every shorter-tenure
 * ranking (incl. the 1-year ladder).
 *
 * This bespoke parser instead selects the retail Domestic FD table by content
 * signature (a "Rates For Public" header and rows whose cells[1] is a tenure +
 * cells[2] a percent), skipping the NRE/bulk (₹3–10 crore) tables and the
 * staff/Existing-vs-Revised TAX SAVER split, and maps the correct columns. The
 * ≥4-distinct-FD-tenures junk guard is preserved so a future page redesign
 * keeps last-known-good rather than shipping a partial slice as OFFICIAL.
 */
export class PnbAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "pnb",
            fdUrl: [
                PNB_FD_URL,
                "https://pnb.bank.in/Interest-Rates-Deposit.aspx",
                "https://www.pnbindia.in/interest-rates-deposit.html",
            ],
            savingsUrls: [
                "https://pnb.bank.in/saving-fund-account.html",
                "https://pnb.bank.in/interest-rates-saving.html",
                "https://pnb.bank.in/interest-rates-deposit.html",
            ],
        });
    }
    parseFdRd(html, effectiveDate, url) {
        const fdUrl = url ?? PNB_FD_URL;
        const source = {
            url: fdUrl,
            effectiveDate,
            quality: "OFFICIAL",
        };
        const table = findPnbDomesticTable(html);
        // If the real PNB Domestic ladder signature is absent (e.g. a generic
        // PSU-style table with the tenure in cells[0]), defer to the shared base
        // parser so simpler layouts still parse.
        if (!table)
            return super.parseFdRd(html, effectiveDate, url);
        const out = [];
        for (const cells of table) {
            // cells: [Sl.No, Period, Public(general), Senior, (SuperSenior)]
            const tenureText = cells[1];
            const tenure = parseTenure(tenureText);
            if (!tenure)
                continue;
            if (tenure.maxDays != null && tenure.maxDays < tenure.minDays)
                continue;
            const general = parsePercent(cells[2]);
            if (general == null)
                continue;
            const senior = cells.length > 3 ? parsePercent(cells[3]) : null;
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
        // Junk guard (mirrors the base): a genuine retail ladder has several tenure
        // buckets. Reject if fewer than 4 distinct FD tenures parsed so a future
        // redesign keeps last-known-good rather than shipping a partial slice.
        const fdTenures = new Set(out
            .filter((r) => r.product === "FD")
            .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`));
        if (fdTenures.size < 4)
            return [];
        return out;
    }
}
/**
 * Locate PNB's retail Domestic Fixed Deposit ladder and return its data rows.
 *
 * The main ladder's data rows lead with a serial-number column, so the tenure
 * sits in cells[1] and the general/senior RoI in cells[2]/cells[3]. Identified
 * by a "Rates for Public" (general) header signature, while rejecting the
 * NRE / bulk (₹3cr–₹10cr) tables whose header carries an amount-slab split
 * ("less than Rs. 3 Cr." / "Rs. 3 Cr. To Rs. 10 Cr.") — those interleave two
 * amount slabs so cells[2] would be a bulk rate, not the retail public rate.
 *
 * Among qualifying tables we return the one yielding the MOST distinct FD
 * tenures so the full short-to-long ladder wins over any partial special table.
 */
function findPnbDomesticTable(html) {
    let best = null;
    let bestCount = 0;
    for (const table of extractTables(html)) {
        const tableText = table.toLowerCase();
        // Must be a retail "Rates for Public" domestic table.
        if (!/rates?\s+for\s+public/.test(tableText))
            continue;
        // Reject NRE and bulk (₹3cr–₹10cr) amount-slab tables: their columns are
        // an amount split (Existing/Revised per slab), not (public, senior).
        if (/\bnre\b/.test(tableText))
            continue;
        if (/3\s*cr\b.*(?:10\s*cr|rs\.?\s*10)/.test(tableText))
            continue;
        if (/rs\.?\s*3\s*cr.*to.*rs\.?\s*10\s*cr/.test(tableText))
            continue;
        const rows = extractRows(table);
        const dataRows = [];
        for (const cells of rows) {
            // Need at least [Sl.No, Period, Public] and a tenure in cells[1].
            if (cells.length < 3)
                continue;
            const tenure = parseTenure(cells[1]);
            if (!tenure)
                continue;
            if (parsePercent(cells[2]) == null)
                continue; // general RoI required
            dataRows.push(cells);
        }
        const distinctTenures = new Set(dataRows.map((c) => {
            const t = parseTenure(c[1]);
            return t ? `${t.minDays}-${t.maxDays}` : "";
        }));
        if (dataRows.length >= 3 &&
            distinctTenures.size >= 4 &&
            distinctTenures.size > bestCount) {
            best = dataRows;
            bestCount = distinctTenures.size;
        }
    }
    return best;
}
