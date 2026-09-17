// Unit tests for the SBI adapter's pure parsers (FD+RD, savings) and for the
// ingest merge-by-product logic. No network required.
//
//   node scripts/test-sbi-adapter.mjs
//
// Exit 0 = all assertions pass, 1 = failure.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const { SbiAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/sbi.js")
);
const { PnbAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/pnb.js")
);
const { BobAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/bob.js")
);
const { BoiAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/boi.js")
);

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error("  ✗ " + msg);
    failures++;
  } else {
    console.log("  ✓ " + msg);
  }
};

// ---------------------------------------------------------------------------
// Fixture: SBI-style retail term-deposit table, incl. the 444-day special row.
// ---------------------------------------------------------------------------
const FD_FIXTURE = `
<html><body>
  <p>Interest Rates w.e.f. 15 Aug 2026</p>
  <table><tr><th>Other</th><th>X</th></tr><tr><td>Foo</td><td>Bar</td></tr></table>
  <table>
    <tr><th>Tenors</th><th>General Public (%)</th><th>Senior Citizens (%)</th></tr>
    <tr><td>7 days to 45 days</td><td>3.05</td><td>3.55</td></tr>
    <tr><td>46 days to 179 days</td><td>5.00</td><td>5.50</td></tr>
    <tr><td>180 days to 210 days</td><td>5.75</td><td>6.25</td></tr>
    <tr><td>211 days to less than 1 year</td><td>6.00</td><td>6.50</td></tr>
    <tr><td>1 Year to less than 2 years</td><td>6.25%</td><td>6.75%</td></tr>
    <tr><td>2 years to less than 3 years</td><td>6.60</td><td>7.10</td></tr>
    <tr><td>3 years to less than 5 years</td><td>6.60</td><td>7.10</td></tr>
    <tr><td>5 years and up to 10 years</td><td>6.45</td><td>7.05</td></tr>
    <tr><td>444 days (Amrit Vrishti)</td><td>6.45</td><td>6.95</td></tr>
  </table>
</body></html>`;

const SAVINGS_FIXTURE = `
<html><body><table>
  <tr><th>Savings Bank Deposit</th><th>Rate of Interest (% p.a.)</th></tr>
  <tr><td>Savings Bank balance</td><td>2.50% p.a.</td></tr>
</table></body></html>`;

console.log("== FD + RD parser ==");
const adapter = new SbiAdapter();
const fdRd = adapter.parseFdRd(FD_FIXTURE, "2026-08-15");

const fd = fdRd.filter((r) => r.product === "FD");
const rd = fdRd.filter((r) => r.product === "RD");

// 9 tenures × (general+senior) = 18 FD entries
assert(fd.length === 18, `18 FD entries (got ${fd.length})`);
assert(
  fdRd.every(
    (r) =>
      r.source.quality === "OFFICIAL" &&
      r.source.effectiveDate === "2026-08-15",
  ),
  "all stamped OFFICIAL with effective date",
);

const oneYr = fd.find(
  (r) =>
    r.customer === "GENERAL" &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 729,
);
assert(oneYr?.ratePercent === 6.25, "FD 1yr general = 6.25");

const longest = fd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 1825,
);
assert(
  longest?.ratePercent === 6.45 && longest?.tenure.maxDays === 3650,
  "FD 5–10yr general = 6.45, maxDays 3650",
);

// Special 444-day row: FD-only, tagged with scheme, NOT emitted as RD.
const special = fd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 444,
);
assert(
  special?.tenure.maxDays === 444,
  "444-day special is a single-day tenure",
);
assert(
  special?.scheme === "Amrit Vrishti 444 days",
  "444-day tagged as Amrit Vrishti scheme",
);
assert(special?.ratePercent === 6.45, "444-day general = 6.45");

// RD: derived from standard buckets with minDays >= 365 (1yr,2yr,3yr,5yr) × 2 = 8
assert(
  rd.length === 8,
  `8 RD entries derived from >=1yr buckets (got ${rd.length})`,
);
assert(
  rd.every((r) => r.tenure.minDays >= 365),
  "RD only for tenures >= 1 year",
);
assert(
  !rd.some((r) => r.tenure.minDays === 444),
  "RD not created for the 444-day special",
);
const rd2yr = rd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 730,
);
assert(rd2yr?.ratePercent === 7.1, "RD 2yr senior tracks FD card rate 7.10");

console.log("== Savings parser ==");
const sav = adapter.parseSavings(SAVINGS_FIXTURE, "2026-08-15");
assert(sav.length === 2, "2 savings entries (general + senior)");
assert(
  sav.every((r) => r.product === "SAVINGS" && r.ratePercent === 2.5),
  "savings rate = 2.50%",
);

