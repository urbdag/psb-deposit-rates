import { TableRateAdapter } from "./base.js";
/**
 * Bank of Maharashtra adapter. Targets the term-deposit rate page (below
 * ₹3 crore) and savings rate.
 */
export class MahaAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "maha",
            fdUrl: [
                "https://bankofmaharashtra.in/interest-rate-on-deposits",
                "https://bankofmaharashtra.in/domestic-term-deposits",
                "https://www.bankofmaharashtra.in/interest-rate-on-deposits",
            ],
            savingsUrls: [
                "https://bankofmaharashtra.in/savings-bank-account-interest-rate",
                "https://bankofmaharashtra.in/interest-rate-on-deposits",
            ],
        });
    }
}
