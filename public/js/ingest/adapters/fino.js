import { TableRateAdapter } from "./base.js";
import { fetchPdfText } from "../pdf.js";
/**
 * Fino Payments Bank adapter (SAVINGS-ONLY).
 * -------------------------------------------------------------------------
 * Fino is an RBI-licensed PAYMENTS bank: by law it CANNOT offer fixed or
 * recurring deposits and caps balances (currently ~Rs 2 lakh/customer). So this
 * adapter emits ONLY SAVINGS rows and NEVER FD/RD.
 *
 * Structure discovery (CI diagnose, 4 rounds — see the task diagnostics digest):
 *   - The real RBI domain is `www.fino.bank.in` (Next.js). Its HTML pages
 *     (`/savings-account`, `/interest-rates`, `/`) render 0 tables and sit
 *     behind a Google reCAPTCHA iframe — there is NO parseable savings table in
 *     the DOM.
 *   - The authoritative source is a linked PDF rate card, present on every page:
 *     "Savings Account Interest Rates" (effective 1 Dec 2025). Fino publishes
 *     TIERED savings — the rate varies by balance band up to the payments-bank
 *     cap.
 *
 * Because the base savings pipeline only tries HTML/rendered pages (never PDF),
 * this adapter overrides `fetchRates` to fetch the PDF rate card via
 * `fetchPdfText` and parse it with a bespoke, PURE `parseSavingsPdf(text)` that
 * emits one SAVINGS row per balance slab (GENERAL + SENIOR) with a correct
 * AmountThreshold. The network fetch is split from the pure parser so the
 * parser is offline-testable (see scripts/test-adapters.mjs).
 *
 * FD handling: `fdUrl` is required by TableAdapterConfig but Fino has NO FD.
 * `parseFdRd` is overridden to always return [] and `deriveRdFromFd:false`, so
 * no FD/RD row is ever emitted. `fetchRates` publishes a SAVINGS-only result.
 */