console.log("== Resilience ==");
assert(
  adapter.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "garbage FD HTML → 0",
);
assert(
  adapter.parseSavings("<html>no rate</html>", "2026-01-01").length === 0,
  "garbage savings HTML → 0",
);

// ---------------------------------------------------------------------------
// Merge-by-product logic (mirrors scripts/ingest.mjs). A partial scrape (FD+RD
// only) must NOT drop a bank's existing SAVINGS rows.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Shared base drives the other bank adapters. A generic PSU-style FD table
// should parse for PNB/BoB/BoI, and BoB's scheme namer should tag specials.
// ---------------------------------------------------------------------------
console.log("== PNB / BoB / BoI (shared base) ==");

const GENERIC_FD_FIXTURE = `
<html><body>
  <p>Rates effective 12 Jun 2026</p>
  <table>
    <tr><th>Tenor</th><th>General (%)</th><th>Senior Citizen (%)</th></tr>
    <tr><td>7 days to 45 days</td><td>3.50</td><td>4.00</td></tr>
    <tr><td>1 year</td><td>6.25</td><td>6.75</td></tr>
    <tr><td>2 years to less than 3 years</td><td>6.60</td><td>7.10</td></tr>
    <tr><td>3 years to less than 5 years</td><td>6.50</td><td>7.00</td></tr>
    <tr><td>555 days (Golden Goal)</td><td>6.75</td><td>7.25</td></tr>
  </table>
</body></html>`;

for (const Adapter of [PnbAdapter, BobAdapter, BoiAdapter]) {
  const a = new Adapter();
  const rows = a.parseFdRd(GENERIC_FD_FIXTURE, "2026-06-12");
  assert(rows.length > 0, `${a.bankId}: parses a generic PSU FD table`);
  assert(
    rows.every((r) => r.bankId === a.bankId && r.source.quality === "OFFICIAL"),
    `${a.bankId}: rows tagged with bankId + OFFICIAL`,
  );
  const oneYr = rows.find(
    (r) =>
      r.product === "FD" &&
      r.customer === "GENERAL" &&
      r.tenure.minDays === 365,
  );
  assert(oneYr?.ratePercent === 6.25, `${a.bankId}: 1yr general = 6.25`);
}

// BoB tags the 555-day special as Golden Goal; PNB uses the generic namer.
const bobRows = new BobAdapter().parseFdRd(GENERIC_FD_FIXTURE, "2026-06-12");
const bobSpecial = bobRows.find(
  (r) => r.tenure.minDays === 555 && r.customer === "GENERAL",
);
assert(
  bobSpecial?.scheme === "bob Golden Goal 555 days",
  "BoB 555d tagged as Golden Goal",
);
assert(bobSpecial?.ratePercent === 6.75, "BoB Golden Goal general = 6.75");

const pnbRows = new PnbAdapter().parseFdRd(GENERIC_FD_FIXTURE, "2026-06-12");
const pnbSpecial = pnbRows.find(
  (r) => r.tenure.minDays === 555 && r.customer === "GENERAL",
);
assert(
  pnbSpecial?.scheme === "555-day Special",
  "PNB 555d uses generic scheme name",
);

console.log("== Merge by product ==");
function mergeByProduct(prior, scraped) {
  const scrapedProducts = new Set(scraped.map((r) => r.product));
  const retained = prior.filter((r) => !scrapedProducts.has(r.product));
  return [...scraped, ...retained];
}
const prior = [
  { bankId: "sbi", product: "FD", ratePercent: 6.0 },
  { bankId: "sbi", product: "SAVINGS", ratePercent: 2.7 },
  { bankId: "sbi", product: "RD", ratePercent: 6.5 },
];
const scrapedFdOnly = [{ bankId: "sbi", product: "FD", ratePercent: 6.25 }];
const merged = mergeByProduct(prior, scrapedFdOnly);
assert(
  merged.filter((r) => r.product === "FD").length === 1,
  "FD replaced by scrape",
);
assert(
  merged.find((r) => r.product === "FD").ratePercent === 6.25,
  "FD uses new scraped rate",
);
assert(
  merged.some((r) => r.product === "SAVINGS" && r.ratePercent === 2.7),
  "SAVINGS retained (last-known-good)",
);
assert(
  merged.some((r) => r.product === "RD" && r.ratePercent === 6.5),
  "RD retained (last-known-good)",
);

// ---------------------------------------------------------------------------
// PDF rate-card parser: text extracted from a PDF loses table structure, so a
// row arrives as one line mixing tenure + rate figures. Verify we recover them.
// ---------------------------------------------------------------------------
console.log("== PDF rate-card parser ==");
const { parsePdfRates } = await import(
  resolve(root, "public/js/ingest/pdf-rates.js")
);

