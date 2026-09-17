import { fetchText } from "../http.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { parseTenure } from "../tenure.js";
/**
 * State Bank of India adapter — scrapes the official retail (below ₹3 crore)
 * domestic term-deposit rate page.
 *
 * Design notes
 * ------------
 * - No external deps: uses global fetch + the dependency-free HTML helpers, so
 *   it runs in CI with no install step.
 * - Resilient table location: SBI's page has several tables; we pick the one
 *   whose rows parse as (tenure, general%, senior%) rather than matching CSS
 *   classes that break on redesigns.
 * - `fetchAndParse` is split from `parse` so the parser is unit-testable with
 *   fixture HTML (no network). See scripts/test-sbi-adapter.mjs.
 *
 * If SBI restructures the page, `parse` returns [] and the ingest runner keeps
 * the last-known-good SBI rates rather than publishing nothing.
 */
export class SbiAdapter {
    constructor() {
        this.bankId = "sbi";
        this.retail = {
            minAmount: 0,
            maxAmount: 30000000,
            label: "Below ₹3 crore (retail)",
        };
    }
    async fetchRates() {
        const html = await fetchText(SbiAdapter.URL);
        const effectiveDate = extractEffectiveDate(html) ?? today();
        const rates = this.parse(html, effectiveDate);
        if (rates.length === 0) {
            throw new Error("SbiAdapter: no rates parsed (page structure may have changed)");
        }
        return rates;
    }
    /** Pure parser: HTML + effective date → RateEntry[]. Unit-testable. */
    parse(html, effectiveDate) {
        const source = {
            url: SbiAdapter.URL,
            effectiveDate,
            quality: "OFFICIAL",
        };
        const table = this.findRateTable(html);
        if (!table)
            return [];
        const out = [];
        for (const row of table) {
            const tenure = parseTenure(row.tenureText);
            if (!tenure)
                continue;
            // FD general
            out.push({
                bankId: this.bankId,
                product: "FD",
                customer: "GENERAL",
                ratePercent: row.general,
                tenure,
                amount: this.retail,
                source,
            });
            // FD senior
            if (row.senior != null) {
                out.push({
                    bankId: this.bankId,
                    product: "FD",
                    customer: "SENIOR",
                    ratePercent: row.senior,
                    tenure,
                    amount: this.retail,
                    source,
                });
            }
        }
        return out;
    }
    /**
     * Scan all tables; return the first whose data rows look like
     * (tenure text, general %, senior %). Requires ≥3 valid rows to avoid
     * matching an unrelated 3-column table.
     */
    findRateTable(html) {
        for (const table of extractTables(html)) {
            const parsed = [];
            for (const cells of extractRows(table)) {
                if (cells.length < 2)
                    continue;
                const tenure = parseTenure(cells[0]);
                if (!tenure)
                    continue; // header rows / non-tenure rows skipped
                // Find the first two percentage-looking cells after the tenure cell.
                const pcts = cells
                    .slice(1)
                    .map((c) => parsePercent(c))
                    .filter((n) => n != null);
                if (pcts.length === 0)
                    continue;
                parsed.push({
                    tenureText: cells[0],
                    general: pcts[0],
                    senior: pcts.length > 1 ? pcts[1] : null,
                });
            }
            if (parsed.length >= 3)
                return parsed;
        }
        return null;
    }
}
// Official retail domestic term-deposit rates (below ₹3 crore).
SbiAdapter.URL = "https://sbi.co.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits";
/** Try to read an "w.e.f. <date>" / "effective <date>" string off the page. */
function extractEffectiveDate(html) {
    const text = html.replace(/<[^>]*>/g, " ");
    const m = text.match(/(?:w\.?e\.?f\.?|effective(?:\s+from)?)\s*:?\s*(\d{1,2})[.\-/\s]([A-Za-z]+|\d{1,2})[.\-/\s](\d{2,4})/i);
    if (!m)
        return null;
    const day = m[1].padStart(2, "0");
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const months = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
    };
    let month = m[2];
    if (/[A-Za-z]/.test(month)) {
        month = months[month.slice(0, 3).toLowerCase()] ?? "01";
    }
    else {
        month = month.padStart(2, "0");
    }
    return `${year}-${month}-${day}`;
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
