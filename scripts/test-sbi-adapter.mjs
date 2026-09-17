// Unit test for the SBI adapter's pure parser, using fixture HTML shaped like
// SBI's retail term-deposit page. No network required.
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

// Fixture: SBI-style retail rate table (rates illustrative). Includes a decoy
// table first, an effective-date string, and the real rate table.
const FIXTURE = `
<html><body>
  <p>Interest Rates w.e.f. 15 Aug 2026</p>
  <table><tr><th>Some other data</th><th>X</th></tr><tr><td>Foo</td><td>Bar</td></tr></table>
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
  </table>
</body></html>`;

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error("  ✗ " + msg);
    failures++;
  } else {
    console.log("  ✓ " + msg);
  }
};

const adapter = new SbiAdapter();
const rates = adapter.parse(FIXTURE, "2026-08-15");

console.log(`Parsed ${rates.length} rate entries`);

assert(rates.length === 16, "16 entries (8 tenures × general+senior)");
assert(
  rates.every((r) => r.bankId === "sbi" && r.product === "FD"),
  "all entries are SBI FD",
);
assert(
  rates.every(
    (r) =>
      r.source.quality === "OFFICIAL" &&
      r.source.effectiveDate === "2026-08-15",
  ),
  "all stamped OFFICIAL with effective date",
);

const oneYr = rates.find(
  (r) =>
    r.customer === "GENERAL" &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 729,
);
assert(
  oneYr?.ratePercent === 6.25,
  "1yr general = 6.25 (with % sign stripped)",
);

const oneYrSr = rates.find(
  (r) =>
    r.customer === "SENIOR" &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 729,
);
assert(oneYrSr?.ratePercent === 6.75, "1yr senior = 6.75");

const longest = rates.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 1825,
);
assert(
  longest?.ratePercent === 6.45 && longest?.tenure.maxDays === 3650,
  "5–10yr general = 6.45, maxDays 3650",
);

const short = rates.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 7,
);
assert(short?.tenure.maxDays === 45, "7–45 days parsed to maxDays 45");

// Empty/garbage HTML → no rows (triggers last-known-good fallback upstream).
assert(
  adapter.parse("<html><body>no tables here</body></html>", "2026-01-01")
    .length === 0,
  "garbage HTML → 0 entries",
);

if (failures === 0) {
  console.log("\nAll SBI adapter parser tests passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
