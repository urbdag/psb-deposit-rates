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
                "https://www.canarabank.bank.in/Domestic-Deposits",
                "https://www.canarabank.bank.in/deposit-interest-rate",
                "https://www.canarabank.bank.in/Fixed-Deposit",
            ],
            savingsUrls: [
                "https://www.canarabank.bank.in/Savings-Bank-Account",
                "https://www.canarabank.bank.in/deposit-interest-rate",
            ],
        });
    }
}