/** Fino's savings-account PDF rate card (effective 1 Dec 2025). */
const FINO_PDF_URL = "https://www.fino.bank.in/files/fino/media/post_attachments/sites/default/files/2025-11/Savings%20Account%20Revised%20Interest%20Rates%20Effective%20from%201st%20Dec%202025.pdf";
/** Fino savings-account landing page (provenance / official-domain source). */
const FINO_SAVINGS_URL = "https://www.fino.bank.in/savings-account";
export class FinoAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "fino",
            // No FD product; point fdUrl at the savings page purely to satisfy the
            // required config. parseFdRd is overridden to return [] regardless.
            fdUrl: [FINO_SAVINGS_URL],
            savingsUrls: [FINO_SAVINGS_URL],
            deriveRdFromFd: false,
            pdfUrl: [FINO_PDF_URL],
        });
    }
    /** Payments bank: NEVER emit FD (or RD). */
    parseFdRd() {
        return [];
    }
    /** Payments bank: NEVER emit FD/RD from a PDF either. */
    parsePdfFdRd() {
        return [];
    }
    /**
     * SAVINGS-only fetch. The authoritative source is the linked PDF rate card;
     * the HTML page has no rate table. Fetch the PDF, extract its text, and parse
     * the tiered savings rows. Fino has no FD/RD, so a PDF-fetch failure means
     * this bank simply returns nothing and the ingest runner keeps last-known
     * good (never a fabricated rate).
     */
    async fetchRates() {
        const pdfUrls = Array.isArray(this.cfg.pdfUrl)
            ? this.cfg.pdfUrl
            : this.cfg.pdfUrl
                ? [this.cfg.pdfUrl]
                : [];
        const attempts = [];
        for (const url of pdfUrls) {
            try {
                const text = await fetchPdfText(url);
                const rows = this.parseSavingsPdf(text, url);
                if (rows.length > 0)
                    return rows;
                attempts.push(`${url} -> 0 savings rows (pdf)`);
            }
            catch (e) {
                attempts.push(`${url} -> ${String(e)} (pdf)`);
            }
        }
        throw new Error(`${this.bankId}: no SAVINGS rates from PDF rate card:\n    ` +
            attempts.join("\n    "));
    }
    /**
     * PURE parser: tiered savings rows from the PDF rate-card text. Offline-
     * testable. PDF text extraction collapses table cells, so a slab row usually
     * arrives as one line mixing a balance-band phrase with its rate, e.g.
     *
     *   "Up to Rs. 25,000            2.50%"
     *   "Above Rs. 25,000 to Rs. 1,00,000   3.00%"
     *   "Above Rs. 1,00,000            3.50%"
     *
     * For each line that carries BOTH a balance-band phrase and a plausible
     * savings % (2..7), emit a GENERAL + SENIOR SAVINGS row with an
     * AmountThreshold derived from the band. Lines without a balance band are
     * skipped (headers, footnotes). If NO tiered slab is found but a single
     * headline savings % is present, emit that as one all-balances row.
     */
    parseSavingsPdf(text, url) {
        const source = {
            url: url ?? FINO_SAVINGS_URL,
            effectiveDate: extractPdfEffectiveDate(text) ?? today(),
            quality: "OFFICIAL",
        };
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.replace(/\s+/g, " ").trim())
            .filter(Boolean);
        const slabs = [];
        const seen = new Set();
        for (const line of lines) {
            const band = parseBalanceBand(line);
            if (!band)
                continue;
            const rate = firstSavingsRate(line);
            if (rate == null)
                continue;
            const key = `${band.minAmount}-${band.maxAmount}-${rate}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            slabs.push({ amount: band, rate });
        }
        if (slabs.length === 0)
            return [];
        const anyBalance = {
            minAmount: 0,
            maxAmount: null,
            label: "All balances",
        };
        const tenure = {
            minDays: 0,
            maxDays: null,
            label: "Any tenure",
        };
        const out = [];
        for (const slab of slabs) {
            for (const customer of ["GENERAL", "SENIOR"]) {
                out.push({
                    bankId: this.bankId,
                    product: "SAVINGS",
                    customer,
                    ratePercent: slab.rate,
                    tenure,
                    amount: slabs.length === 1 ? anyBalance : slab.amount,
                    source,
                });
            }
        }
        return out;
    }
}
/** A plausible savings rate for a payments bank (2..7% p.a.). */
function plausibleSavingsRate(n) {
    return n >= 2 && n <= 7;
}
/** First plausible savings % on a line (accepts "3.00%" or bare "3.00"). */
function firstSavingsRate(line) {
    const hasPct = /\d{1,2}(?:\.\d{1,2})?\s*%/.test(line);
    const re = hasPct
        ? /(\d{1,2}(?:\.\d{1,2})?)\s*%/g
        : /(?<![\d.])(\d{1,2}\.\d{1,2})(?![\d.,])/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        const v = Number(m[1]);
        if (plausibleSavingsRate(v))
            return v;
    }
    return null;
}
/**
 * Parse an Indian balance-band phrase into an AmountThreshold. Handles the
 * common rate-card shapes:
 *   "Up to Rs. 25,000"                         -> [0, 25000]
 *   "Above Rs. 25,000 up to Rs. 1,00,000"      -> [25000, 100000]
 *   "Rs. 1,00,001 to Rs. 2,00,000"             -> [100001, 200000]
 *   "Above Rs. 1,00,000"                       -> [100000, null]
 * Amounts may be written in Indian grouping (1,00,000) or with lakh/crore
 * words. Returns null when the line has no balance-band signal.
 */
export function parseBalanceBand(line) {
    const lower = line.toLowerCase();
    // Must look like a balance band, not a tenure or a footnote.
    const hasBalanceWord = /balance|bal\.|amount|slab|up\s*to|upto|above|rs\.?|₹|inr|lakh|lac|crore/i.test(line);
    if (!hasBalanceWord)
        return null;
    // Reject tenure lines outright (payments banks have none, but guard anyway).
    if (/\b(day|days|month|months|year|years|yr)\b/i.test(line))
        return null;
    const amounts = extractRupeeAmounts(line);
    const hasUpto = /\b(up\s*to|upto|less than|below|maximum|max\b)/i.test(lower);
    const hasAbove = /\b(above|more than|greater than|exceeding|and above|\bmin\b)/i.test(lower);
    if (amounts.length === 0) {
        // "All balances" style with no figure but a balance word, allowing an
        // intervening word ("all savings balances", "any account balance").
        if (/\b(all|any)\b(?:\s+\w+){0,2}\s+balance/i.test(lower)) {
            return { minAmount: 0, maxAmount: null, label: cleanLabel(line) };
        }
        return null;
    }
    // Two figures => a bounded band [min, max].
    if (amounts.length >= 2) {
        const min = amounts[0];
        const max = amounts[amounts.length - 1];
        if (max <= min)
            return null;
        return { minAmount: min, maxAmount: max, label: cleanLabel(line) };
    }
    // One figure: decide by the qualifier.
    const only = amounts[0];
    if (hasUpto && !hasAbove) {
        return { minAmount: 0, maxAmount: only, label: cleanLabel(line) };
    }
    if (hasAbove && !hasUpto) {
        return { minAmount: only, maxAmount: null, label: cleanLabel(line) };
    }
    // Ambiguous single figure with a balance word: treat as "up to".
    return { minAmount: 0, maxAmount: only, label: cleanLabel(line) };
}
/**
 * Extract rupee amounts from a line, honoring Indian digit grouping and
 * lakh/crore words. Bare small integers that are clearly rates (already handled
 * elsewhere) are excluded by requiring either a currency marker/grouping or a
 * lakh/crore word.
 */
function extractRupeeAmounts(line) {
    const out = [];
    // 1) "1,00,000" / "25,000" grouped figures (optionally with Rs./₹).
    const grouped = line.match(/(?:rs\.?|₹|inr)?\s*([\d][\d,]{2,})/gi) ?? [];
    for (const g of grouped) {
        const digits = g.replace(/[^\d]/g, "");
        if (digits.length < 3)
            continue; // skip rates like "3" / "25"
        const n = Number(digits);
        if (Number.isFinite(n) && n >= 100)
            out.push(n);
    }
    // 2) "1 lakh" / "2 lac" / "1.5 lakh" / "1 crore" word forms.
    const wordRe = /(\d+(?:\.\d+)?)\s*(lakh|lac|crore|cr)\b/gi;
    let m;
    while ((m = wordRe.exec(line)) !== null) {
        const base = Number(m[1]);
        const mult = /cr/i.test(m[2]) ? 10000000 : 100000;
        out.push(Math.round(base * mult));
    }
    return out;
}
function cleanLabel(line) {
    // Drop the trailing rate figure(s) from the label.
    return line
        .replace(/(\d{1,2}(?:\.\d{1,2})?)\s*%.*$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
}
/** Effective date from PDF text ("Effective from 1st Dec 2025" etc.). */
export function extractPdfEffectiveDate(text) {
    const m = text.match(/effective(?:\s+from)?\s*:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i);
    if (!m)
        return null;
    const day = m[1].padStart(2, "0");
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
    const month = months[m[2].slice(0, 3).toLowerCase()];
    if (!month)
        return null;
    return `${m[3]}-${month}-${day}`;
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
