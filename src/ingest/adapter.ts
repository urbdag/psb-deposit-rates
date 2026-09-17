import type { RateEntry } from "../types.js";

/**
 * Ingestion layer contract.
 * -------------------------------------------------------------------------
 * This app deliberately separates *how rates are obtained* from *how they are
 * displayed*. The website only ever reads a compiled `Dataset` (see
 * scripts/build-data.mjs). Where that data comes from is pluggable:
 *
 *   1. Per-bank scraper adapters (implement `BankRateAdapter`) — the durable
 *      path once the deployment has internet access to the banks' rate pages.
 *   2. CSV / spreadsheet import (see `csv.ts`) — the fastest path to real data;
 *      paste published rates into a sheet, export CSV, import.
 *   3. The bundled SAMPLE dataset (src/data) — used until real data exists.
 *
 * All three converge on the same `RateEntry[]` shape, so the frontend is
 * indifferent to the source. Adapters MUST stamp `source.quality = "OFFICIAL"`
 * and a real `effectiveDate` + `url`.
 */
export interface BankRateAdapter {
  /** Bank id this adapter produces rates for (matches Bank.id). */
  readonly bankId: string;

  /**
   * Fetch and parse the bank's currently published rates.
   * Implementations own their own HTTP + HTML/PDF parsing. They should throw
   * on hard failures so the pipeline can fall back to the last-known-good data.
   */
  fetchRates(): Promise<RateEntry[]>;
}

/**
 * Runs a set of adapters and merges their output. On per-adapter failure it
 * keeps going (best-effort refresh) and reports which banks failed so the
 * pipeline can retain prior data for them.
 */
export async function runAdapters(
  adapters: BankRateAdapter[],
): Promise<{ rates: RateEntry[]; failed: string[] }> {
  const rates: RateEntry[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    adapters.map(async (a) => ({
      bankId: a.bankId,
      rates: await a.fetchRates(),
    })),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      rates.push(...r.value.rates);
    } else {
      failed.push(adapters[i].bankId);
      // Surface WHY an adapter failed so URL/parse issues are debuggable in CI.
      console.warn(
        `  adapter ${adapters[i].bankId} failed: ${String(r.reason)}`,
      );
    }
  }

  return { rates, failed };
}
