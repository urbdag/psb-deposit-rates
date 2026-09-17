import { BANKS } from "./banks.js";
import { RATES } from "./rates.js";
export const DATASET = {
    banks: BANKS,
    rates: RATES,
    generatedAt: new Date().toISOString(),
    containsSampleData: RATES.some((r) => r.source.quality === "SAMPLE"),
};
