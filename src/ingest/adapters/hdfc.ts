import { PrivateTableAdapter } from "./private-base.js";

/**
 * HDFC Bank adapter.
 *
 * Scrapes HDFC's retail (< ₹3 crore) domestic term-deposit rate card, a plain
 * server-rendered (tenure, General %, Senior Citizen %) table. HDFC's tenure
 * labels are unusually compound ("2 Years 11 Months (35 months)", "3 Years 1
 * day to < 4 Years 7 Months", "5 Years 1 day to 10 Years"), so this adapter
 * relies on the {@link PrivateTableAdapter}'s compound-tenure resolver rather
 * than the PSU parser. RD is derived from FD card rates for >= 1yr tenures.
 */
export class HdfcAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "hdfc",
      fdUrl: [
        "https://www.hdfcbank.com/personal/save/deposits/fixed-deposit-interest-rate",
        "https://www.hdfc.bank.in/personal/save/deposits/fixed-deposit-interest-rate",
      ],
      savingsUrls: [
        "https://www.hdfcbank.com/personal/save/accounts/savings-accounts/regular-savings-account",
      ],
      // Plain (tenure, general, senior) table.
      generalCol: 1,
      seniorCol: 2,
    });
  }
}
