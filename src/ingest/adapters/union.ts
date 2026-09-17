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
        "https://www.unionbankofindia.bank.in/en/Interest-Rate-Deposit",
        "https://www.unionbankofindia.bank.in/en/interest-rates",
        "https://www.unionbankofindia.bank.in/en/home/interest-rate-deposit",
      ],
      savingsUrls: [
        "https://www.unionbankofindia.bank.in/en/Interest-Rate-Saving-Bank",
        "https://www.unionbankofindia.bank.in/en/Interest-Rate-Deposit",
      ],
      renderJs: true,
      schemeNamer: (t) => (/\b555\b/.test(t) ? "555-day Special" : undefined),
    });
  }
}
