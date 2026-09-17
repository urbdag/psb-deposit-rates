import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * Indian Overseas Bank adapter. Targets the deposit rate page (below ₹3 crore)
 * and savings rate. Runs a 444-day special tenure.
 */
export class IobAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "iob",
            fdUrl: [
                "https://www.iob.bank.in/en/Interest_Rate_Deposit",
                "https://www.iob.bank.in/en/domestic-term-deposit",
                "https://www.iob.bank.in/en/interest-rates",
            ],
            savingsUrls: [
                "https://www.iob.bank.in/en/Savings_Bank_Interest_Rate",
                "https://www.iob.bank.in/en/interest-rates",
            ],
            schemeNamer: (t) => /\b444\b/.test(t) ? "444-day Special" : defaultScheme(t),
        });
    }
}
