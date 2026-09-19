import { PrivateTableAdapter } from "./private-base.js";

/**
 * IDFC First Bank adapter.
 *
 * Scrapes the retail "Fixed Deposits of less than ₹3 crore" table on IDFC
 * First's FD-interest-rates page, a clean (Tenure, General %, Senior Citizen %)
 * grid. Most tenures are plain day ranges ("7 days – 29 days", "500 days – 3
 * years"); the two long buckets carry a compound "+1 day" lower bound
 * ("3 years 1 day – 5 years", "5 years 1 day – 10 years") resolved by the
 * {@link PrivateTableAdapter} compound-tenure resolver. `renderJs` covers the
 * case where the page hydrates the table client-side. RD is derived from FD.
 */
export class IdfcfirstAdapter extends PrivateTableAdapter {
  constructor() {
    super({
      bankId: "idfcfirst",
      fdUrl: [
        "https://www.idfcfirstbank.com/personal-banking/deposits/fixed-deposit/fd-interest-rates",
      ],
      savingsUrls: [
        "https://www.idfcfirstbank.com/personal-banking/accounts/savings-account/interest-rate",
      ],
      renderJs: true,
      generalCol: 1,
      seniorCol: 2,
    });
  }
}
