import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * Bank of India adapter.
 * Scrapes BoI's domestic term-deposit rates (below ₹3 crore) and savings rate.
 * BoI runs special short tenures (e.g. a 400-day scheme) listed inline.
 */
export class BoiAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "boi",
            // Confirmed live page (the bare /interest-rate hub 403s, so omit it).
            fdUrl: ["https://bankofindia.co.in/interest-rate/rupee-term-deposit-rate"],
            savingsUrls: [
                "https://bankofindia.co.in/interest-rate-saving-bank-deposit-rates",
                "https://bankofindia.co.in/interest-rate/saving-bank-deposit-rate",
            ],
            schemeNamer: (t) => /\b400\b/.test(t) ? "400-day Special" : defaultScheme(t),
        });
    }
}
