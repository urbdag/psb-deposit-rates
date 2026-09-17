import { TableRateAdapter } from "./base.js";

/**
 * Union Bank of India adapter. Targets the domestic term-deposit rate page
 * (below ₹3 crore) and savings rate. Union runs a 555-day special tenure.
 */
export class UnionAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "union",
      fdUrl: [
        "https://www.unionbankofindia.co.in/en/Interest-Rate-Deposit",
        "https://www.unionbankofindia.co.in/english/interest-rate-deposit.aspx",
        "https://www.unionbankofindia.co.in/en/interest-rates",
      ],
      savingsUrls: [
        "https://www.unionbankofindia.co.in/en/Interest-Rate-Saving-Bank",
        "https://www.unionbankofindia.co.in/en/Interest-Rate-Deposit",
      ],
      schemeNamer: (t) => (/\b555\b/.test(t) ? "555-day Special" : undefined),
    });
  }
}
