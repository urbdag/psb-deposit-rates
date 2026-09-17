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

if (failures === 0) {
  console.log("\nAll SBI adapter + merge tests passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
