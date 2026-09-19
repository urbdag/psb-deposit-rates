import { PrivateTableAdapter } from "./private-base.js";

/**
 * Federal Bank adapter.
 *
 * Scrapes Federal's retail domestic term-deposit table (Single Deposit Less
 * than ₹300 Lakhs = below ₹3 crore), a plain server-rendered
 * (Period, General Public %, Senior Citizen %) grid, which is the first rate
 * table on the deposit-rate page. Tenure labels are standard ("7 days to 29
 * days", "Above 1 year to less than 15 Months", "48 months"). RD is derived
 * from FD card rates for >= 1yr tenures.
 */
export class FederalAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "federal",
      fdUrl: [
        "https://www.federalbank.co.in/deposit-rate",
        "https://www.federalbank.co.in/interest-rate",
      ],
      savingsUrls: ["https://www.federalbank.co.in/interest-rates"],
      // Client-hydrated rate tables (page also embeds a feddy.federal.bank.in
      // widget iframe): plain HTTP yields 0 tables; render with a headless
      // browser to expose the retail "Single Deposit Less than 300 Lakhs"
      // (=< 3 crore) grid. Confirmed via the diagnose workflow.
      renderJs: true,
      generalCol: 1,
      seniorCol: 2,
    });
  }
}
