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
                "https://bankofmaharashtra.bank.in/interest-rate-on-deposits",
                "https://bankofmaharashtra.bank.in/domestic-term-deposits",
                "https://bankofmaharashtra.bank.in/personal-banking/deposits/term-deposit",
            ],
            savingsUrls: [
                "https://bankofmaharashtra.bank.in/interest-rate-on-deposits",
                "https://bankofmaharashtra.bank.in/savings-account",
            ],
            renderJs: true,
        });
    }
}
