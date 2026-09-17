import { TableRateAdapter } from "./base.js";
/**
 * Punjab & Sind Bank adapter. Targets the term-deposit rate page (below
 * ₹3 crore) and savings rate.
 */
export class PsbAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "psb",
            fdUrl: [
                "https://punjabandsindbank.co.in/content/domestic-term-deposit",
                "https://punjabandsindbank.co.in/content/interest-rates",
                "https://www.psbindia.com/content/domestic-term-deposit",
            ],
            savingsUrls: [
                "https://punjabandsindbank.co.in/content/saving-deposit",
                "https://punjabandsindbank.co.in/content/interest-rates",
            ],
        });
    }
}
