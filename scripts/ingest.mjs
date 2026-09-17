// Daily ingestion runner.
// -------------------------------------------------------------------------
// Runs the registered per-bank adapters, VALIDATES their output, and writes a
// fresh public/data/dataset.json — but only for banks whose scrape passed
// validation. Banks that fail (adapter error, empty result, or out-of-range
// rates) KEEP their last-known-good rates from the existing dataset, so a
// broken scraper never wipes or corrupts published data.
//
// Wire real adapters into ADAPTERS below (see src/ingest/adapters/). With none
// registered, this is a no-op that reports "0 banks refreshed" and leaves the
// current dataset untouched — safe to schedule immediately.
//
//   node scripts/ingest.mjs                # refresh + write
//   node scripts/ingest.mjs --dry-run      # validate + report, no write
//
// Exit codes: 0 = ok (even if some banks fell back), 1 = hard failure.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const DATASET_PATH = resolve(root, "public/data/dataset.json");

const { BANKS } = await import(resolve(root, "public/js/data/banks.js"));
const { runAdapters } = await import(
  resolve(root, "public/js/ingest/adapter.js")
);

// -------------------------------------------------------------------------
// Registered per-bank adapters (all 12 PSU banks).
const A = "public/js/ingest/adapters";
const { SbiAdapter } = await import(resolve(root, `${A}/sbi.js`));
const { PnbAdapter } = await import(resolve(root, `${A}/pnb.js`));
const { BobAdapter } = await import(resolve(root, `${A}/bob.js`));
const { BoiAdapter } = await import(resolve(root, `${A}/boi.js`));
const { CanaraAdapter } = await import(resolve(root, `${A}/canara.js`));
const { UnionAdapter } = await import(resolve(root, `${A}/union.js`));
const { CentralAdapter } = await import(resolve(root, `${A}/central.js`));
const { IndianAdapter } = await import(resolve(root, `${A}/indian.js`));
const { IobAdapter } = await import(resolve(root, `${A}/iob.js`));
const { UcoAdapter } = await import(resolve(root, `${A}/uco.js`));
const { MahaAdapter } = await import(resolve(root, `${A}/maha.js`));
const { PsbAdapter } = await import(resolve(root, `${A}/psb.js`));
const ADAPTERS = [
  new SbiAdapter(),
  new PnbAdapter(),
  new BobAdapter(),
  new BoiAdapter(),
  new CanaraAdapter(),
  new UnionAdapter(),
  new CentralAdapter(),
  new IndianAdapter(),
  new IobAdapter(),
  new UcoAdapter(),
  new MahaAdapter(),
  new PsbAdapter(),
];
// -------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const VALID_BANK_IDS = new Set(BANKS.map((b) => b.id));

/** Reject clearly-bad scrapes so they trigger last-known-good fallback. */
function validateBankRates(bankId, rates) {
  const errors = [];
  if (!Array.isArray(rates) || rates.length === 0) {
    errors.push("no rates returned");
    return errors;
  }
  for (const r of rates) {
    if (r.bankId !== bankId) errors.push(`bankId mismatch: ${r.bankId}`);
    if (!["FD", "SAVINGS", "RD"].includes(r.product))
      errors.push(`bad product: ${r.product}`);
    if (typeof r.ratePercent !== "number" || Number.isNaN(r.ratePercent))
      errors.push(`non-numeric rate`);
    else if (r.ratePercent < 0 || r.ratePercent > 15)
      errors.push(`rate out of range (0–15%): ${r.ratePercent}`);
    if (r.source?.quality !== "OFFICIAL")
      errors.push("source.quality must be OFFICIAL");
  }
  return [...new Set(errors)];
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(DATASET_PATH, "utf8"));
  } catch {
    return {
      banks: BANKS,
      rates: [],
      generatedAt: null,
      containsSampleData: false,
    };
  }
}

async function main() {
  const existing = await loadExisting();
  const existingByBank = new Map();
  for (const r of existing.rates) {
    if (!existingByBank.has(r.bankId)) existingByBank.set(r.bankId, []);
    existingByBank.get(r.bankId).push(r);
  }

  if (ADAPTERS.length === 0) {
    console.log(
      "No adapters registered — nothing to refresh. Dataset left unchanged.",
    );
    console.log(
      "Register per-bank adapters in scripts/ingest.mjs (ADAPTERS) to enable daily refresh.",
    );
    return 0;
  }

  console.log(`Running ${ADAPTERS.length} adapter(s)…`);
  const { rates: fetched, failed } = await runAdapters(ADAPTERS);

  // Group fetched rates by bank and validate each bank independently.
  const fetchedByBank = new Map();
  for (const r of fetched) {
    if (!fetchedByBank.has(r.bankId)) fetchedByBank.set(r.bankId, []);
    fetchedByBank.get(r.bankId).push(r);
  }

  const refreshed = []; // "bank:PRODUCT,PRODUCT" summaries
  const fellBack = [...failed];
  const finalRates = [];

  for (const bank of BANKS) {
    const prior = existingByBank.get(bank.id) ?? [];
    const scraped = fetchedByBank.get(bank.id);

    if (!scraped) {
      // Adapter didn't run / threw (in `failed`) or produced nothing for this
      // bank — retain everything we had.
      finalRates.push(...prior);
      continue;
    }

    const errs = validateBankRates(bank.id, scraped);
    if (errs.length > 0) {
      console.warn(
        `✗ ${bank.id}: validation failed (${errs.join("; ")}) — keeping last-known-good`,
      );
      if (!fellBack.includes(bank.id)) fellBack.push(bank.id);
      finalRates.push(...prior);
      continue;
    }

    // MERGE BY PRODUCT: only replace the product types this scrape covers.
    // Products the adapter didn't return keep their last-known-good rows, so a
    // partial scraper (e.g. FD-only) never drops a bank's Savings/RD data.
    const scrapedProducts = new Set(scraped.map((r) => r.product));
    const retained = prior.filter((r) => !scrapedProducts.has(r.product));
    finalRates.push(...scraped, ...retained);

    const retainedProducts = [...new Set(retained.map((r) => r.product))];
    refreshed.push(
      `${bank.id}:${[...scrapedProducts].sort().join("+")}` +
        (retainedProducts.length
          ? ` (kept ${retainedProducts.sort().join("+")})`
          : ""),
    );
  }

  // Guard against unknown bank ids sneaking in.
  const cleaned = finalRates.filter((r) => VALID_BANK_IDS.has(r.bankId));

  const dataset = {
    banks: BANKS,
    rates: cleaned,
    generatedAt: new Date().toISOString(),
    containsSampleData: cleaned.some((r) => r.source?.quality === "SAMPLE"),
  };

  console.log(`Refreshed: ${refreshed.length ? refreshed.join(", ") : "none"}`);
  console.log(
    `Fell back to last-known-good: ${fellBack.length ? fellBack.join(", ") : "none"}`,
  );
  console.log(`Total rates: ${cleaned.length}`);

  if (DRY_RUN) {
    console.log("--dry-run: not writing.");
    return 0;
  }

  await mkdir(dirname(DATASET_PATH), { recursive: true });
  await writeFile(DATASET_PATH, JSON.stringify(dataset, null, 2), "utf8");
  console.log(`Wrote ${DATASET_PATH}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Ingestion hard failure:", err);
    process.exit(1);
  });
