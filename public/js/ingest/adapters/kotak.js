import { PrivateTableAdapter } from "./private-base.js";
/**
 * Kotak Mahindra Bank adapter.
 *
 * Kotak's domestic term-deposit table is a multi-column amount-slab grid:
 *
 *   [tenure,
 *    Regular  "Less than Rs.3 Crore",   Regular  "Rs.3 Cr & above but < 5 Cr",
 *    Senior   "Less than Rs.3 Crore",   Senior   "Rs.3 Cr & above but < 5 Cr"]
 *
 * The correct RETAIL columns are cells[1] (regular < ₹3cr) and cells[3]
 * (senior < ₹3cr). cells[2] is the ₹3-5cr regular rate — a generic
 * (tenure, %, %) parser would wrongly read it as the senior rate. Mapping
 * generalCol=1 / seniorCol=3 fixes that.
 *
 * The rate card is an AEM (Adobe Experience Manager) `ratecardwrapper`
 * component hydrated client-side: a plain HTTP fetch of the page returns the
 * shell with NO rate <table> (0 rows), while a headless-browser render exposes
 * all 7 tables including the retail grid above (confirmed via the diagnose
 * workflow). So `renderJs: true` is required — the base retries the failed
 * plain-HTTP fetch with Playwright (available in the ingest CI job) and only
 * then finds the table.
 */
export class KotakAdapter extends PrivateTableAdapter {
    constructor() {
        super({
            bankId: "kotak",
            fdUrl: [
                "https://www.kotak.com/en/personal-banking/deposits/fixed-deposit/fixed-deposit-interest-rate.html",
            ],
            savingsUrls: [
                "https://www.kotak.com/en/personal-banking/accounts/savings-account/interest-rates.html",
            ],
            // Client-hydrated AEM rate card: plain HTTP yields 0 tables; render it.
            renderJs: true,
            // Retail (< ₹3 crore) columns of the 4-column Regular/Senior × amount grid.
            generalCol: 1,
            seniorCol: 3,
        });
    }
}
