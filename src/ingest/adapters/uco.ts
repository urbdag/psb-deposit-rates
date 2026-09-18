import { TableRateAdapter, defaultScheme } from "./base.js";

/**
 * UCO Bank adapter. Targets the domestic term-deposit rate page (below
 * ₹3 crore) and savings rate. Runs a 444-day special tenure.
 */
export class UcoAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "uco",
      // Discovered via diagnostics: the deposit-rate page on the Liferay site.
      fdUrl: [
        "https://www.uco.bank.in/en/web/guest/interest-rates-on-deposit-schemes",
        "https://www.uco.bank.in/en/web/guest/deposit",
      ],
      savingsUrls: [
        "https://www.uco.bank.in/en/web/guest/interest-rates-on-deposit-schemes",
      ],
      renderJs: true,
      schemeNamer: (t) =>
        /\b444\b/.test(t) ? "444-day Special" : defaultScheme(t),
    });
  }
}
