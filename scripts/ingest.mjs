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
// Private-sector banks (OFFICIAL scrapers).
//
// ICICI: registered. Its FD page renders only two "featured" tail rows into the
// DOM, but the FULL retail domestic ladder lives in the client-side global
// `window.interestData`; the render helper serializes that global and the ICICI
// adapter parses interestData[0] (c1=general, c2=senior, < ₹3 crore).
//
// Axis: NOT registered — the FD widget renders only two summary rows into the
// DOM and exposes NO client-side rate global and NO rate-carrying JSON/XHR
// endpoint (verified via the diagnose workflow: window globals empty, only
// jQuery/SumoSelect widget JS present). The full ladder is not recoverable
// without reverse-engineering an interactive widget, so per the project hard
// rule Axis stays rate-less rather than shipping a 2-row / mis-tiered set.
//
// Yes Bank: NOT registered — every candidate URL (yesbank.in home + FD pages,
// and the .bank.in variant) failed to load in the headless browser (hard render
// failure / block: "failed" on goto across all URLs in diagnose), so there is
// no parseable page. Left rate-less.
//
// Per the project hard rule we never ship fabricated / mis-tiered rates under an
// OFFICIAL badge.
const { HdfcAdapter } = await import(resolve(root, `${A}/hdfc.js`));
const { KotakAdapter } = await import(resolve(root, `${A}/kotak.js`));
const { IndusindAdapter } = await import(resolve(root, `${A}/indusind.js`));
const { IdfcfirstAdapter } = await import(resolve(root, `${A}/idfcfirst.js`));
const { FederalAdapter } = await import(resolve(root, `${A}/federal.js`));
const { IciciAdapter } = await import(resolve(root, `${A}/icici.js`));
// Small finance banks (SFB) — OFFICIAL scrapers.
//
// Capital SFB: registered. Its callable-domestic-term-deposit page publishes
// GENERAL and SENIOR rates as TWO SEPARATE plain 2-column tables (table[0] =
// general, table[1] = senior). The bespoke parser reads both and joins by
// tenure (source: capital.bank.in).
//
// Shivalik SFB: registered. Its interest-rate page carries ~10 tables; the
// bespoke picker PINS the retail "< Rs.2 Crores" 3-column (tenure, general,
// senior) grid, avoiding the higher-amount bulk slabs and the savings table
// (source: shivalik.bank.in).
const { CapitalsfbAdapter } = await import(resolve(root, `${A}/capitalsfb.js`));
const { ShivalikAdapter } = await import(resolve(root, `${A}/shivalik.js`));
//
// BLOCKED small finance banks (documented, left rate-less — no fabricated
// rates). Each was verified via the CI diagnose workflow across multiple
// rounds; none exposes a stable, offline-parseable retail (< ₹2-3 crore)
// GENERAL/SENIOR FD ladder, so per the project hard rule they stay rate-less
// (their FEAT-002 profile renders with no rate rows) rather than shipping
// wrong / mis-tiered data under the OFFICIAL badge.
//
// AU SFB (au): NOT registered — au.bank.in/interest-rates sits behind a
// Cloudflare Turnstile bot-challenge (cdn-cgi/challenge-platform + turnstile
// api.js); the headless render returns only a ~3 KB challenge shell with 0
// tables and NO body rate text. Intermittently un-renderable and never yields
// a parseable ladder.
//
// Equitas SFB (equitas): NOT registered — equitas.bank.in/interest-rate is a
// Gatsby page with 0 tables and only a single stray "8.25%" in the DOM (no
// tiered ladder). Its linked rate-card PDF (Overall_Interest_Rates…pdf) FAILED
// to load in diagnose (dead / rotated hash), and the page-data JSON carries no
// stable parseable tiered ladder. No reliable source.
//
// Suryoday SFB (suryoday): NOT registered — Gatsby site. interest-rates renders
// only sparse stray percentages (no table); the dedicated rate-of-interest page
// exposes exactly ONE table, and it is the SAVINGS balance-slab table, not an
// FD GENERAL/SENIOR ladder. The FD ladder lives only in rotating page-data/sq/d
// JSON with no stable tiered structure to parse. No parseable FD ladder.
//
// Utkarsh SFB (utkarsh): NOT registered — the fixed-deposits page's 2 tables are
// a product-info table + a maturity CALCULATOR widget (not a rate ladder), and
// the dedicated rate-of-interest / interest-rates pages render 0 tables. Only a
// few stray highlight percentages appear in the DOM; no tiered GENERAL/SENIOR
// ladder is parseable.
//
// ESAF SFB (esaf): NOT registered — esafbank.com and esaf.bank.in interest-rate
// URLs return ~300-byte near-empty bodies (SSR/bot gate). No rate page reachable.
//
// Ujjivan SFB (ujjivan): NOT registered — ujjivansfb.in and ujjivan.bank.in FD
// rate URLs hard-fail the headless render (page navigation / goto error). No
// parseable page.
//
// Jana SFB (jana): NOT registered — janabank.com/fixed-deposit renders 0% rate
// content; rates are published only as linked PDFs/images that FAILED to load in
// diagnose. No reachable parseable rate card.
//
// North East SFB / NESFB (nesfb): NOT registered — nesfb.com/interest-rates
// carries no percentages (rates in image/PDF) and nesfb.bank.in fails to render.
// No parseable rate page.
//
// Unity SFB (unity): NOT registered — unitybank.co.in/theunitybank.com redirect
// to slice.bank.in (Unity SFB now "slice"), a Next.js site whose rates live only
// in _next data JSON with 0 tables and no captured body percentages. No stable
// parseable ladder.
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
  new HdfcAdapter(),
  new KotakAdapter(),
  new IndusindAdapter(),
  new IdfcfirstAdapter(),
  new FederalAdapter(),
  new IciciAdapter(),
  new CapitalsfbAdapter(),
  new ShivalikAdapter(),
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

  // Append a dated snapshot to the rate-history file (powers the movements page
  // + trend badges). Idempotent per day; skipped if nothing changed.
  try {
    const { appendSnapshot } = await import(resolve(here, "history.mjs"));
    const h = await appendSnapshot(dataset, dataset.generatedAt);
    console.log(`History: ${h.snapshots.length} snapshot(s) on file.`);
  } catch (e) {
    console.warn("History snapshot skipped:", String(e));
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Ingestion hard failure:", err);
    process.exit(1);
  });
