import type { Dataset } from "../types.js";
import { BANKS } from "./banks.js";
import { RATES } from "./rates.js";

export const DATASET: Dataset = {
  banks: BANKS,
  rates: RATES,
  generatedAt: new Date().toISOString(),
  containsSampleData: RATES.some((r) => r.source.quality === "SAMPLE"),
};
