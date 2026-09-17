import { TableRateAdapter } from "./base.js";
/**
 * Canara Bank adapter. Targets the domestic term-deposit rate page (below
 * ₹3 crore) and savings rate. Canara lists special tenures (e.g. 444 days)
 * inline in the term-deposit table.
 */
export class CanaraAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "canara",
            fdUrl: [
                "https://www.canarabank.com/Fixed-Deposit",
                "https://canarabank.com/Fixed-Deposit",
                "https://www.canarabank.com/interest-rate-domestic-term-deposit",
            ],
            savingsUrls: [
                "https://www.canarabank.com/Savings-Bank-Account",
                "https://canarabank.com/Savings-Bank-Account",
            ],
        });
    }
}
