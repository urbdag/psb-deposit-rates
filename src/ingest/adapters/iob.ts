import { TableRateAdapter, defaultScheme } from "./base.js";

/**
 * Indian Overseas Bank adapter. Targets the deposit rate page (below ₹3 crore)
 * and savings rate. Runs a 444-day special tenure.
 */
export class IobAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "iob",
      fdUrl: [
        "https://www.iob.in/Interest_Rate_Deposit.aspx",
        "https://www.iob.in/Domestic_Term_Deposits",
        "https://www.iob.in/RupeeDeposit.aspx",
      ],
      savingsUrls: [
        "https://www.iob.in/Savings_Bank_Interest_Rate",
        "https://www.iob.in/Interest_Rate_Deposit.aspx",
      ],
      schemeNamer: (t) =>
        /\b444\b/.test(t) ? "444-day Special" : defaultScheme(t),
    });
  }
}
