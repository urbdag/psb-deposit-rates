# PSB Deposit Rates

A sleek, single-page site to find the **best deposit rates across India's 12
public sector banks** — State Bank of India plus the 11 nationalised banks.
Compare **Fixed Deposits, Savings accounts, and Recurring Deposits** by
**tenure, deposit amount, and customer category** (general / senior / super
senior), with a live leaderboard and a full ranked comparison table.

> ⚠️ **The bundled data is SAMPLE data.** The rates shipped in this repo are
> realistic-but-fictional placeholders so the product works end to end. They are
> **not** scraped from the banks and must **not** be used for financial
> decisions. See [Loading real rates](#loading-real-rates) to make it live.

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
| `npm run build` | `tsc` compile + regenerate `public/data/dataset.json` |
| `npm run typecheck` | Type-check only (no emit) |
| `npm run data` | Regenerate the dataset JSON from compiled data modules |
| `npm run serve` | Zero-dependency static file server |

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
bank, fetching and parsing the bank's published rate page/PDF into `RateEntry[]`
with `quality: OFFICIAL`. `src/ingest/adapters/sbi.example.ts` is a starting
template. Note: this requires a deployment environment with outbound internet
access to the banks' sites (and typically an HTML/PDF parsing library such as
`cheerio` / `pdf-parse`). Run adapters on a schedule to keep rates fresh.

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
