import { PrivateTableAdapter } from "./private-base.js";
/**
 * IndusInd Bank adapter.
 *
 * IndusInd's rate page is JS-rendered (a plain HTTP fetch yields no table), so
 * `renderJs` is set. Once rendered, the first rate table is the retail
 * "< 3 Cr* DOMESTIC (RESIDENT)" grid of (Tenure, Rate [general], Rate [senior]).
 * Tenure labels are compound ("1 Year to below 1 Year 6 Month", "Above 3 Years
 * up to below 61 Months", "61 Months and above"), handled by the
 * {@link PrivateTableAdapter} compound-tenure resolver. RD is derived from FD.
 */
export class IndusindAdapter extends PrivateTableAdapter {
    constructor() {
        super({
            bankId: "indusind",
            fdUrl: [
                "https://www.indusind.bank.in/in/en/personal/rates.html",
                "https://www.indusind.com/in/en/personal/rates.html",
            ],
            savingsUrls: [
                "https://www.indusind.bank.in/in/en/personal/rates.html",
            ],
            renderJs: true,
            generalCol: 1,
            seniorCol: 2,
        });
    }
}
