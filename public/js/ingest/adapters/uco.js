import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * UCO Bank adapter. Targets the domestic term-deposit rate page (below
 * ₹3 crore) and savings rate. Runs a 444-day special tenure.
 */
export class UcoAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "uco",
            fdUrl: [
                "https://www.uco.bank.in/en/interest-rate-on-domestic-term-deposit",
                "https://www.uco.bank.in/en/deposit-interest-rates",
                "https://www.uco.bank.in/en/interest-rates",
            ],
            savingsUrls: [
                "https://www.uco.bank.in/en/interest-rate-on-saving-deposit",
                "https://www.uco.bank.in/en/interest-rate-on-domestic-term-deposit",
            ],
            schemeNamer: (t) => /\b444\b/.test(t) ? "444-day Special" : defaultScheme(t),
        });
    }
}
