import { TableRateAdapter } from "./base.js";

/**
 * Punjab & Sind Bank adapter. Targets the term-deposit rate page (below
 * ₹3 crore) and savings rate.
 */
export class PsbAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "psb",
      // Discovered via diagnostics: /content/interestdom = domestic deposit rates.
      fdUrl: [
        "https://punjabandsind.bank.in/content/interestdom",
        "https://punjabandsind.bank.in/content/interestdom-cir",
        "https://punjabandsind.bank.in/content/interest-rates",
      ],
      savingsUrls: [
        "https://punjabandsind.bank.in/content/interestdom",
        "https://punjabandsind.bank.in/content/interest-rates",
      ],
      renderJs: true,
    });
  }
}
