/**
 * EXAMPLE per-bank adapter (State Bank of India).
 * -------------------------------------------------------------------------
 * This is a template showing the shape a real scraper takes. It is NOT wired
 * into the build because this environment has no outbound internet access, and
 * real parsing of SBI's rate page/PDF needs to be validated against the live
 * markup. Use it as the starting point for a real implementation:
 *
 *   1. Fetch the bank's published deposit-rate page (or PDF).
 *   2. Parse the tenure/amount/senior columns into RateEntry rows.
 *   3. Stamp source.quality = "OFFICIAL" with the page URL + effective date.
 *
 * Recommended parsing libs (add via your deploy environment's npm):
 *   - HTML: cheerio
 *   - PDF:  pdf-parse / pdfjs-dist
 */
export class SbiAdapter {
    constructor() {
        this.bankId = "sbi";
    }
    async fetchRates() {
        // Pseudocode outline — replace with real fetch + parse.
        //
        // const html = await (await fetch(SBI_FD_URL)).text();
        // const $ = cheerio.load(html);
        // const rows = $("table.deposit-rates tr").toArray();
        // return rows.map(parseRow);
        throw new Error("SbiAdapter is an example template and is not implemented. " +
            "Implement fetch + parse against the live SBI rate page before enabling.");
    }
}
