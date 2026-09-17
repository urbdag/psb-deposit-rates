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
        "https://www.bankofmaharashtra.in/interest-rate-on-deposits",
        "https://bankofmaharashtra.in/interest-rate-on-deposits",
        "https://www.bankofmaharashtra.in/personal-banking/deposits/term-deposit",
      ],
      savingsUrls: [
        "https://www.bankofmaharashtra.in/interest-rate-on-deposits",
        "https://www.bankofmaharashtra.in/savings-account",
      ],
    });
  }
}
