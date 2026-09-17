import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * State Bank of India adapter.
 * Scrapes the retail (< ₹3 crore) domestic term-deposit table (FD, plus RD
 * derived from FD card rates for ≥1yr tenures, plus single-day specials such as
 * the 444-day "Amrit Vrishti"), and the flat savings rate.
 */
export class SbiAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "sbi",
            fdUrl: "https://sbi.co.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits",
            savingsUrls: [
                "https://bank.sbi/web/interest-rates/savings-bank-deposits",
                "https://sbi.co.in/web/interest-rates/savings-bank-deposits",
                "https://sbi.co.in/web/interest-rates/deposit-rates/savings-bank-rate",
            ],
            schemeNamer: (t) => /amrit vrishti/i.test(t) || /\b444\b/.test(t)
                ? "Amrit Vrishti 444 days"
                : defaultScheme(t),
        });
    }
}
