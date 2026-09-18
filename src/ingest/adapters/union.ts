import { TableRateAdapter } from "./base.js";

/**
 * Union Bank of India adapter. Targets the domestic term-deposit rate page
 * (below ₹3 crore) and savings rate. Union runs a 555-day special tenure.
 */
export class UnionAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "union",
      // Confirmed rates page (rates & charges hub).
      fdUrl: [
        "https://www.unionbankofindia.bank.in/en/common/rates-and-charges",
      ],
      savingsUrls: [
        "https://www.unionbankofindia.bank.in/en/common/rates-and-charges",
      ],
      renderJs: true,
      schemeNamer: (t) => (/\b555\b/.test(t) ? "555-day Special" : undefined),
    });
  }
}
