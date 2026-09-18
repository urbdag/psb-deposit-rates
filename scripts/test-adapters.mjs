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
const { CanaraAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/canara.js")
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

// ---------------------------------------------------------------------------
// BoB savings regression: the live BoB savings page is a single 2-column
// balance-slab table (col0 = balance-slab label, col1 = "X.XX %" with a space).
// No body row contains the word "saving" (only the header "SB Interest Rate
// Slab" does). Rate column in document order:
//   2.50 x4 (retail bands), 2.75 x3 (Rs 50cr..500cr), 3.50, 4.50, 4.75 (large).
// The STANDARD published savings rate is 2.75 — the cluster just above the base
// 2.50 retail band and below the large-balance 3.50/4.50/4.75 slabs. The
// extractor must isolate 2.75 by structure, NOT the base 2.50 nor a high slab.
// ---------------------------------------------------------------------------
console.log("== BoB multi-band savings (balance-slab table) ==");
const BOB_SAVINGS_FIXTURE = `
<html><body><table>
  <tr><th>Present SB Interest Rate Slab on O/s Balance</th><th>Interest Rates</th></tr>
  <tr><td>upto Rs. 1.00 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Above Rs 1.00 Lakh to less than Rs. 50 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Rs. 50 Lakh and less than Rs. 10 Crores</td><td>2.50 %</td></tr>
  <tr><td>Rs. 10 Crores and above to less than Rs. 50 Crores</td><td>2.50 %</td></tr>
  <tr><td>Rs. 50 Crores and above to less than Rs. 100 Crores</td><td>2.75 %</td></tr>
  <tr><td>Rs. 100 Crores and above to less than Rs. 200 Crores</td><td>2.75 %</td></tr>
  <tr><td>Rs. 200 Crores and above to less than Rs. 500 Crores</td><td>2.75 %</td></tr>
  <tr><td>Rs. 500 Crores and above to less than Rs. 1,000 Crores</td><td>3.50 %</td></tr>
  <tr><td>Rs. 1,000 Crores and above to less than Rs. 2,000 Crores</td><td>4.50 %</td></tr>
  <tr><td>Rs. 2,000 Crores and above</td><td>4.75 %</td></tr>
</table></body></html>`;
const bobSav = new BobAdapter().parseSavings(BOB_SAVINGS_FIXTURE, "2026-01-01");
assert(bobSav.length === 2, "BoB savings: 2 entries (general + senior)");
assert(
  bobSav.every(
    (r) =>
      r.product === "SAVINGS" &&
      r.ratePercent === 2.75 &&
      r.source.quality === "OFFICIAL",
  ),
  "BoB savings: standard rate = 2.75%, OFFICIAL (not 2.50 / 3.50 / 4.50 / 4.75)",
);

// ---------------------------------------------------------------------------
// Mis-tiering guard (soundness of the shared slab path). The slab helper runs
// first for ALL 12 banks. `clusters[1]` must be a genuine "one small step above
// the base band" rate, NOT a large institutional jump that merely happens to
// land inside the 2..4.5 window. If the second distinct band is an institutional
// slab (e.g. base 2.50 then 3.50/4.50), the slab path must REJECT it so no bank
// ships a mis-tiered OFFICIAL "standard" savings rate. Rejection returns null
// from the slab path; parseSavings then falls through to the row/prose
// heuristics (here there is no 'saving' row and no '% p.a.' prose, so the whole
// extractor yields null -> 0 rows, i.e. the bank keeps last-known-good rather
// than publishing a wrong rate). The delta threshold is 0.25 (== BoB's real
// step), so BoB's 2.50->2.75 is kept but any larger jump is rejected.
// ---------------------------------------------------------------------------
console.log("== Mis-tiering guard (institutional second band rejected) ==");

// Base 2.50, second (institutional) band 4.50 -> must NOT publish 4.50.
const MISTIER_BIGJUMP_FIXTURE = `
<html><body><table>
  <tr><th>Present SB Interest Rate Slab on O/s Balance</th><th>Interest Rates</th></tr>
  <tr><td>upto Rs. 1.00 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Above Rs 1.00 Lakh to less than Rs. 50 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Rs. 50 Lakh and less than Rs. 10 Crores</td><td>2.50 %</td></tr>
  <tr><td>Rs. 500 Crores and above to less than Rs. 1,000 Crores</td><td>4.50 %</td></tr>
  <tr><td>Rs. 1,000 Crores and above</td><td>4.75 %</td></tr>
</table></body></html>`;
const mistierBig = new BobAdapter().parseSavings(
  MISTIER_BIGJUMP_FIXTURE,
  "2026-01-01",
);
assert(
  mistierBig.length === 0,
  "mis-tier (2.50 then 4.50 institutional): slab path rejects -> 0 rows (no wrong OFFICIAL rate)",
);
assert(
  !mistierBig.some((r) => r.ratePercent === 4.5),
  "mis-tier: never publishes the 4.50 institutional slab as standard",
);

// Base 2.50, second band 3.50 — a jump of 1.0, still inside the 2..4.5 window
// (so the old absolute-only guard would have shipped it) but far above the
// 0.25 step, so it must be rejected too.
const MISTIER_MIDJUMP_FIXTURE = `
<html><body><table>
  <tr><th>Present SB Interest Rate Slab on O/s Balance</th><th>Interest Rates</th></tr>
  <tr><td>upto Rs. 1.00 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Above Rs 1.00 Lakh to less than Rs. 50 Lakh</td><td>2.50 %</td></tr>
  <tr><td>Rs. 50 Lakh and less than Rs. 10 Crores</td><td>2.50 %</td></tr>
  <tr><td>Rs. 100 Crores and above</td><td>3.50 %</td></tr>
</table></body></html>`;
const mistierMid = new BobAdapter().parseSavings(
  MISTIER_MIDJUMP_FIXTURE,
  "2026-01-01",
);
assert(
  mistierMid.length === 0,
  "mis-tier (2.50 then 3.50 inside 2..4.5): slab path rejects -> 0 rows",
);
assert(
  !mistierMid.some((r) => r.ratePercent === 3.5),
  "mis-tier: never publishes the 3.50 institutional slab as standard",
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

// ---------------------------------------------------------------------------
// fetchRates() orchestration: FD is hard-fail but savings is best-effort. An
// FD failure must NOT abort the savings scrape. When FD yields nothing but
// savings succeeds, fetchRates() returns the savings entries (no throw). Only
// a total washout (no FD *and* no savings) throws. Uses a stubbed global fetch
// so it runs fully offline (no network, no Playwright).
// ---------------------------------------------------------------------------
console.log("== fetchRates orchestration (FD-fail, savings best-effort) ==");
const { TableRateAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/base.js")
);

const realFetch = globalThis.fetch;
// Map URL -> { ok, text } (or null to simulate a network error / non-2xx).
function stubFetch(responses) {
  globalThis.fetch = async (url) => {
    const body = responses[url];
    if (body == null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

const FD_URL = "https://example.test/fd";
const SAV_URL = "https://example.test/savings";
const REAL_SAVINGS_HTML = `
<html><body><table>
  <tr><th>Product</th><th>Rate (% p.a.)</th></tr>
  <tr><td>Savings Bank Deposit</td><td>2.75% p.a.</td></tr>
</table></body></html>`;

// (a) FD page returns junk (no rate table) but savings page returns a real
//     rate: fetchRates must return the 2 savings entries and NOT throw.
try {
  stubFetch({
    [FD_URL]: "<html><body><p>penalty footnotes only</p></body></html>",
    [SAV_URL]: REAL_SAVINGS_HTML,
  });
  const a = new TableRateAdapter({
    bankId: "test",
    fdUrl: FD_URL,
    savingsUrls: [SAV_URL],
  });
  const rows = await a.fetchRates();
  const sav = rows.filter((r) => r.product === "SAVINGS");
  const fd = rows.filter((r) => r.product === "FD");
  assert(fd.length === 0, "FD-fail: no FD rows returned");
  assert(sav.length === 2, "FD-fail: savings still returned (general+senior)");
  assert(
    sav.every((r) => r.ratePercent === 2.75 && r.source.quality === "OFFICIAL"),
    "FD-fail: savings rate = 2.75%, OFFICIAL",
  );
  assert(
    sav.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.source.effectiveDate)),
    "FD-fail: savings gets a sensible fallback effective date",
  );
} catch (e) {
  assert(false, `FD-fail savings-success should not throw (got ${e})`);
}

// (b) Both FD and savings fail: fetchRates must throw the "no FD rates" error.
let threw = false;
try {
  stubFetch({
    [FD_URL]: "<html><body>nothing</body></html>",
    [SAV_URL]: "<html><body>nothing</body></html>",
  });
  const a = new TableRateAdapter({
    bankId: "test",
    fdUrl: FD_URL,
    savingsUrls: [SAV_URL],
  });
  await a.fetchRates();
} catch (e) {
  threw = true;
  assert(/no FD rates/.test(String(e)), "total washout: throws no-FD error");
}
assert(threw, "total washout: fetchRates throws");

globalThis.fetch = realFetch;

// ---------------------------------------------------------------------------
// Canara retail term-deposit page: the live retail (Less than Rs.3 Crore) table
// is a multi-column grid where each data row is
//   [tenure,
//    Callable-GenPub-RoI, Callable-GenPub-AnnualisedYield,
//    Callable-SrCit-RoI, Callable-SrCit-AnnualisedYield,
//    NonCallable-GenPub-RoI, NonCallable-GenPub-Yield,
//    NonCallable-SrCit-RoI, NonCallable-SrCit-Yield]
// The correct retail rates are cells[1] (general RoI) and cells[3] (senior
// RoI); cells[2]/cells[4] are ANNUALISED YIELDS and must be skipped (a generic
// (tenure,%,%) parser would wrongly take the yield as the senior rate). The
// bespoke Canara parser must map the RoI columns, tag 444/555 as single-day
// specials, DROP the broken 60-char 'Except 555 days' row (max<min), derive RD
// for standard >=1yr buckets, and never pick a bulk (>=3 crore) slab table.
// ---------------------------------------------------------------------------
console.log("== Canara retail FD/RD (multi-column RoI vs yield) ==");

const CANARA_FD_FIXTURE = `
<html><body>
  <p>Domestic Term Deposit Rates (Less than Rs.3 Crore) w.e.f. 10 Sep 2026</p>
  <table>
    <tr>
      <th rowspan="2">Period</th>
      <th colspan="4">Callable</th>
      <th colspan="4">Non-Callable</th>
    </tr>
    <tr>
      <th>Gen RoI</th><th>Gen Yield</th><th>Sr RoI</th><th>Sr Yield</th>
      <th>Gen RoI</th><th>Gen Yield</th><th>Sr RoI</th><th>Sr Yield</th>
    </tr>
    <tr><td>7 Days to 45 Days*</td><td>3.00</td><td>3.00</td><td>3.00</td><td>3.00</td><td>NA</td><td>NA</td><td>NA</td><td>NA</td></tr>
    <tr><td>46 Days to 90 Days</td><td>4.00</td><td>4.00</td><td>4.00</td><td>4.00</td><td>NA</td><td>NA</td><td>NA</td><td>NA</td></tr>
    <tr><td>180 Days to 269 Days</td><td>5.25</td><td>5.35</td><td>5.75</td><td>5.87</td><td>5.30</td><td>5.41</td><td>5.80</td><td>5.93</td></tr>
    <tr><td>270 Days to less than 1 Year</td><td>5.50</td><td>5.62</td><td>6.00</td><td>6.14</td><td>5.55</td><td>5.67</td><td>6.05</td><td>6.19</td></tr>
    <tr><td>1 Year &amp; above to 1 year 3 months Only (Except 444 days)</td><td>6.25</td><td>6.40</td><td>6.75</td><td>6.92</td><td>6.30</td><td>6.45</td><td>6.80</td><td>6.98</td></tr>
    <tr><td>444 Days ##</td><td>6.50</td><td>6.66</td><td>7.00</td><td>7.19</td><td>6.55</td><td>6.71</td><td>7.05</td><td>7.24</td></tr>
    <tr><td>555 Days ##</td><td>6.60</td><td>6.77</td><td>7.10</td><td>7.29</td><td>6.65</td><td>6.82</td><td>7.15</td><td>7.34</td></tr>
    <tr><td>Above 1 Year 3 months to less than 2 Years (Except 555 days)</td><td>6.25</td><td>6.40</td><td>6.75</td><td>6.92</td><td>6.30</td><td>6.45</td><td>6.80</td><td>6.98</td></tr>
    <tr><td>2 Years &amp; above to less than 3 Years</td><td>6.25</td><td>6.40</td><td>6.75</td><td>6.92</td><td>6.30</td><td>6.45</td><td>6.80</td><td>6.98</td></tr>
    <tr><td>3 Years &amp; above to less than 5 Years</td><td>6.25</td><td>6.40</td><td>6.75</td><td>6.92</td><td>6.30</td><td>6.45</td><td>6.80</td><td>6.98</td></tr>
    <tr><td>5 Years &amp; above to 10 Years</td><td>6.25</td><td>6.40</td><td>6.75</td><td>6.92</td><td>6.30</td><td>6.45</td><td>6.80</td><td>6.98</td></tr>
  </table>
</body></html>`;

const canara = new CanaraAdapter();
const canaraRows = canara.parseFdRd(
  CANARA_FD_FIXTURE,
  "2026-09-10",
  "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.",
);
const canaraFd = canaraRows.filter((r) => r.product === "FD");
const canaraRd = canaraRows.filter((r) => r.product === "RD");

// (1) General comes from the RoI column, NOT the annualised-yield column.
const c180 = canaraFd.filter(
  (r) => r.tenure.minDays === 180 && r.tenure.maxDays === 269,
);
const c180gen = c180.find((r) => r.customer === "GENERAL");
const c180sr = c180.find((r) => r.customer === "SENIOR");
assert(
  c180gen?.ratePercent === 5.25,
  "Canara 180-269d general = 5.25 (RoI, not the 5.35 yield)",
);
assert(
  c180sr?.ratePercent === 5.75,
  "Canara 180-269d senior = 5.75 (senior RoI, not the 5.87 yield)",
);

// (2) Senior = the senior RoI column (cells[3]), e.g. 1yr general 6.25 / senior 6.75.
const c1y = canaraFd.filter(
  (r) => r.tenure.minDays === 365 && r.tenure.maxDays === 365,
);
const c1ygen = c1y.find((r) => r.customer === "GENERAL");
const c1ysr = c1y.find((r) => r.customer === "SENIOR");
assert(c1ygen?.ratePercent === 6.25, "Canara 1yr general = 6.25");
assert(c1ysr?.ratePercent === 6.75, "Canara 1yr senior = 6.75 (senior RoI)");

// (3) 444 & 555 Days are FD-only single-day specials, tagged with a scheme, no RD.
const c444 = canaraFd.find(
  (r) => r.tenure.minDays === 444 && r.customer === "GENERAL",
);
const c555 = canaraFd.find(
  (r) => r.tenure.minDays === 555 && r.customer === "GENERAL",
);
assert(
  c444?.tenure.maxDays === 444 && c444?.ratePercent === 6.5,
  "Canara 444 Days is a single-day FD special, general = 6.50",
);
assert(
  c444?.scheme === "Canara 444 Days Deposit",
  "Canara 444 Days tagged with a scheme",
);
assert(
  c555?.tenure.maxDays === 555 && c555?.ratePercent === 6.6,
  "Canara 555 Days is a single-day FD special, general = 6.60",
);
assert(
  c555?.scheme === "Canara 555 Days Deposit",
  "Canara 555 Days tagged with a scheme",
);
assert(
  !canaraRd.some((r) => r.tenure.minDays === 444 || r.tenure.minDays === 555),
  "Canara 444/555 Days specials are NOT emitted as RD",
);

// (4) RD derived for standard >=1yr buckets, OFFICIAL, canarabank.bank.in source.
const canaraRd2y = canaraRd.find(
  (r) =>
    r.customer === "SENIOR" &&
    r.tenure.minDays === 730 &&
    r.tenure.maxDays === 1094,
);
assert(
  canaraRd2y?.ratePercent === 6.75,
  "Canara RD 2-3yr senior derived from FD senior RoI = 6.75",
);
assert(
  canaraRd.length > 0 &&
    canaraRd.every(
      (r) =>
        r.source.quality === "OFFICIAL" &&
        /canarabank\.bank\.in/.test(r.source.url) &&
        r.tenure.minDays >= 365,
    ),
  "Canara RD rows are OFFICIAL, sourced from canarabank.bank.in, >=1yr",
);

// (5) The broken 60-char 'Except 555 days' row (max<min) is dropped.
assert(
  canaraFd.every((r) => r.tenure.maxDays == null || r.tenure.maxDays >= r.tenure.minDays),
  "Canara: no row with maxDays<minDays (broken 'Except 555 days' row dropped)",
);

// (6) All emitted rows are OFFICIAL from the user's page.
assert(
  canaraRows.every(
    (r) =>
      r.source.quality === "OFFICIAL" &&
      r.source.url ===
        "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.",
  ),
  "Canara: all rows OFFICIAL with the term-deposit page source url",
);

// (7) >=4 distinct FD tenures parsed (base sanity guard satisfied).
const canaraFdTenures = new Set(
  canaraFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(
  canaraFdTenures.size >= 4,
  `Canara: >=4 distinct FD tenures (got ${canaraFdTenures.size})`,
);

// Bulk (>=3 crore) slab table must NOT be scraped as retail rates.
console.log("== Canara bulk (>=3 crore) slab NOT parsed as retail ==");
const CANARA_BULK_FIXTURE = `
<html><body>
  <p>Bulk Deposits (Rs.3 Crore &amp; above) - Callable</p>
  <table>
    <tr><th>Period</th><th>Rs.3 Crore &amp; above to less than Rs.10 Crore</th><th>Rs.10 Crore &amp; above</th></tr>
    <tr><td>7 Days to 45 Days</td><td>5.00</td><td>5.10</td></tr>
    <tr><td>46 Days to 90 Days</td><td>5.25</td><td>5.35</td></tr>
    <tr><td>180 Days to 269 Days</td><td>6.00</td><td>6.10</td></tr>
    <tr><td>1 Year &amp; above to less than 2 Years</td><td>6.50</td><td>6.60</td></tr>
    <tr><td>2 Years &amp; above to less than 3 Years</td><td>6.40</td><td>6.50</td></tr>
  </table>
</body></html>`;
const canaraBulk = canara.parseFdRd(
  CANARA_BULK_FIXTURE,
  "2026-09-10",
  "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.",
);
assert(
  canaraBulk.length === 0,
  "Canara bulk (>=3 crore) slab fixture yields 0 retail rows",
);

// When both tables are present, only the retail table is scraped (bulk ignored).
const CANARA_BOTH_FIXTURE = CANARA_BULK_FIXTURE.replace(
  "</body></html>",
  CANARA_FD_FIXTURE.replace(/^[\s\S]*?<table>/, "<table>").replace(
    /<\/body><\/html>\s*$/,
    "",
  ) + "</body></html>",
);
const canaraBoth = canara.parseFdRd(
  CANARA_BOTH_FIXTURE,
  "2026-09-10",
  "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.",
);
const both1y = canaraBoth.find(
  (r) =>
    r.product === "FD" &&
    r.customer === "GENERAL" &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 365,
);
assert(
  both1y?.ratePercent === 6.25,
  "Canara: with bulk+retail present, retail 1yr general = 6.25 (bulk 6.50 ignored)",
);

if (failures === 0) {
  console.log("\nAll adapter + merge + PDF + div tests passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
