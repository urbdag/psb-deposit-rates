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
                "https://new.canarabank.com/Domestic-Deposits",
                "https://new.canarabank.com/deposit-interest-rate",
                "https://www.canarabank.com/Fixed-Deposit",
            ],
            savingsUrls: [
                "https://new.canarabank.com/Savings-Bank-Account",
                "https://www.canarabank.com/Savings-Bank-Account",
            ],
        });
    }
}
