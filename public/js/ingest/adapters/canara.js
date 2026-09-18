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
            // Discovered via diagnostics (lowercase Liferay paths on .bank.in).
            fdUrl: [
                "https://www.canarabank.bank.in/fixed-deposit",
                "https://www.canarabank.bank.in/444-days-deposit",
                "https://www.canarabank.bank.in/kamadhenu-deposit",
            ],
            savingsUrls: [
                "https://www.canarabank.bank.in/method-of-calculation-of-interest-on-deposits",
                "https://www.canarabank.bank.in/fixed-deposit",
            ],
            renderJs: true,
        });
    }
}
