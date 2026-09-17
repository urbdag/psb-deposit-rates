import { TableRateAdapter } from "./base.js";

/**
 * Central Bank of India adapter. Targets the deposit interest-rates page
 * (below ₹3 crore) and savings rate. Central lists a 444-day special inline.
 */
export class CentralAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "central",
      fdUrl: [
        "https://www.centralbankofindia.co.in/en/interest-rates-on-deposit",
        "https://centralbankofindia.co.in/en/interest-rates-on-deposit",
      ],
      savingsUrls: [
        "https://www.centralbankofindia.co.in/en/saving-account-interest-rate",
        "https://www.centralbankofindia.co.in/en/interest-rates-on-deposit",
      ],
    });
  }
}
