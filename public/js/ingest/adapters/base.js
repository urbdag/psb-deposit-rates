import { fetchText } from "../http.js";
import { extractRows, extractTables, parsePercent, stripTags, } from "../html.js";
import { parseTenure } from "../tenure.js";
const RETAIL = {
    minAmount: 0,
    maxAmount: 30000000,
    label: "Below ₹3 crore (retail)",
};
const ANY_AMOUNT = {
    minAmount: 0,
    maxAmount: null,
    label: "Any amount",
};
const ALL_BALANCES = {
    minAmount: 0,
    maxAmount: null,
    label: "All balances",
};
export class TableRateAdapter {
    constructor(config) {
        this.bankId = config.bankId;
        this.cfg = {
            deriveRdFromFd: true,
            rdMinDays: 365,
            savingsUrls: [],
            ...config,
        };
    }
    async fetchRates() {
        const out = [];
        // Try each FD URL candidate until one yields parseable rows.
        const fdUrls = Array.isArray(this.cfg.fdUrl)
            ? this.cfg.fdUrl
            : [this.cfg.fdUrl];
        let fdRd = [];
        let lastErr;
        for (const url of fdUrls) {
            try {
                const fdHtml = await fetchText(url);
                const fdEff = extractEffectiveDate(fdHtml) ?? today();
                const parsed = this.parseFdRd(fdHtml, fdEff, url);
                if (parsed.length > 0) {
                    fdRd = parsed;
                    break;
                }
            }
            catch (e) {
                lastErr = e;
            }
        }
        if (fdRd.length === 0) {
            throw new Error(`${this.bankId}: no FD rates parsed from any candidate URL` +
                (lastErr ? ` (last error: ${String(lastErr)})` : ""));
        }
        out.push(...fdRd);
        const fdEff = fdRd[0].source.effectiveDate;
        for (const url of this.cfg.savingsUrls ?? []) {
            try {
                const savHtml = await fetchText(url);
                const savEff = extractEffectiveDate(savHtml) ?? fdEff;
                const savings = this.parseSavings(savHtml, savEff, url);
                if (savings.length > 0) {
                    out.push(...savings);
                    break;
                }
            }
            catch {
                // try next candidate; ingest keeps last-known-good if all fail
            }
        }
        return out;
    }
    /** Pure parser: FD (+ derived RD) from a term-deposit page. Unit-testable. */
    parseFdRd(html, effectiveDate, url) {
        const fdUrl = url ??
            (Array.isArray(this.cfg.fdUrl) ? this.cfg.fdUrl[0] : this.cfg.fdUrl);
        const source = {
            url: fdUrl,
            effectiveDate,
            quality: "OFFICIAL",
        };
        const table = findRateTable(html);
        if (!table)
            return [];
        const out = [];
        for (const row of table) {
            const tenure = parseTenure(row.tenureText);
            if (!tenure)
                continue;
            const isSpecial = isSingleDayTenure(tenure);
            const scheme = isSpecial
                ? (this.cfg.schemeNamer?.(row.tenureText) ??
                    defaultScheme(row.tenureText))
                : undefined;
            out.push(this.fd("GENERAL", row.general, tenure, source, scheme));
            if (row.senior != null)
                out.push(this.fd("SENIOR", row.senior, tenure, source, scheme));
            if (this.cfg.deriveRdFromFd &&
                !isSpecial &&
                tenure.minDays >= this.cfg.rdMinDays) {
                out.push(this.rd("GENERAL", row.general, tenure, source));
                if (row.senior != null)
                    out.push(this.rd("SENIOR", row.senior, tenure, source));
            }
        }
        return out;
    }
    /** Pure parser: flat savings rate. Unit-testable. */
    parseSavings(html, effectiveDate, url) {
        const firstFd = Array.isArray(this.cfg.fdUrl)
            ? this.cfg.fdUrl[0]
            : this.cfg.fdUrl;
        const source = {
            url: url ?? this.cfg.savingsUrls?.[0] ?? firstFd,
            effectiveDate,
            quality: "OFFICIAL",
        };
        const rate = extractSavingsRate(html);
        if (rate == null)
            return [];
        const base = {
            bankId: this.bankId,
            product: "SAVINGS",
            ratePercent: rate,
            tenure: { minDays: 0, maxDays: null, label: "Any tenure" },
            amount: ALL_BALANCES,
            source,
        };
        return [
            { ...base, customer: "GENERAL" },
            { ...base, customer: "SENIOR" },
        ];
    }
    fd(customer, ratePercent, tenure, source, scheme) {
        return {
            bankId: this.bankId,
            product: "FD",
            customer,
            ratePercent,
            tenure,
            amount: RETAIL,
            ...(scheme ? { scheme } : {}),
            source,
        };
    }
    rd(customer, ratePercent, tenure, source) {
        return {
            bankId: this.bankId,
            product: "RD",
            customer,
            ratePercent,
            tenure,
            amount: ANY_AMOUNT,
            source,
        };
    }
}
// --- shared helpers --------------------------------------------------------
export function isSingleDayTenure(t) {
    return t.maxDays != null && t.minDays === t.maxDays;
}
/** Generic special-scheme namer from a tenure label. */
export function defaultScheme(tenureText) {
    const m = tenureText.match(/(\d+)\s*days?/i);
    return m ? `${m[1]}-day Special` : "Special Tenure";
}
/**
 * Scan all tables; return the first whose rows look like
 * (tenure text, general %, senior %). Requires ≥3 valid rows.
 */
export function findRateTable(html) {
    for (const table of extractTables(html)) {
        const parsed = [];
        for (const cells of extractRows(table)) {
            if (cells.length < 2)
                continue;
            const tenure = parseTenure(cells[0]);
            if (!tenure)
                continue;
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
export function extractSavingsRate(html) {
    const text = stripTags(html);
    const near = text.match(/(\d(?:\.\d{1,2})?)\s*%\s*p\.?\s*a\.?/i);
    const candidate = near ? parsePercent(near[0]) : parsePercent(text);
    if (candidate == null)
        return null;
    return candidate >= 0.5 && candidate <= 5 ? candidate : null;
}
export function extractEffectiveDate(html) {
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
export function today() {
    return new Date().toISOString().slice(0, 10);
}
