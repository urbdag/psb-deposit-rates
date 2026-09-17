# PSB Deposit Rates

A sleek, single-page site to find the **best deposit rates across India's 12
public sector banks** — State Bank of India plus the 11 nationalised banks.
Compare **Fixed Deposits, Savings accounts, and Recurring Deposits** by
**tenure, deposit amount, and customer category** (general / senior / super
senior), with a live leaderboard and a full ranked comparison table.

> ℹ️ **Data provenance.** The rates currently loaded were compiled from
> third-party **aggregator and news sources** (PolicyBazaar, BankBazaar,
> ETMoney, Business Today, Economic Times, CNBC-TV18, etc.) in September 2026 —
> **not** scraped from the banks' own pages — and some per-tenure figures are
> interpolated between cited anchor points. Each rate carries its source URL and
> effective date. **Verify against each bank's official schedule before making
> financial decisions.** Regenerate with `node scripts/gen-real-data.mjs` and
> re-import; for authoritative data, implement the per-bank adapters
> (see [Loading real rates](#loading-real-rates)).

---

## Scope

The 12 public sector banks (2026):

| | Bank | | Bank |
|--|--|--|--|
| 1 | State Bank of India | 7 | Indian Bank |
| 2 | Punjab National Bank | 8 | Central Bank of India |
| 3 | Bank of Baroda | 9 | Indian Overseas Bank |
| 4 | Canara Bank | 10 | UCO Bank |
| 5 | Union Bank of India | 11 | Bank of Maharashtra |
| 6 | Bank of India | 12 | Punjab & Sind Bank |

Products tracked: **FD**, **Savings**, **RD**.

## Features

- **Overview cards** — top rate for your exact selection, overall best rate for
  the product, and banks compared.
- **Best-rate-by-tenure leaderboard** — the winning bank/rate for each common
  tenure at a glance (FD/RD).
- **Ranked comparison table** — every bank sorted best-first, with medals for
  the top 3, what the rate "applies to" (tenure bucket, amount slab, special
  scheme), and the effective date.
- **Filters** — product, customer category, deposit amount, tenure.
- **Honest provenance** — every rate carries a source URL, effective date, and a
  quality flag (`SAMPLE` vs `OFFICIAL`) surfaced in the UI.

## Tech & why

This is a **dependency-free static site**: TypeScript compiled to plain ES
modules by `tsc`, a hand-built CSS design system, and a JSON dataset. No runtime
framework, no CDN, no build server — it runs by opening `public/index.html` on
any static host (GitHub Pages, Vercel static, S3, etc.). This keeps it fast,
portable, and trivially auditable, and it works fully offline.

## Getting started

```bash
# Build: type-check + compile TS -> public/js, then emit public/data/dataset.json
npm run build

# Preview locally at http://localhost:4173
npm run serve
```

Individual scripts:

| Script | What it does |
|--|--|
| `npm run build` | Compile TS → `public/js` (does **not** touch the dataset) |
| `npm run typecheck` | Type-check only (no emit) |
| `npm run data:real` | Regenerate the researched real-rate CSV and import it |
| `npm run data:import -- <file.csv>` | Import an official-rate CSV → `dataset.json` |
| `npm run data:sample` | (Re)generate the SAMPLE dataset from `src/data` |
| `npm run ingest` | Run daily adapters → validate → refresh `dataset.json` |
| `npm run serve` | Zero-dependency static file server |

> **Important:** `public/data/dataset.json` is the committed source of truth for
> what the site publishes. `npm run build` deliberately does **not** regenerate
> it (that would overwrite real/ingested rates with the sample seed). The deploy
> workflow only compiles TS and publishes the committed `dataset.json`.

### Daily ingestion (GitHub Actions)

`.github/workflows/ingest.yml` runs `scripts/ingest.mjs` on a daily cron. The
runner executes the registered per-bank adapters, **validates** each bank's
output (non-empty, rates in 0–15%, `OFFICIAL` quality, correct `bankId`), and
keeps the **last-known-good** rates for any bank whose scrape fails — so a broken
scraper never wipes published data. If the dataset changes, it commits back to
`main`, which triggers a redeploy. With no adapters registered yet it is a safe
no-op. Register adapters in the `ADAPTERS` array in `scripts/ingest.mjs`.

## Architecture

```
src/
  types.ts            Domain model (Bank, RateEntry, tenure/amount ranges, …)
  query.ts            Pure rate-selection logic (rankBanks, bestByTenure, …)
  format.ts           INR / rate / tenure formatting (lakh & crore aware)
  main.ts             Frontend app: renders UI from the dataset JSON
  data/
    banks.ts          The 12 banks
    rates.ts          SAMPLE rate seed data (clearly flagged)
    dataset.ts        Assembles banks + rates into the Dataset
  ingest/
    adapter.ts        BankRateAdapter interface + runAdapters()
    csv.ts            CSV importer (fastest path to real data)
    adapters/
      sbi.example.ts  Template for a real per-bank scraper
public/
  index.html          App shell
  styles.css          Design system
  js/                 Compiled output (generated)
  data/dataset.json   Compiled dataset the site fetches (generated)
scripts/
  build-data.mjs      Emits dataset.json
  import-csv.mjs       Imports official rates from CSV -> dataset.json
  serve.mjs           Local static server
data/
  rates-template.csv  Ready-to-fill CSV template
```

The website only ever reads a compiled `Dataset`. **How that data is obtained is
deliberately decoupled** from how it's displayed, so real data can be plugged in
without touching the UI.

## Loading real rates

There is no single official API for Indian deposit rates — each bank publishes
its own schedule (HTML tables or PDFs) that change frequently. Two supported
paths:

### 1. CSV import (fastest)

A **ready-to-fill scaffold** covering all 12 banks across the standard tenure
buckets (FD + RD, general & senior) and savings slabs is generated at
`data/rates-to-fill.csv` — 312 rows with blank `ratePercent` / `effectiveDate`
cells. Regenerate it any time with:

```bash
npm run build            # ensures compiled JS exists
node scripts/gen-template.mjs > data/rates-to-fill.csv
```

Then:

1. Open `data/rates-to-fill.csv` and fill the `ratePercent` column (and
   `effectiveDate`, `YYYY-MM-DD`) from each bank's official rate page. Delete
   rows for products a bank doesn't offer; add rows for special schemes (set the
   `scheme` column and a single-day tenure, e.g. `minDays`/`maxDays` both 444).
   Leave `maxDays` / `maxAmount` blank for "and above".
2. Import:
   ```bash
   node scripts/import-csv.mjs data/rates-to-fill.csv
   ```
   Imported rows are stamped `quality: OFFICIAL`, and the site's "sample data"
   banner disappears automatically once no sample rows remain.

`data/rates-template.csv` is a tiny 3-row example if you'd rather start from
scratch.

### 2. Per-bank scraper adapters (durable)

Implement the `BankRateAdapter` interface (`src/ingest/adapter.ts`), one per
bank, fetching and parsing the bank's published rate page into `RateEntry[]`
with `quality: OFFICIAL`, then register it in `scripts/ingest.mjs`.

**A complete reference implementation ships for SBI** —
`src/ingest/adapters/sbi.ts`:

- Fetches SBI's official retail (below ₹3 crore) term-deposit page.
- **Zero external dependencies** — uses global `fetch` plus dependency-free HTML
  helpers (`src/ingest/html.ts`, `tenure.ts`), so it runs in CI with no install.
- Locates the rate table by its **content** (rows that parse as tenure + two
  percentages), not brittle CSS selectors, so minor redesigns don't break it.
- Splits `fetchRates()` (network) from `parse()` (pure), so the parser is unit
  tested against fixture HTML with no network: `npm test`
  (`scripts/test-sbi-adapter.mjs`).
- If the page structure changes and nothing parses, it throws → the ingest
  runner keeps SBI's last-known-good rates.

Note: adapters need a deployment with outbound internet to the banks' sites —
they run in the GitHub Actions `ingest` workflow, **not** in a restricted
sandbox. Use `SbiAdapter` as the template for the other 11 banks.

## Data model notes

Indian deposit rates vary along several axes at once, all modelled explicitly:

- **Product**: FD / Savings / RD.
- **Tenure**: a day range (banks quote buckets like "1 year to < 2 years").
- **Amount threshold**: e.g. retail "below ₹3 crore" vs bulk "₹3 crore & above";
  savings uses balance slabs.
- **Customer category**: general, senior (+add-on), super senior. Senior add-ons
  apply to FD/RD retail but generally not to bulk deposits or savings — this is
  reflected in the seed data.
- **Special schemes**: limited-period FDs (e.g. 400/444-day specials) at a
  specific tenure, carried with a `scheme` label.
- **Provenance**: source URL, effective date, and `SAMPLE`/`OFFICIAL` quality.

## Disclaimer

Informational tool only. Always verify rates on each bank's official website
before investing. The bundled figures are sample data and are not financial
advice.
