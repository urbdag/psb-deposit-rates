import { TableRateAdapter, defaultScheme, isSingleDayTenure, } from "./base.js";
import { extractRateGlobals } from "../html.js";
import { resolvePrivateTenure } from "../private-tenure.js";
const ICICI_FD_URL = "https://www.icicibank.com/personal-banking/deposits/fixed-deposit/fd-interest-rates";
/**
 * ICICI Bank adapter.
 *
 * ICICI's FD-interest-rates page is client-hydrated: only two "featured" tail
 * rows (3Y1D–5Y, 5Y1D–10Y) are ever emitted into the rendered <table>. The
 * FULL retail domestic term-deposit ladder lives in a client-side JS global,
 * `window.interestData` — an array of rate tables, whose FIRST entry is the
 * retail (< ₹3 crore) Domestic FD ladder:
 *
 *   window.interestData[0] = [
 *     { tenure: "7 to 45 Days",           c1: 2.75, c2: 3.25, c3: 1.1, c4: 1.1 },
 *     { tenure: "1 Year to < 18 Months",  c1: 6.25, c2: 6.75, ... },
 *     ...
 *     { tenure: "5 Years 1 Day to 10 Years", c1: 6.5, c2: 7,  ... },
 *     { tenure: "5Y (Tax Saver FD)",      c1: 6.5, c2: 7.1, ... },
 *   ]
 *
 * where `c1` is the retail GENERAL rate and `c2` the retail SENIOR rate
 * (confirmed against the two rows ICICI does render: "3 Years 1 Day to 5 Years"
 * shows General 6.5% / Senior 7.1% == c1 6.5 / c2 7.1). `c3`/`c4` are the
 * ₹3cr–₹5cr bulk columns and are NOT retail, so they are ignored.
 *
 * A plain HTTP fetch yields no rate table, so `renderJs` is required. The
 * render helper ({@link fetchRendered}) serializes `window.interestData` into
 * an inert `<script id="__rate_globals__">` JSON block appended to the returned
 * HTML; this adapter reads it back via {@link extractRateGlobals} and parses
 * the first table. If the global is ever absent (page redesign), the parser
 * returns [] and the ingest runner keeps last-known-good.
 */
export class IciciAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "icici",
            fdUrl: [ICICI_FD_URL],
            savingsUrls: [
                "https://www.icicibank.com/personal-banking/accounts/savings-account/savings-account-interest-rates",
            ],
            renderJs: true,
        });
    }
    parseFdRd(html, effectiveDate, url) {
        const fdUrl = url ?? ICICI_FD_URL;
        const source = { url: fdUrl, effectiveDate, quality: "OFFICIAL" };
        const rows = extractIciciRetailRows(html);
        if (!rows)
            return [];
        const out = [];
        for (const row of rows) {
            // Skip the Tax Saver FD product row: it is a distinct 5-year lock-in
            // product, not part of the standard retail tenure ladder (and its bare
            // "5Y" label would collide with the regular 5-year bucket).
            if (/tax\s*saver/i.test(row.tenure))
                continue;
            const tenure = resolvePrivateTenure(row.tenure);
            if (!tenure)
                continue;
            if (tenure.maxDays != null && tenure.maxDays < tenure.minDays)
                continue;
            const general = row.c1;
            const senior = row.c2;
            if (typeof general !== "number" || Number.isNaN(general))
                continue;
            const hasSenior = typeof senior === "number" && !Number.isNaN(senior);
            const isSpecial = isSingleDayTenure(tenure);
            const scheme = isSpecial
                ? (this.cfg.schemeNamer?.(row.tenure) ?? defaultScheme(row.tenure))
                : undefined;
            out.push(this.fd("GENERAL", general, tenure, source, scheme));
            if (hasSenior)
                out.push(this.fd("SENIOR", senior, tenure, source, scheme));
            if (this.cfg.deriveRdFromFd &&
                !isSpecial &&
                tenure.minDays >= this.cfg.rdMinDays) {
                out.push(this.rd("GENERAL", general, tenure, source));
                if (hasSenior)
                    out.push(this.rd("SENIOR", senior, tenure, source));
            }
        }
        // Junk guard (mirrors the base): a real retail card has several tenure
        // buckets. Reject on < 4 distinct FD tenures so a page/global redesign that
        // breaks the mapping keeps last-known-good rather than shipping junk.
        const fdTenures = new Set(out
            .filter((r) => r.product === "FD")
            .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`));
        if (fdTenures.size < 4)
            return [];
        return out;
    }
}
/**
 * Recover ICICI's retail (< ₹3 crore) Domestic FD rows from the rendered page.
 * Reads the `window.interestData` global serialized into the page by
 * {@link fetchRendered} and returns its FIRST table (the retail Domestic
 * ladder), or null when the global is absent or malformed.
 */
export function extractIciciRetailRows(html) {
    const globals = extractRateGlobals(html);
    if (!globals)
        return null;
    const interestData = globals["interestData"];
    if (!Array.isArray(interestData) || interestData.length === 0)
        return null;
    const first = interestData[0];
    if (!Array.isArray(first) || first.length === 0)
        return null;
    const rows = [];
    for (const r of first) {
        if (r &&
            typeof r === "object" &&
            typeof r.tenure === "string" &&
            typeof r.c1 === "number") {
            rows.push(r);
        }
    }
    return rows.length > 0 ? rows : null;
}
