import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * Bank of India adapter.
 * Targets BoI's domestic term-deposit rate page (below ₹3 crore) + savings rate.
 *
 * KNOWN LIMITATION: as of this writing BoI's rate page returns HTTP 403 to
 * non-interactive clients (anti-bot protection). This lightweight, dependency-
 * free adapter therefore fails and the ingest runner keeps BoI's last-known-good
 * (aggregator-sourced) rates. To scrape BoI live, a headless-browser fetch
 * (e.g. Playwright in CI) would be needed to pass the bot check / render JS.
 * The adapter is kept registered so it starts working automatically if BoI
 * relaxes that protection.
 */
export class BoiAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "boi",
            // Confirmed live page (the bare /interest-rate hub 403s, so omit it).
            fdUrl: ["https://bankofindia.co.in/interest-rate/rupee-term-deposit-rate"],
            savingsUrls: [
                "https://bankofindia.co.in/interest-rate-saving-bank-deposit-rates",
                "https://bankofindia.co.in/interest-rate/saving-bank-deposit-rate",
            ],
            schemeNamer: (t) => /\b400\b/.test(t) ? "400-day Special" : defaultScheme(t),
        });
    }
}
