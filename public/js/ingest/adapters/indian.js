import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * Indian Bank adapter. Targets the fixed-deposit rate page (below ₹3 crore)
 * and savings rate. Runs the "IND SECURE" 444-day special.
 *
 * NOTE: some Indian Bank pages return a bot-rejection ("Request Rejected"), so
 * this adapter may fall back to last-known-good; kept registered in case a
 * scrapeable endpoint responds.
 */
export class IndianAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "indian",
            // Confirmed via diagnostics: /en/deposit-rates has 10 rate tables in the
            // rendered HTML (Liferay/JS site, so renderJs is required).
            fdUrl: [
                "https://indianbank.bank.in/en/deposit-rates",
                "https://indianbank.bank.in/en/term-deposits",
            ],
            savingsUrls: ["https://indianbank.bank.in/en/deposit-rates"],
            renderJs: true,
            pdfUrl: [
                "https://indianbank.bank.in/documents/interest-rates/domestic-term-deposit.pdf",
                "https://indianbank.bank.in/en/wp-content/uploads/domestic-deposit-rates.pdf",
            ],
            schemeNamer: (t) => /ind secure/i.test(t) || /\b444\b/.test(t)
                ? "IND SECURE 444 days"
                : defaultScheme(t),
        });
    }
}
