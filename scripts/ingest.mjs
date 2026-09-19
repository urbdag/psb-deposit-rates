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
// Payments banks (PAYMENTS_BANK) — SAVINGS-ONLY OFFICIAL scrapers. By RBI
// license payments banks CANNOT offer FD or RD and cap balances (~Rs 2 lakh /
// customer); they publish savings-account interest only, frequently tiered by
// balance slab. These adapters emit ONLY SAVINGS rows and never FD/RD.
//
// Fino (fino): registered. fino.bank.in HTML pages render 0 tables (Next.js +
// reCAPTCHA); the authoritative savings source is the linked PDF rate card
// "Savings Account Interest Rates" (effective 1 Dec 2025). The adapter fetches
// that PDF via fetchPdfText and parses tiered savings-by-balance-slab with a
// bespoke pure parseSavingsPdf (one SAVINGS row per band, GENERAL + SENIOR),
// never FD/RD (source: fino.bank.in PDF rate card). The 1 Dec 2025 card
// publishes two bands: up to & incl. Rs. 1 Lakh = 1.50%, above Rs. 1 Lakh =
// 4.50% (verified live via the CI ingest run). If the PDF 403s / has rotated at
// ingest time, Fino simply returns nothing and keeps last-known-good (never a
// fabricated rate).
const { FinoAdapter } = await import(resolve(root, `${A}/fino.js`));
//
// BLOCKED payments banks (documented, left rate-less — no fabricated rates).
// Verified across 4 CI diagnose rounds over base domains + .bank.in + .gov.in +
// dedicated savings/interest-rate paths. None exposes a parseable OFFICIAL
// savings source, so per the project hard rule they stay rate-less rather than
// shipping fabricated data under the OFFICIAL badge.
//
// Airtel Payments Bank (airtel): NOT registered — www.airtelpayments.bank.in
// (`/`, `/interest-rates`, `/savings-account`) and airtel.in/bank each return a
// ~5.3KB Cloudflare challenge-platform shell (cdn-cgi/challenge-platform), 0
// tables, no body rate text. Un-renderable bot gate.
//
// India Post Payments Bank / IPPB (ippb): NOT registered — www.ippbonline.com/
// and /web/ippb/interest-rates, ippb.bank.in/, and www.ippb.gov.in/web/ippb/
// interest-rate all hard-fail the headless render (goto navigation error /
// timeout). No parseable page reachable. (IPPB is Government-of-India owned via
// India Post; that only affects the trust line, not scrapeability.)
//
// NSDL Payments Bank (nsdlpb): NOT registered — nsdlpaymentsbank.com/,
// /InterestRate.aspx, /Interest-Rate.html, www.nsdlpaymentsbank.bank.in/
// interest-rates and www.nsdlbank.bank.in/... all hard-fail the headless
// render. No reachable parseable rate page.
//
// Jio Payments Bank (jio): NOT registered — www.jiopaymentsbank.com/,
// /en/savings-account, jiopaymentsbank.bank.in/ and jio.bank.in/ all hard-fail
// the headless render. No reachable page.
//
// Paytm Payments Bank (paytm): NOT registered — www.paytmbank.com/
// savingsAccount renders 0 tables, no body percentages, no rate links, no
// rate-carrying network JSON. RBI-restricted (onboarding barred since Mar
// 2024); no active/updated public savings-rate schedule. Left rate-less.
//
// Batch 2 private-sector banks (OFFICIAL scrapers). Structures discovered via
// the CI diagnose workflow.
//
// RBL (rbl): registered. rblbank.com/interest-rates is client-rendered
// (renderJs); its retail FD grid ("Deposits below INR 3 crore") interleaves
// Effective-Annualised-Yield columns between the rate columns and carries a
// super-senior column, so generalCol=1 and seniorCol=3 (cols 2/4/6 are yields,
// col 5 is super-senior). The bespoke picker PINS the "below INR 3 crore" grid
// by signature so the savings slab / any bulk table is never published as
// retail (source: rblbank.com).
//
// City Union (cityunion): registered. cityunionbank.com/deposit-interest-rate
// is client-rendered (renderJs) with ~19 tables; the retail table titled
// "Domestic/NRO Callable Term Deposit" has two stacked header rows and columns
// General(1) | Senior(2) | Super-Senior(3). The picker PINS the callable
// term-deposit grid by signature (generalCol=1, seniorCol=2; super-senior
// ignored) so savings / NRE / FCNR tables are never mis-selected (source:
// cityunionbank.com).
//
// CSB (csb): registered. csb.bank.in/interest-rates is client-rendered
// (renderJs) with ~31 tables; the retail "DOMESTIC TERM DEPOSITS" table has a
// leading serial-number column, so the bespoke parser reads tenor=cells[1] and
// the retail general rate from the "Below Rs. 3 Crore" column (cells[2]), NOT
// the "Rs 2 Crore and above" bulk column (cells[3]). This table publishes
// GENERAL rates only (no per-row senior column), so CSB ships GENERAL-only
// OFFICIAL rows rather than copying general into senior (source: csb.bank.in).
const { RblAdapter } = await import(resolve(root, `${A}/rbl.js`));
const { CityunionAdapter } = await import(resolve(root, `${A}/cityunion.js`));
const { CsbAdapter } = await import(resolve(root, `${A}/csb.js`));
//
// Foreign banks (FOREIGN) — OFFICIAL retail domestic-INR term-deposit scrapers.
// RBI-licensed foreign banks whose INDIAN-branch deposits are DICGC-insured but
// are NOT government-owned (trust line mirrors PRIVATE). We map ONLY the
// DOMESTIC/RESIDENT INR retail (< Rs 2-3 crore) term-deposit table, never the
// FCNR/NRE/NRO foreign-currency schedules. Structures discovered via the CI
// diagnose workflow (sandbox has no internet).
//
// Deutsche (deutsche): registered. Its resident FD page
// (deutsche.bank.in/.../resident-fixed-deposits.html) is client-rendered
// (renderJs) with ONE clean table: Deposit tenure | Normal interest rate
// (% p.a.) <Rs. 3 crore | Senior citizen interest rate (% p.a.) <Rs. 3 crore.
// So generalCol=1, seniorCol=2. Deutsche currently sets senior == general on
// every row but DOES publish a distinct senior column, so mapping seniorCol=2
// is faithful (SENIOR rows equal GENERAL — not fabrication; the column exists).
// The picker PINS the "normal interest rate" / "senior citizen" + "< Rs. 3
// crore" retail signature and rejects NRE/NRO/FCNR/foreign-currency/tax-saver/
// savings decoys (source: deutsche.bank.in).
//
// DBS (dbs): registered. The DBS Treasures FD page
// (dbs.bank.in/in/treasures/deposits/your-accounts/fixed-deposits) is
// client-rendered (renderJs) with ONE rate table that INTERLEAVES an
// annualised-yield column after each rate column: <tenor> | general rate% |
// general yield% | senior rate% | senior yield%, e.g. 1 year 5.75/5.88/
// 6.25/6.40. So generalCol=1, seniorCol=3 (cols 2 and 4 are annualised YIELD
// and must NEVER be published as a rate). DBS DOES give a senior premium (6.25
// vs 5.75 at 1yr), so SENIOR rows are real. The picker PINS the "tenor" +
// "senior citizens" retail signature (requiring parseable %s in BOTH col 1 and
// col 3 so a 2-3 column decoy can't be mistaken for the 5-column grid) and
// rejects savings/NRE/NRO/FCNR decoys. The shorter-tenure single-column
// general-only ladder on interest-rates.page is intentionally NOT used (keeps a
// clean GENERAL/SENIOR set) (source: dbs.bank.in). Pattern: rbl.ts.
//
// BLOCKED / DEFUNCT foreign banks (documented, left rate-less — no fabricated
// rates). Verified via the CI diagnose workflow across multiple rounds over the
// RBI-mandated .bank.in domains (`.co.in`/`.com` 301 to `.bank.in`) plus guessed
// PDF rate-card URLs. Per the project hard rule they stay rate-less rather than
// shipping fabricated / mis-tiered data under the OFFICIAL badge.
//
// HSBC India (hsbc): NOT registered — www.hsbc.bank.in/term-deposits/
// interest-rates/ (and the www.hsbc.co.in variant that 301s to it) render
// ~184 KB but 0 <table> elements and 0 body percentage samples: rates are
// injected by a client-side widget (LivePerson/Adobe stack) into non-table
// markup absent from the serialized DOM. Guessed PDF rate-card URLs
// (/content/dam/hsbc/in/documents/term-deposits/interest-rates.pdf and a
// /1/PA_esf-ca-app-content/... variant) returned 157-2104 byte 404 bodies. No
// parseable OFFICIAL resident-INR retail term-deposit source. Left rate-less.
//
// Standard Chartered India (sc): NOT registered — www.sc.com/in/save/
// fixed-deposits/interest-rates/, .../accounts/products/fixed-deposits/, and
// .../help/rates-and-fees/ (canonical www.sc.bank.in; deep guessed paths 404 to
// /404-error-page/) each render ~144 KB but 0 <table> and 0 body percentage
// samples: rates load via a client-side widget (Adobe/eddl data layer) into
// markup absent from the serialized DOM. Guessed PDF rate cards
// (sc.com/in/deposit-rates.pdf, av.sc.com/in/content/docs/
// in-fixed-deposits-rates.pdf) returned 404-size bodies. No parseable OFFICIAL
// resident-INR retail term-deposit source. Left rate-less.
//
// Citibank India (citi): DEFUNCT-for-retail — NOT added to banks.ts, NO adapter.
// Citi sold its India consumer/retail banking business (incl. deposits) to Axis
// Bank; the transaction completed in March 2023. Citi no longer runs a retail
// term-deposit book in India, so there is no live resident deposit-rate schedule
// to scrape. Documented here and left out entirely (never fabricate rates for a
// business that no longer exists).
const { DeutscheAdapter } = await import(resolve(root, `${A}/deutsche.js`));
const { DbsAdapter } = await import(resolve(root, `${A}/dbs.js`));
//
// BLOCKED batch 2 private-sector banks (documented, left rate-less — no
// fabricated rates). Each was verified via the CI diagnose workflow across
// multiple rounds / URL variants (incl. the RBI-mandated .bank.in domains);
// none exposes a stable, offline-parseable retail (< ₹2-3 crore) GENERAL/SENIOR
// FD ladder, so per the project hard rule they stay rate-less (their profile
// renders with no rate rows) rather than shipping wrong / mis-tiered data under
// the OFFICIAL badge.
//
// Bandhan (bandhan): NOT registered — bandhanbank.com rate pages render 0
// tables; only 2 stray highlight percentages (7.95%, 7.45%) appear in the DOM,
// with no tiered General/Senior FD ladder (div/widget-driven) and no
// rate-carrying JSON/window-global captured. Left rate-less.
//
// DCB (dcb): NOT registered. DCB was not among the batch-2 banks with a
// confirmed parseable page in the diagnostics round, and no reachable OFFICIAL
// retail (< ₹2-3 crore) GENERAL/SENIOR FD source has been confirmed for it, so
// per the project hard rule it is left rate-less pending a future reachable
// source rather than shipping fabricated / mis-tiered data under the OFFICIAL
// badge. (No specific diagnose capture is asserted here.)
//
// KVB / Karur Vysya (kvb): NOT registered — every candidate kvb.co.in rate URL
// hard-failed the headless render (goto timeout / navigation error). No
// parseable page reachable.
//
// Karnataka Bank (karnataka): NOT registered — karnatakabank.com and
// karnataka.bank.in return ~262-byte near-empty bodies / fail (SSR or bot
// gate). No rate content reachable.
//
// Tamilnad Mercantile / TMB (tmb): NOT registered — tmb.in rate URLs return
// 39-161 byte near-empty bodies (SSR/bot gate); tmb.bank.in renders 200KB but 0
// tables and no body percentages (ladder not in DOM; likely PDF/widget). No
// parseable ladder.
//
// Dhanlaxmi (dhanlaxmi): NOT registered — dhanbank.com rate pages render 176KB
// with only savings-type stray percentages (1.50%, 1.90%) in divs and 0 tables;
// no tiered General/Senior FD ladder in the DOM. Left rate-less.
//
// Nainital (nainital): NOT registered — nainitalbank.co.in Interest_Rates.aspx
// sits behind a Cloudflare Turnstile / challenge-platform bot gate; the render
// returns a ~6KB challenge shell with 0 tables and no rate text. Un-renderable.
//
// Jammu & Kashmir / J&K Bank (jk): NOT registered — jkbank.com rate pages and
// jk.bank.in all hard-fail the headless render (goto 60s timeout). No parseable
// page.
//
// South Indian Bank (southindian): NOT registered — southindianbank.com,
// southindian.bank.in and sib.co.in return ~4KB near-empty bodies / fail (SSR
// gate). No rate content reachable.
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
  new RblAdapter(),
  new CityunionAdapter(),
  new CsbAdapter(),
  new FinoAdapter(),
  new DeutscheAdapter(),
  new DbsAdapter(),
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
