import { TableRateAdapter } from "./base.js";

/**
 * Punjab & Sind Bank adapter. Targets the term-deposit rate page (below
 * ₹3 crore) and savings rate.
 */
export class PsbAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "psb",
      fdUrl: [
        "https://punjabandsind.bank.in/content/domestic-term-deposit",
        "https://punjabandsind.bank.in/content/interest-rates",
        "https://punjabandsind.bank.in/term-deposit-interest-rates",
      ],
      savingsUrls: [
        "https://punjabandsind.bank.in/content/saving-deposit",
        "https://punjabandsind.bank.in/content/interest-rates",
      ],
    });
  }
}