const PDF_TEXT = [
  "BANK OF BARODA — Domestic Term Deposit Rates (w.e.f. 12 Jun 2026)",
  "Tenure                          General   Senior Citizen",
  "7 days to 45 days               3.50%     4.00%",
  "1 year to less than 2 years     6.25%     6.75%",
  "2 years to less than 3 years    6.60%     7.10%",
  "3 years to less than 5 years    6.50%     7.00%",
  "555 Days (bob Golden Goal)      6.75%     7.25%",
  "* Rates are indicative. TDS applicable as per IT Act.",
].join("\n");

const pdfRows = parsePdfRates(PDF_TEXT, {
  bankId: "bob",
  source: {
    url: "https://x/rates.pdf",
    effectiveDate: "2026-06-12",
    quality: "OFFICIAL",
  },
  amount: {
    minAmount: 0,
    maxAmount: 30000000,
    label: "Below ₹3 crore (retail)",
  },
  rdMinDays: 365,
  schemeNamer: (t) =>
    /golden goal/i.test(t) || /\b555\b/.test(t)
      ? "bob Golden Goal 555 days"
      : undefined,
});

const pdfFd = pdfRows.filter((r) => r.product === "FD");
assert(pdfFd.length >= 8, `PDF: parsed >=8 FD rows (got ${pdfFd.length})`);
const pdf1y = pdfFd.find(
  (r) =>
    r.customer === "GENERAL" &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 729,
);
assert(pdf1y?.ratePercent === 6.25, "PDF: 1yr general = 6.25");
const pdf1ySr = pdfFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 365,
);
assert(pdf1ySr?.ratePercent === 6.75, "PDF: 1yr senior = 6.75");
const pdfSpecial = pdfFd.find(
  (r) => r.tenure.minDays === 555 && r.customer === "GENERAL",
);
assert(
  pdfSpecial?.scheme === "bob Golden Goal 555 days",
  "PDF: 555d tagged Golden Goal",
);
assert(pdfSpecial?.ratePercent === 6.75, "PDF: 555d general = 6.75");
const pdfRd = pdfRows.filter((r) => r.product === "RD");
assert(
  pdfRd.length >= 6 && !pdfRd.some((r) => r.tenure.minDays === 555),
  "PDF: RD derived, excludes 555d special",
);
assert(
  parsePdfRates("Just some footnote text, no rates here.", {
    bankId: "bob",
    source: { url: "x", effectiveDate: "", quality: "OFFICIAL" },
    amount: { minAmount: 0, maxAmount: null, label: "x" },
  }).length === 0,
  "PDF: non-rate text -> 0 rows",
);

// Bare-decimal variant (no % signs, as some PDFs render).
const pdfBare = parsePdfRates("1 year to less than 2 years 6.40 6.90", {
  bankId: "union",
  source: { url: "x", effectiveDate: "", quality: "OFFICIAL" },
  amount: { minAmount: 0, maxAmount: 30000000, label: "retail" },
  rdMinDays: 365,
});
assert(
  pdfBare.find((r) => r.product === "FD" && r.customer === "GENERAL")
    ?.ratePercent === 6.4,
  "PDF: bare decimals (no %) parsed -> 6.40",
);

// ---------------------------------------------------------------------------
// Div-based page (no <table>): htmlToText -> line parser should still work.
// ---------------------------------------------------------------------------
console.log("== Div-based page (htmlToText + line parser) ==");
const { htmlToText } = await import(resolve(root, "public/js/ingest/html.js"));
const DIV_HTML = `
<html><body>
  <div class="rates">
    <div class="row"><span>1 year to less than 2 years</span><span>6.25%</span><span>6.75%</span></div>
    <div class="row"><span>2 years to less than 3 years</span><span>6.60%</span><span>7.10%</span></div>
    <div class="row"><span>3 years to less than 5 years</span><span>6.50%</span><span>7.00%</span></div>
  </div>
</body></html>`;
const bobAdapter = new BobAdapter();
const divRows = bobAdapter.parseTextFdRd(
  htmlToText(DIV_HTML),
  "https://x/deposits",
  "2026-06-12",
);
const divFd = divRows.filter((r) => r.product === "FD");
assert(divFd.length >= 6, `div page: parsed >=6 FD rows (got ${divFd.length})`);
assert(
  divFd.find((r) => r.customer === "GENERAL" && r.tenure.minDays === 365)
    ?.ratePercent === 6.25,
  "div page: 1yr general = 6.25",
);
assert(
  divFd.find((r) => r.customer === "SENIOR" && r.tenure.minDays === 730)
    ?.ratePercent === 7.1,
  "div page: 2yr senior = 7.10",
);

if (failures === 0) {
  console.log("\nAll adapter + merge + PDF + div tests passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
