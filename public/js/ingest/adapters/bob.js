import { TableRateAdapter, defaultScheme } from "./base.js";
/**
 * Bank of Baroda adapter.
 * Targets BoB's retail domestic term-deposit rates (below ₹3 crore) + savings.
 * Tags named special-tenure schemes (555-day "Golden Goal", 444-day "Square
 * Drive") from the tenure label when present.
 *
 * Uses the specific FD and savings sub-pages (the /deposits-interest-rates hub
 * rendered to an empty shell; the sub-pages expose the actual tables).
 */
export class BobAdapter extends TableRateAdapter {
    constructor() {
        super({
            bankId: "bob",
            fdUrl: [
                "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/fixed-deposits-tax-saving",
                "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates",
            ],
            savingsUrls: [
                "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/savings-bank-deposits",
            ],
            renderJs: true,
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
