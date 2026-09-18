import { TableRateAdapter, defaultScheme } from "./base.js";

/**
 * Indian Overseas Bank adapter. Targets the deposit rate page (below ₹3 crore)
 * and savings rate. Runs a 444-day special tenure.
 */
export class IobAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "iob",
      // Confirmed rates page (domestic/NRO/NRE retail term deposits).
      fdUrl: [
        "https://www.iob.bank.in/en/domestic-nro-nre-retail-term-deposit-rates",
        "https://www.iob.bank.in/en/domestic-term-deposit",
      ],
      savingsUrls: [
        "https://www.iob.bank.in/en/savings-bank-interest-rate",
        "https://www.iob.bank.in/en/domestic-nro-nre-retail-term-deposit-rates",
      ],
      // IOB is a Liferay/JS site — render with a headless browser.
      renderJs: true,
      schemeNamer: (t) =>
        /\b444\b/.test(t) ? "444-day Special" : defaultScheme(t),
    });
  }
}
