import { TableRateAdapter, defaultScheme } from "./base.js";

/**
 * Bank of Baroda adapter.
 * Targets BoB's retail domestic term-deposit rates (below ₹3 crore) + savings.
 * Tags named special-tenure schemes (555-day "Golden Goal", 444-day "Square
 * Drive") from the tenure label when present.
 *
 * KNOWN LIMITATION: BoB's published rate table is served from a URL/rendering
 * this dependency-free HTTP scraper could not resolve (candidate paths 404;
 * the live page appears to be JS-rendered). Until a working URL or a headless-
 * browser fetch is added, this adapter fails and the ingest runner keeps BoB's
 * last-known-good (aggregator-sourced) rates. Kept registered so it activates
 * automatically once a scrapeable endpoint is wired in.
 */
export class BobAdapter extends TableRateAdapter {
  constructor() {
    super({
      bankId: "bob",
      fdUrl: [
        "https://bankofbaroda.bank.in/interest-rates-and-charges/deposits-interest-rates",
        "https://bankofbaroda.bank.in/personal-banking/accounts/deposits/fixed-deposits",
        "https://bankofbaroda.bank.in/deposits-interest-rates",
      ],
      savingsUrls: [
        "https://bankofbaroda.bank.in/interest-rates-and-charges/deposits-interest-rates",
        "https://bankofbaroda.bank.in/personal-banking/accounts/saving-accounts",
      ],
      renderJs: true,
      // BoB publishes a PDF rate card; try likely locations (paths are date-
      // stamped and may change — update when the current URL is known).
      pdfUrl: [
        "https://bankofbaroda.bank.in/-/media/project/bob/countrywebsites/india/interest-rates/domestic-term-deposit-rates.pdf",
        "https://www.bankofbaroda.in/-/media/interest-rates/domestic-term-deposit-rates.pdf",
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
