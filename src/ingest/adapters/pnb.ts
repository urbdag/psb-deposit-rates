import { TableRateAdapter } from "./base.js";

/**
 * Punjab National Bank adapter.
 * Scrapes PNB's domestic term-deposit rates (below ₹3 crore) and savings rate.
 * PNB lists special tenures (e.g. 444 days) inline in the term-deposit table.
 */
export class PnbAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "pnb",
      fdUrl: [
        "https://pnb.bank.in/interest-rates-deposit.html",
        "https://pnb.bank.in/Interest-Rates-Deposit.aspx",
        "https://www.pnbindia.in/interest-rates-deposit.html",
      ],
      savingsUrls: [
        "https://pnb.bank.in/saving-fund-account.html",
        "https://pnb.bank.in/interest-rates-saving.html",
        "https://pnb.bank.in/interest-rates-deposit.html",
      ],
    });
  }
}
