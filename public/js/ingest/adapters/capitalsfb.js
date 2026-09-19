import { TableRateAdapter, defaultScheme, isSingleDayTenure, } from "./base.js";
import { extractRows, extractTables, parsePercent } from "../html.js";
import { parseTenure } from "../tenure.js";
const CAPITAL_FD_URL = "https://www.capital.bank.in/interest-rates/callable-domestic-term-deposit";
/**
 * Capital Small Finance Bank adapter.
 *
 * Capital SFB publishes its retail (callable domestic) term-deposit rates as
 * TWO separate plain 2-column tables on the same page, NOT one (tenure,
 * general, senior) grid:
 *
 *   TABLE[0] = GENERAL public: rows of [tenure, rate%]
 *   TABLE[1] = SENIOR citizen: rows of [tenure, rate%]
 *
 * Both tables share the same tenure ladder plus a "Special category" sub-header
 * row followed by single-tenure specials (12 Months / 400 Days / 600 Days /
 * 900 Days). The generic (tenure, general, senior) parser cannot handle this
 * because the senior rate lives in a DIFFERENT table, so Capital needs a
 * bespoke parser that reads table[0] as GENERAL and table[1] as SENIOR and
 * joins them by tenure label (closest reference: canara.ts / pnb.ts).
 *
 * A plain HTTP fetch has previously exposed the tables; `renderJs` is enabled
 * as a fallback so a client-hydrated render still yields the ladder. RD is
 * derived from FD card rates for >= 1yr standard buckets (Capital does not
 * publish a separate RD ladder here). Savings is not on this page, so it falls
 * back to any last-known-good via merge-by-product.
 */
export class CapitalsfbAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "capitalsfb",
            fdUrl: [CAPITAL_FD_URL],
            renderJs: true,
            schemeNamer: (t) => {
                const m = t.match(/(\d+)\s*days?/i);
                return m ? `Capital ${m[1]} Days Deposit` : defaultScheme(t);
            },
        });
    }
    /**
     * Capital-specific FD (+ derived RD) parser. Reads the first two rate tables
     * on the page: table[0] carries GENERAL rows, table[1] carries SENIOR rows,
     * both as [tenure, rate%]. We build a tenure -> senior% map from table[1],
     * then emit GENERAL (+ matched SENIOR) rows from table[0].
     */
    parseFdRd(html, effectiveDate, url) {
        const fdUrl = url ?? CAPITAL_FD_URL;
        const source = {
            url: fdUrl,
            effectiveDate,
            quality: "OFFICIAL",
        };
        const rateTables = findCapitalRateTables(html);
        if (rateTables.length < 1)
            return [];
        const generalRows = rateTables[0];
        // Senior rows (table[1]) keyed by a normalized tenure signature so we can
        // join them to the general rows. When only one rate table is present we
        // still publish GENERAL-only rather than dropping the bank.
        const seniorByTenure = new Map();
        if (rateTables.length >= 2) {
            for (const [tenureText, rate] of rateTables[1]) {
                const tenure = parseTenure(tenureText);
                if (!tenure)
                    continue;
                seniorByTenure.set(tenureKey(tenure), rate);
            }
        }
        const out = [];
        for (const [tenureText, general] of generalRows) {
            const tenure = parseTenure(tenureText);
            if (!tenure)
                continue;
            if (tenure.maxDays != null && tenure.maxDays < tenure.minDays)
                continue;
            const senior = seniorByTenure.get(tenureKey(tenure)) ?? null;
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
        // the two-table layout keeps last-known-good rather than shipping junk.
        const fdTenures = new Set(out
            .filter((r) => r.product === "FD")
            .map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`));
        if (fdTenures.size < 4)
            return [];
        return out;
    }
}
/** Stable key for joining a general row to its senior counterpart. */
function tenureKey(t) {
    return `${t.minDays}-${t.maxDays}`;
}
/**
 * Collect Capital's simple 2-column rate tables as ordered [tenure, rate%]
 * pairs. A rate table is one whose data rows are (tenure text, single %); the
 * "Special category" sub-header and any non-tenure/non-% rows are skipped. Only
 * tables with >= 4 parseable tenure rows are returned (so a stray 2-cell
 * footnote/policy table is not mistaken for a rate ladder).
 */
export function findCapitalRateTables(html) {
    const out = [];
    for (const table of extractTables(html)) {
        const pairs = [];
        for (const cells of extractRows(table)) {
            if (cells.length < 2)
                continue;
            const tenure = parseTenure(cells[0]);
            if (!tenure)
                continue;
            // The rate is the first parseable % in the remaining cells.
            const rate = cells
                .slice(1)
                .map((c) => parsePercent(c))
                .find((n) => n != null);
            if (rate == null)
                continue;
            pairs.push([cells[0], rate]);
        }
        const distinct = new Set(pairs.map(([t]) => {
            const parsed = parseTenure(t);
            return parsed ? tenureKey(parsed) : "";
        }));
        if (pairs.length >= 4 && distinct.size >= 4)
            out.push(pairs);
    }
    return out;
}
