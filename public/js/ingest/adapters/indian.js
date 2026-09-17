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
            fdUrl: [
                "https://indianbank.in/departments/fixed-deposit/",
                "https://www.indianbank.in/departments/fixed-deposit/",
            ],
            savingsUrls: [
                "https://indianbank.in/departments/savings-bank/",
                "https://www.indianbank.in/departments/savings-bank/",
            ],
            schemeNamer: (t) => /ind secure/i.test(t) || /\b444\b/.test(t)
                ? "IND SECURE 444 days"
                : defaultScheme(t),
        });
    }
}
