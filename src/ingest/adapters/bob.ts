import { TableRateAdapter, defaultScheme } from "./base.js";

/**
 * Bank of Baroda adapter.
 * Scrapes BoB's retail domestic term-deposit rates (below ₹3 crore) and savings
 * rate. BoB runs named special-tenure schemes (e.g. the 555-day "Golden Goal"
 * and 444-day "Square Drive"), tagged from the tenure label when present.
 */
export class BobAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "bob",
      fdUrl: [
        "https://www.bankofbaroda.in/interest-rates-and-charges/deposits-interest-rates",
        "https://www.bankofbaroda.in/interest-rate-and-service-charges/deposits-interest-rates",
        "https://www.bankofbaroda.in/personal-banking/accounts/deposits/fixed-deposits",
      ],
      savingsUrls: [
        "https://www.bankofbaroda.in/interest-rates-and-charges/deposits-interest-rates",
        "https://www.bankofbaroda.in/personal-banking/accounts/saving-accounts",
      ],
      schemeNamer: (t) => {
        if (/golden goal/i.test(t) || /\b555\b/.test(t))
          return "bob Golden Goal 555 days";
        if (/square drive/i.test(t) || /\b444\b/.test(t))
          return "bob Square Drive 444 days";
        return defaultScheme(t);
      },
    });
  }
}
