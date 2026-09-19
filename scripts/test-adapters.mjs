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
const { HdfcAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/hdfc.js")
);
const { KotakAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/kotak.js")
);
const { IndusindAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/indusind.js")
);
const { IdfcfirstAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/idfcfirst.js")
);
const { FederalAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/federal.js")
);
const { IciciAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/icici.js")
);
const { CapitalsfbAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/capitalsfb.js")
);
const { ShivalikAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/shivalik.js")
);
const { RblAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/rbl.js")
);
const { CityunionAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/cityunion.js")
);
const { CsbAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/csb.js")
);
const { FinoAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/fino.js")
);
const { DeutscheAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/deutsche.js")
);
const { DbsAdapter } = await import(
  resolve(root, "public/js/ingest/adapters/dbs.js")
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

// ---------------------------------------------------------------------------
// PNB real page structure: the live pnb.bank.in term-deposit page carries many
// tables. The main retail "Domestic/NRO Fixed Deposit Scheme" ladder leads each
// row with a serial-number column, so the tenure is in cells[1] and the
// general/senior rates in cells[2]/cells[3]. Earlier in DOM order sit an NRE /
// bulk (₹3cr–₹10cr) table and a PNB TAX SAVER table that only lists ≥5-year
// buckets — the latter is what the generic base used to latch onto (leaving PNB
// with just 4 five-year-plus rows). The bespoke parser must select the full
// short-to-long ladder instead.
// ---------------------------------------------------------------------------
console.log("== PNB real page (multi-table Domestic ladder) ==");

const PNB_REAL_FIXTURE = `
<html><body>
  <p>Interest Rates w.e.f. 01 Jun 2026</p>
  <table>
    <tr><th>Saving Fund Account Balance</th><th>Rate of Interest</th></tr>
    <tr><td>Balance up to Rs. 100 Crore</td><td>2.50% p.a.</td></tr>
    <tr><td>Balance above Rs. 100 Crore</td><td>2.70% p.a.</td></tr>
  </table>
  <table>
    <tr><th colspan="6">NRE Term Deposit</th></tr>
    <tr><td></td><td></td><td>less than Rs. 3 Cr.</td><td>Rs. 3 Cr. To Rs. 10 Cr.</td></tr>
    <tr><td>Sl. No</td><td>Period</td><td>Existing Rates For Public w.e.f. 24.02.2026</td><td>Revised Rates For Public w.e.f. 01.06.2026</td><td>Existing (% p.a.)</td><td>Revised (% p.a.)</td></tr>
    <tr><td>1</td><td>1 Year</td><td>6.25</td><td>6.25</td><td>6.25</td><td>6.25</td></tr>
    <tr><td>2</td><td>444 Days</td><td>6.60</td><td>6.60</td><td>6.60</td><td>6.60</td></tr>
    <tr><td>3</td><td>667 Days to 2 Years</td><td>6.30</td><td>6.30</td><td>6.15</td><td>6.15</td></tr>
    <tr><td>4</td><td>&gt;2 to 3 Years</td><td>6.30</td><td>6.30</td><td>6.15</td><td>6.15</td></tr>
  </table>
  <table>
    <tr><th colspan="5">Domestic/NRO $ Fixed Deposit Scheme</th></tr>
    <tr><td>Sl. No</td><td>Period</td><td>Revised Rates For Public w.e.f. 01.06.2026</td><td>*Revised Rates for Senior Citizens w.e.f. 01.06.2026</td><td>#Revised Rates for Super Senior Citizens w.e.f. 01.06.2026</td></tr>
    <tr><td>1</td><td>7 to 14 Days</td><td>3.00</td><td>3.50</td><td>3.80</td></tr>
    <tr><td>2</td><td>15 to 45 Days</td><td>3.00</td><td>3.50</td><td>3.80</td></tr>
    <tr><td>3</td><td>46 to 90 Days</td><td>4.50</td><td>5.00</td><td>5.30</td></tr>
    <tr><td>4</td><td>91 to 154 Days</td><td>4.90</td><td>5.40</td><td>5.70</td></tr>
    <tr><td>5</td><td>155 Days</td><td>5.55</td><td>6.05</td><td>6.35</td></tr>
    <tr><td>6</td><td>180 to 270 Days</td><td>5.60</td><td>6.10</td><td>6.40</td></tr>
    <tr><td>7</td><td>1 Year</td><td>6.25</td><td>6.75</td><td>7.05</td></tr>
    <tr><td>8</td><td>&gt;1 Year to 389 Days</td><td>6.30</td><td>6.80</td><td>7.10</td></tr>
    <tr><td>9</td><td>444 Days</td><td>6.60</td><td>7.10</td><td>7.40</td></tr>
    <tr><td>10</td><td>667 Days to 2 Years</td><td>6.30</td><td>6.80</td><td>7.10</td></tr>
    <tr><td>11</td><td>&gt;2 to 3 Years</td><td>6.30</td><td>6.80</td><td>7.10</td></tr>
    <tr><td>12</td><td>1205 Days to 5 Years</td><td>6.35</td><td>6.85</td><td>7.15</td></tr>
    <tr><td>13</td><td>&gt;5 Years to 10 Years</td><td>6.00</td><td>6.80</td><td>6.80</td></tr>
  </table>
  <table>
    <tr><th colspan="9">“PNB TAX SAVER FIXED DEPOSIT SCHEME”</th></tr>
    <tr><td></td><td>Public (General)</td><td>Sr. Citizen (General)</td><td>Staff Members</td><td>Retired Staff* (Sr. Citizen)</td></tr>
    <tr><td>5 Years</td><td>6.25</td><td>6.10</td><td>6.75</td><td>6.60</td><td>7.25</td><td>7.10</td><td>7.25</td><td>6.90</td></tr>
    <tr><td>&gt; 5 Years to 1894 days</td><td>6.00</td><td>6.00</td><td>6.50</td><td>6.50</td><td>7.00</td><td>7.00</td><td>7.00</td><td>7.00</td></tr>
    <tr><td>1895 days</td><td>5.85</td><td>6.00</td><td>6.35</td><td>6.50</td><td>6.85</td><td>7.00</td><td>6.85</td><td>7.00</td></tr>
    <tr><td>1895 days to 10 years</td><td>6.00</td><td>6.00</td><td>6.50</td><td>6.50</td><td>7.00</td><td>7.00</td><td>7.00</td><td>7.00</td></tr>
  </table>
</body></html>`;

const pnbRealRows = new PnbAdapter().parseFdRd(PNB_REAL_FIXTURE, "2026-06-01");
const pnbFdGeneral = pnbRealRows.filter(
  (r) => r.product === "FD" && r.customer === "GENERAL",
);
assert(
  pnbRealRows.every(
    (r) => r.bankId === "pnb" && r.source.quality === "OFFICIAL",
  ),
  "PNB real: all rows bankId=pnb + OFFICIAL",
);
// 365-day (1-year) GENERAL bucket must parse with the retail public rate (6.25),
// NOT the NRE/bulk table and NOT the ≥5yr TAX SAVER slice.
const pnb1yr = pnbFdGeneral.find(
  (r) =>
    r.tenure.minDays <= 365 &&
    (r.tenure.maxDays == null || r.tenure.maxDays >= 365) &&
    r.tenure.minDays === 365 &&
    r.tenure.maxDays === 365,
);
assert(
  pnb1yr != null && pnb1yr.ratePercent === 6.25,
  "PNB real: 365-day (1 Year) GENERAL bucket parses at 6.25",
);
// Full short-to-long ladder: many distinct tenures spanning short + long.
const pnbTenures = new Set(
  pnbFdGeneral.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(
  pnbTenures.size >= 4,
  `PNB real: >=4 distinct FD tenures parsed (got ${pnbTenures.size})`,
);
const pnbMinDays = pnbFdGeneral.map((r) => r.tenure.minDays);
assert(
  pnbMinDays.some((d) => d <= 45),
  "PNB real: a short-tenure (<=45 day) bucket is present",
);
assert(
  pnbMinDays.some((d) => d >= 1825),
  "PNB real: a long-tenure (>=5yr) bucket is present",
);
// The 7-14 day short bucket proves the main ladder (not the ≥5yr slice) won.
const pnbShort = pnbFdGeneral.find(
  (r) => r.tenure.minDays === 7 && r.tenure.maxDays === 14,
);
assert(
  pnbShort != null && pnbShort.ratePercent === 3.0,
  "PNB real: 7-14 day GENERAL bucket parses at 3.00 (main ladder selected)",
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

// ===========================================================================
// PRIVATE-SECTOR BANK ADAPTERS
// Each fixture reproduces the bank's REAL captured retail (< ₹3 crore) domestic
// term-deposit table shape (from the CI diagnose workflow), so the assertions
// exercise that bank's specific parsing path and would fail on a regression.
// ===========================================================================

// ---------------------------------------------------------------------------
// HDFC Bank: plain server-rendered (tenure, General %, Senior %) table. HDFC's
// tenure labels are unusually compound ("2 Years 11 Months (35 months)",
// "3 Years 1 day to < 4 Years 7 Months", "5 Years 1 day to 10 Years"), which
// the PSU two-pair tenure parser inverts (max<min) — the private compound
// resolver must recover them so the long-tenure buckets are NOT dropped.
// Retail table, general = cells[1], senior = cells[2]. Source: hdfcbank.com.
// ---------------------------------------------------------------------------
console.log("== HDFC (compound tenure labels, standard 2 columns) ==");
const HDFC_FD_FIXTURE = `
<html><body>
  <p>Interest Rates w.e.f. 01 Sep 2026</p>
  <table>
    <tr><th>Tenure Bucket</th><th>&lt; 3 Crore</th></tr>
    <tr><td>&nbsp;</td><td>Interest Rate (per annum)</td><td>**Senior Citizen Rates (per annum)</td></tr>
    <tr><td>7 - 14 days</td><td>2.75%</td><td>3.25%</td></tr>
    <tr><td>90 days &lt;= 6 months</td><td>4.25%</td><td>4.75%</td></tr>
    <tr><td>9 months 1 day to &lt; 1 Year&nbsp;</td><td>5.75%</td><td>6.25%</td></tr>
    <tr><td>1 Year to &lt; 15 months</td><td>6.25%</td><td>6.75%</td></tr>
    <tr><td>15 months to &lt; 18 months</td><td>6.35%</td><td>6.85%</td></tr>
    <tr><td>21 months to 2 years</td><td>6.45%</td><td>6.95%</td></tr>
    <tr><td>2 Years 11 Months (35 months)</td><td>6.45%</td><td>6.95%</td></tr>
    <tr><td>3 Years 1 day to &lt; 4 Years 7 Months</td><td>6.50%</td><td>7.10%</td></tr>
    <tr><td>5 Years 1 day to 10 Years</td><td>6.15%</td><td>6.65%</td></tr>
  </table>
</body></html>`;
const hdfc = new HdfcAdapter();
const hdfcRows = hdfc.parseFdRd(HDFC_FD_FIXTURE, "2026-09-01");
const hdfcFd = hdfcRows.filter((r) => r.product === "FD");
assert(hdfcFd.length >= 16, `HDFC: >=16 FD rows (got ${hdfcFd.length})`);
assert(
  hdfcRows.every(
    (r) =>
      r.bankId === "hdfc" &&
      r.source.quality === "OFFICIAL" &&
      /hdfc(bank\.com|\.bank\.in)/.test(r.source.url),
  ),
  "HDFC: all rows OFFICIAL, bankId=hdfc, official-domain source URL",
);
const hdfc1y = hdfcFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 365,
);
assert(hdfc1y?.ratePercent === 6.25, "HDFC 1yr general = 6.25");
// The compound long buckets survive with sane (max>=min) ranges + correct rates.
const hdfc3y = hdfcFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 1096,
);
assert(
  hdfc3y?.ratePercent === 7.1 && hdfc3y?.tenure.maxDays >= hdfc3y?.tenure.minDays,
  "HDFC compound '3 Years 1 day to <4Y7M' senior = 7.10 (recovered, not dropped)",
);
const hdfc5y = hdfcFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 1826,
);
assert(
  hdfc5y?.ratePercent === 6.15 && hdfc5y?.tenure.maxDays === 3650,
  "HDFC compound '5 Years 1 day to 10 Years' general = 6.15, maxDays 3650",
);
assert(
  hdfcFd.every((r) => r.tenure.maxDays == null || r.tenure.maxDays >= r.tenure.minDays),
  "HDFC: no inverted (max<min) tenure ranges published",
);
assert(
  hdfc.parseFdRd("<html>no tables here</html>", "2026-01-01").length === 0,
  "HDFC: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// Kotak Mahindra Bank: multi-column amount-slab grid. Each data row is
//   [tenure,
//    Regular <3cr, Regular 3-5cr, Senior <3cr, Senior 3-5cr].
// The correct RETAIL columns are cells[1] (regular <3cr) and cells[3] (senior
// <3cr). A naive (tenure,%,%) parser would take cells[2] (the 3-5cr regular
// rate) as senior — WRONG. generalCol=1 / seniorCol=3 must map them correctly.
// Source: kotak.com.
// ---------------------------------------------------------------------------
console.log("== Kotak (4-column amount-slab grid, retail cols 1 & 3) ==");
const KOTAK_FD_FIXTURE = `
<html><body>
  <p>Fixed Deposit rates w.e.f. 01 Sep 2026</p>
  <table>
    <tr><td></td><td>Regular</td><td></td><td>Senior Citizen*</td><td></td></tr>
    <tr><td>Maturity Periods - Premature Withdrawal Allowed</td><td>Less than Rs.3 Crore#</td><td>Rs. 3 Cr. &amp; above but less than Rs. 5 Cr.</td><td>Less than Rs.3 Crore#</td><td>Rs. 3 Cr. &amp; above but less than Rs. 5 Cr.</td></tr>
    <tr><td>7 - 14 Days</td><td>2.75%</td><td>2.75%</td><td>3.25%</td><td>2.75%</td></tr>
    <tr><td>181 Days to 269 Days</td><td>5.50%</td><td>5.50%</td><td>6.00%</td><td>5.50%</td></tr>
    <tr><td>365 Days to less than 15 Months</td><td>6.35%</td><td>6.35%</td><td>6.85%</td><td>6.35%</td></tr>
    <tr><td>2 years- less than 3 years</td><td>6.80%</td><td>6.80%</td><td>7.30%</td><td>6.80%</td></tr>
    <tr><td>3 years and above but less than 4 years</td><td>6.40%</td><td>6.40%</td><td>6.90%</td><td>6.40%</td></tr>
    <tr><td>5 years and above upto and inclusive of 10 years</td><td>6.25%</td><td>6.25%</td><td>6.75%</td><td>6.25%</td></tr>
  </table>
</body></html>`;
const kotak = new KotakAdapter();
const kotakRows = kotak.parseFdRd(KOTAK_FD_FIXTURE, "2026-09-01");
const kotakFd = kotakRows.filter((r) => r.product === "FD");
assert(kotakFd.length >= 12, `Kotak: >=12 FD rows (got ${kotakFd.length})`);
assert(
  kotakRows.every(
    (r) =>
      r.bankId === "kotak" &&
      r.source.quality === "OFFICIAL" &&
      /kotak\.com/.test(r.source.url),
  ),
  "Kotak: all rows OFFICIAL, bankId=kotak, kotak.com source URL",
);
const kotak1y = kotakFd.filter((r) => r.tenure.minDays === 365);
const kotak1yGen = kotak1y.find((r) => r.customer === "GENERAL");
const kotak1ySr = kotak1y.find((r) => r.customer === "SENIOR");
assert(kotak1yGen?.ratePercent === 6.35, "Kotak 1yr general = 6.35 (retail <3cr)");
assert(
  kotak1ySr?.ratePercent === 6.85,
  "Kotak 1yr senior = 6.85 (senior <3cr col, NOT the 6.35 3-5cr col)",
);
const kotak2y = kotakFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 730,
);
assert(
  kotak2y?.ratePercent === 7.3,
  "Kotak 2-3yr senior = 7.30 (senior retail col, not 6.80)",
);
assert(
  kotak.parseFdRd("<html>garbage</html>", "2026-01-01").length === 0,
  "Kotak: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// IndusInd Bank: JS-rendered page; once rendered the first table is the retail
// "< 3 Cr* DOMESTIC (RESIDENT)" grid of (Tenure, Rate [general], Rate [senior]).
// Compound tenures ("1 Year to below 1 Year 6 Month", "Above 3 Years up to
// below 61 Months", "61 Months and above"). Source: indusind.bank.in.
// ---------------------------------------------------------------------------
console.log("== IndusInd (rendered retail <3cr table, compound tenures) ==");
const INDUSIND_FD_FIXTURE = `
<html><body>
  <table>
    <tr><td></td><td>&lt; 3 Cr* DOMESTIC (RESIDENT) NRE/NRO deposits</td><td>&lt; 3 Cr* (Senior Citizen)</td></tr>
    <tr><td>Tenure</td><td>Rate</td><td>Rate</td></tr>
    <tr><td>7 days to 30 days</td><td>3.25</td><td>3.75</td></tr>
    <tr><td>270 days to 364 days</td><td>6.25</td><td>6.75</td></tr>
    <tr><td>1 Year to below 1 Year 6 Month</td><td>6.75</td><td>7.25</td></tr>
    <tr><td>2 Years to 3 Years</td><td>7.00</td><td>7.75</td></tr>
    <tr><td>Above 3 Years up to below 61 Months</td><td>6.65</td><td>7.15</td></tr>
    <tr><td>61 Months and above</td><td>6.50</td><td>7.00</td></tr>
  </table>
</body></html>`;
const indusind = new IndusindAdapter();
const indusindRows = indusind.parseFdRd(INDUSIND_FD_FIXTURE, "2026-09-01");
const indusindFd = indusindRows.filter((r) => r.product === "FD");
assert(indusindFd.length >= 12, `IndusInd: >=12 FD rows (got ${indusindFd.length})`);
assert(
  indusindRows.every(
    (r) =>
      r.bankId === "indusind" &&
      r.source.quality === "OFFICIAL" &&
      /indusind(\.com|\.bank\.in)/.test(r.source.url),
  ),
  "IndusInd: all rows OFFICIAL, bankId=indusind, official-domain source URL",
);
const indusind2y = indusindFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 730,
);
assert(indusind2y?.ratePercent === 7.0, "IndusInd 2-3yr general = 7.00");
const indusind2ySr = indusindFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 730,
);
assert(indusind2ySr?.ratePercent === 7.75, "IndusInd 2-3yr senior = 7.75");
const indusind61m = indusindFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 1830,
);
assert(
  indusind61m?.ratePercent === 6.5 && indusind61m?.tenure.maxDays === null,
  "IndusInd '61 Months and above' general = 6.50, open-ended upper bound",
);
assert(
  indusindFd.every((r) => r.tenure.maxDays == null || r.tenure.maxDays >= r.tenure.minDays),
  "IndusInd: no inverted tenure ranges",
);
assert(
  indusind.parseFdRd("<html>no data</html>", "2026-01-01").length === 0,
  "IndusInd: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// IDFC First Bank: clean server-rendered (Tenure, General %, Senior %) retail
// table. En-dash separators, plus two "+1 day" compound long buckets
// ("3 years 1 day – 5 years", "5 years 1 day – 10 years") which must be
// recovered (not dropped). The dash arrives as a numeric HTML entity in raw
// server HTML, so the resolver must decode it. Source: idfcfirstbank.com.
// ---------------------------------------------------------------------------
console.log("== IDFC First (en-dash + '+1 day' compound long buckets) ==");
const IDFC_FD_FIXTURE = `
<html><body>
  <table>
    <tr><td>Interest Rates for Domestic / NRO / NRE Fixed Deposits of less than 3 Cr</td></tr>
    <tr><td>Tenure</td><td>Rate of Interest (per annum)</td></tr>
    <tr><td>General</td><td>Senior Citizen</td></tr>
    <tr><td>7 days &#8211; 29 days</td><td>3.25%</td><td>3.50%</td></tr>
    <tr><td>181 days &#8211; less than 1 Year</td><td>6.50%</td><td>6.75%</td></tr>
    <tr><td>371 days &#8211; 499 days</td><td>7.00%</td><td>7.25%</td></tr>
    <tr><td>500 days &#8211; 3 years</td><td>7.10%</td><td>7.35%</td></tr>
    <tr><td>3 years 1 day &#8211; 5 years</td><td>6.75%</td><td>7.00%</td></tr>
    <tr><td>5 years 1 day &#8211; 10 years</td><td>6.00%</td><td>6.25%</td></tr>
  </table>
</body></html>`;
const idfc = new IdfcfirstAdapter();
const idfcRows = idfc.parseFdRd(IDFC_FD_FIXTURE, "2026-09-01");
const idfcFd = idfcRows.filter((r) => r.product === "FD");
assert(idfcFd.length >= 10, `IDFC First: >=10 FD rows (got ${idfcFd.length})`);
assert(
  idfcRows.every(
    (r) =>
      r.bankId === "idfcfirst" &&
      r.source.quality === "OFFICIAL" &&
      /idfcfirstbank\.com/.test(r.source.url),
  ),
  "IDFC First: all rows OFFICIAL, bankId=idfcfirst, idfcfirstbank.com source URL",
);
const idfc500 = idfcFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 500,
);
assert(
  idfc500?.ratePercent === 7.1 && idfc500?.tenure.maxDays === 1095,
  "IDFC First '500 days – 3 years' general = 7.10, maxDays 1095",
);
const idfc5y = idfcFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 1826,
);
assert(
  idfc5y?.ratePercent === 6.0 && idfc5y?.tenure.maxDays === 3650,
  "IDFC First compound '5 years 1 day – 10 years' general = 6.00 (entity-dash decoded, recovered)",
);
const idfc3y = idfcFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 1096,
);
assert(idfc3y?.ratePercent === 7.0, "IDFC First '3 years 1 day – 5 years' senior = 7.00");
assert(
  idfc.parseFdRd("<html>nothing</html>", "2026-01-01").length === 0,
  "IDFC First: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// Federal Bank: plain server-rendered retail (Single Deposit Less than
// ₹300 Lakhs = below ₹3 crore) (Period, General Public %, Senior Citizen %)
// table — the FIRST rate table on the deposit-rate page. Standard tenure
// labels. Source: federalbank.co.in.
// ---------------------------------------------------------------------------
console.log("== Federal Bank (standard retail table) ==");
const FEDERAL_FD_FIXTURE = `
<html><body>
  <p>Deposit Rates w.e.f. 01 Sep 2026</p>
  <table>
    <tr><td>Period</td><td>Single Deposit Less than ₹300 Lakhs - General Public</td><td>Single Deposit Less than ₹300 Lakhs - Senior Citizen</td></tr>
    <tr><td>7 days to 29 days</td><td>3.00%</td><td>3.50%</td></tr>
    <tr><td>271 days to less than 1 year</td><td>6.00%</td><td>6.50%</td></tr>
    <tr><td>1 year</td><td>6.25%</td><td>6.75%</td></tr>
    <tr><td>15 Months</td><td>6.65%</td><td>7.15%</td></tr>
    <tr><td>Above 24 months to less than 48 months</td><td>6.50%</td><td>7.00%</td></tr>
    <tr><td>48 months</td><td>6.70%</td><td>7.20%</td></tr>
    <tr><td>Above 48 months to 10 years</td><td>6.40%</td><td>6.90%</td></tr>
  </table>
</body></html>`;
const federal = new FederalAdapter();
const federalRows = federal.parseFdRd(FEDERAL_FD_FIXTURE, "2026-09-01");
const federalFd = federalRows.filter((r) => r.product === "FD");
assert(federalFd.length >= 12, `Federal: >=12 FD rows (got ${federalFd.length})`);
assert(
  federalRows.every(
    (r) =>
      r.bankId === "federal" &&
      r.source.quality === "OFFICIAL" &&
      /federalbank\.co\.in/.test(r.source.url),
  ),
  "Federal: all rows OFFICIAL, bankId=federal, federalbank.co.in source URL",
);
const federal1y = federalFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 365 && r.tenure.maxDays === 365,
);
assert(federal1y?.ratePercent === 6.25, "Federal 1yr general = 6.25");
const federal48 = federalFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 1440 && r.tenure.maxDays === 1440,
);
assert(federal48?.ratePercent === 7.2, "Federal 48 months senior = 7.20");
// Federal derives RD for >=1yr buckets, tagged OFFICIAL from its official domain.
const federalRd = federalRows.filter((r) => r.product === "RD");
assert(
  federalRd.length > 0 &&
    federalRd.every(
      (r) => r.source.quality === "OFFICIAL" && r.tenure.minDays >= 365,
    ),
  "Federal: RD derived for >=1yr buckets, OFFICIAL",
);
assert(
  federal.parseFdRd("<html>empty</html>", "2026-01-01").length === 0,
  "Federal: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// ICICI Bank: the FD page hydrates its full retail ladder from a client-side
// global `window.interestData` (only two "featured" tail rows are ever emitted
// into the DOM <table>). The render helper serializes that global into an inert
// <script id="__rate_globals__" type="application/json"> block appended to the
// page HTML; the ICICI adapter reads it back and parses interestData[0] — the
// retail (< ₹3 crore) Domestic ladder — where each row is
//   { tenure, c1 (GENERAL <3cr), c2 (SENIOR <3cr), c3/c4 (₹3cr–5cr BULK) }.
// The fixture reproduces the REAL captured shape: array[0] is retail, and a
// SECOND array carries DIFFERENT (NRE-style) numbers so that latching onto the
// wrong table would fail the assertions. Sentinels: senior must be c2 (7.10 for
// 3Y1D–5Y), NOT c1 (6.50) and NOT the bulk c3/c4; the Tax Saver row is skipped.
// ---------------------------------------------------------------------------
console.log("== ICICI (client-hydrated window.interestData, retail table[0]) ==");
const ICICI_INTEREST_DATA = [
  // interestData[0] — retail (< ₹3 crore) Domestic FD ladder (c1=gen, c2=sr).
  [
    { tenure: "7 to 45 Days", c1: 2.75, c2: 3.25, c3: 1.1, c4: 1.1 },
    { tenure: "46 to 90 Days", c1: 4, c2: 4.5, c3: 1.1, c4: 1.1 },
    { tenure: "91 to 184 Days", c1: 4.5, c2: 5, c3: 1.1, c4: 1.1 },
    { tenure: "185 to < 1 Year", c1: 5.5, c2: 6, c3: 1.1, c4: 1.1 },
    { tenure: "1 Year to < 18 Months", c1: 6.25, c2: 6.75, c3: 1.1, c4: 1.1 },
    { tenure: "18 Months to 2 Years", c1: 6.3, c2: 6.8, c3: 1.1, c4: 1.1 },
    { tenure: "2 Years 1 Day to 3 Years", c1: 6.45, c2: 6.95, c3: 1.1, c4: 1.1 },
    { tenure: "3 Years 1 Day to 5 Years", c1: 6.5, c2: 7.1, c3: 1.1, c4: 1.1 },
    { tenure: "5 Years 1 Day to 10 Years", c1: 6.5, c2: 7, c3: 1.1, c4: 1.1 },
    { tenure: "5Y (Tax Saver FD)", c1: 6.5, c2: 7.1, c3: 1.1, c4: 1.1 },
  ],
  // interestData[1] — a DIFFERENT (NRE-style) table: distinct numbers so that
  // wrongly parsing table[1] instead of table[0] would break the assertions.
  [
    { tenure: "1 Year to 389 Days", c1: 6.25, c2: 6.75, c3: 6.6, c4: 6.6 },
    { tenure: "18 Months to 2 Years", c1: 6.3, c2: 6.8, c3: 6.6, c4: 6.6 },
    { tenure: "2 Years 1 Day to 3 Years", c1: 6.45, c2: 6.95, c3: 6.6, c4: 6.6 },
    { tenure: "3 Years 1 Day to 5 Years", c1: 6.5, c2: 7.1, c3: 6.6, c4: 6.6 },
  ],
];
const ICICI_FIXTURE = `
<html><body>
  <p>ICICI Bank FD Interest Rates</p>
  <table>
    <tr><td>Tenure</td><td>General citizen</td><td>Senior citizen</td></tr>
    <tr><td></td><td>Less than 3Cr</td><td>3Cr to less than 5Cr</td><td>Less than 3Cr</td><td>3Cr to less than 5Cr</td></tr>
    <tr><td>3 Years 1 Day to 5 Years</td><td>6.5%</td><td>6.5%</td><td>7.1%</td><td>7.1%</td></tr>
    <tr><td>5 Years 1 Day to 10 Years</td><td>6.5%</td><td>6.5%</td><td>7%</td><td>7%</td></tr>
  </table>
  <script id="__rate_globals__" type="application/json">${JSON.stringify({ interestData: ICICI_INTEREST_DATA })}</script>
</body></html>`;
const icici = new IciciAdapter();
const iciciRows = icici.parseFdRd(ICICI_FIXTURE, "2026-09-01");
const iciciFd = iciciRows.filter((r) => r.product === "FD");
assert(iciciFd.length >= 16, `ICICI: >=16 FD rows (got ${iciciFd.length})`);
assert(
  iciciRows.every(
    (r) =>
      r.bankId === "icici" &&
      r.source.quality === "OFFICIAL" &&
      /icicibank\.com/.test(r.source.url),
  ),
  "ICICI: all rows OFFICIAL, bankId=icici, icicibank.com source URL",
);
// 1 Year (365-day) GENERAL bucket at the retail c1 rate.
const icici1y = iciciFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 365,
);
assert(icici1y?.ratePercent === 6.25, "ICICI 1yr general = 6.25 (retail c1)");
const icici1ySr = iciciFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 365,
);
assert(icici1ySr?.ratePercent === 6.75, "ICICI 1yr senior = 6.75 (retail c2)");
// Column-tiering sentinel: 3Y1D–5Y senior must be c2 (7.10), NOT c1 (6.50) and
// NOT a bulk (₹3cr–5cr) column. This fails if c1/c2 mapping is reverted.
const icici3y = iciciFd.filter((r) => r.tenure.minDays === 1096);
const icici3yGen = icici3y.find((r) => r.customer === "GENERAL");
const icici3ySr = icici3y.find((r) => r.customer === "SENIOR");
assert(icici3yGen?.ratePercent === 6.5, "ICICI 3Y1D–5Y general = 6.50 (c1)");
assert(
  icici3ySr?.ratePercent === 7.1,
  "ICICI 3Y1D–5Y senior = 7.10 (retail c2, NOT the 6.50 c1 nor a bulk col)",
);
// >=4 distinct FD tenures parse (full ladder recovered from the global).
const iciciTenures = new Set(
  iciciFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(
  iciciTenures.size >= 4,
  `ICICI: >=4 distinct FD tenures (got ${iciciTenures.size})`,
);
// A short-tenure bucket proves the FULL ladder (not just the 2 rendered tail
// rows) was parsed.
const iciciShort = iciciFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 7,
);
assert(
  iciciShort?.ratePercent === 2.75,
  "ICICI 7–45 day GENERAL bucket parses at 2.75 (full ladder from global)",
);
// Tax Saver FD product row is skipped (distinct 5Y lock-in product).
assert(
  !iciciFd.some((r) => /tax\s*saver/i.test(r.scheme || "")),
  "ICICI: Tax Saver FD row excluded from the standard ladder",
);
// A page WITHOUT the global (or garbage) yields 0 rows -> last-known-good.
assert(
  icici.parseFdRd("<html><body>only two rendered rows, no global</body></html>", "2026-01-01").length === 0,
  "ICICI: HTML without window.interestData global -> 0 rows",
);
assert(
  icici.parseFdRd("<html>garbage</html>", "2026-01-01").length === 0,
  "ICICI: garbage HTML -> 0 rows",
);

// ===========================================================================
// SMALL FINANCE BANK ADAPTERS
// ===========================================================================

// ---------------------------------------------------------------------------
// Capital Small Finance Bank: the retail callable-domestic-term-deposit page
// publishes GENERAL and SENIOR rates in TWO SEPARATE plain 2-column tables
// (NOT one combined general/senior grid):
//   TABLE[0] = GENERAL public: rows of [tenure, rate%]
//   TABLE[1] = SENIOR citizen: rows of [tenure, rate%]
// The bespoke parser reads table[0] as GENERAL and table[1] as SENIOR and joins
// by tenure. Sentinels below FAIL if the two tables were swapped (senior would
// come out lower than general) or if only one table were read (no SENIOR rows).
// Both tables include a "Special category" sub-header then single-tenure
// specials (12 Months / 400 / 600 / 900 Days). Source: capital.bank.in.
// ---------------------------------------------------------------------------
console.log("== Capital SFB (two separate general/senior tables) ==");
const CAPITAL_FD_FIXTURE = `
<html><body>
  <p>Callable Domestic Term Deposit — Interest Rates w.e.f. 01 Sep 2026</p>
  <h3>General Public</h3>
  <table>
    <tr><th>Period</th><th>Rate of Interest (% p.a.)</th></tr>
    <tr><td>15 Days to 30 Days</td><td>3.50%</td></tr>
    <tr><td>91 Days to 180 Days</td><td>5.00%</td></tr>
    <tr><td>1 Year to less than 2 Years</td><td>7.00%</td></tr>
    <tr><td>2 Years to less than 3 Years</td><td>6.75%</td></tr>
    <tr><td>5 Years and upto 10 Years</td><td>6.50%</td></tr>
    <tr><td>Special category</td></tr>
    <tr><td>400 Days</td><td>7.10%</td></tr>
    <tr><td>600 Days</td><td>7.25%</td></tr>
    <tr><td>900 Days</td><td>7.25%</td></tr>
  </table>
  <h3>Senior Citizen</h3>
  <table>
    <tr><th>Period</th><th>Rate of Interest (% p.a.)</th></tr>
    <tr><td>15 Days to 30 Days</td><td>4.00%</td></tr>
    <tr><td>91 Days to 180 Days</td><td>5.50%</td></tr>
    <tr><td>1 Year to less than 2 Years</td><td>7.50%</td></tr>
    <tr><td>2 Years to less than 3 Years</td><td>7.25%</td></tr>
    <tr><td>5 Years and upto 10 Years</td><td>7.00%</td></tr>
    <tr><td>Special category</td></tr>
    <tr><td>400 Days</td><td>7.60%</td></tr>
    <tr><td>600 Days</td><td>7.75%</td></tr>
    <tr><td>900 Days</td><td>7.75%</td></tr>
  </table>
</body></html>`;
const capital = new CapitalsfbAdapter();
const capitalRows = capital.parseFdRd(CAPITAL_FD_FIXTURE, "2026-09-01");
const capitalFd = capitalRows.filter((r) => r.product === "FD");
assert(capitalFd.length >= 12, `Capital SFB: >=12 FD rows (got ${capitalFd.length})`);
assert(
  capitalRows.every(
    (r) =>
      r.bankId === "capitalsfb" &&
      r.source.quality === "OFFICIAL" &&
      /capital\.bank\.in/.test(r.source.url),
  ),
  "Capital SFB: all rows OFFICIAL, bankId=capitalsfb, capital.bank.in source URL",
);
// >=4 distinct FD tenures spanning short and long.
const capitalTenures = new Set(
  capitalFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(
  capitalTenures.size >= 4,
  `Capital SFB: >=4 distinct FD tenures (got ${capitalTenures.size})`,
);
const capitalMin = capitalFd.map((r) => r.tenure.minDays);
assert(capitalMin.some((d) => d <= 30), "Capital SFB: short (<=30d) bucket present");
assert(capitalMin.some((d) => d >= 1825), "Capital SFB: long (>=5yr) bucket present");
// Column-tiering sentinels: GENERAL from table[0], SENIOR from table[1] joined
// by tenure. 1yr general=7.00, senior=7.50 (senior MUST be higher; fails if the
// two tables were swapped or only one was read).
const capital1y = capitalFd.filter(
  (r) => r.tenure.minDays === 365 && r.tenure.maxDays === 729,
);
const capital1yGen = capital1y.find((r) => r.customer === "GENERAL");
const capital1ySr = capital1y.find((r) => r.customer === "SENIOR");
assert(capital1yGen?.ratePercent === 7.0, "Capital SFB 1-2yr general = 7.00 (table[0])");
assert(
  capital1ySr?.ratePercent === 7.5,
  "Capital SFB 1-2yr senior = 7.50 (table[1], higher than general; fails if tables swapped)",
);
// Single-tenure special (400 Days) is FD-only, tagged with a scheme, no RD.
const capital400 = capitalFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 400,
);
assert(
  capital400?.tenure.maxDays === 400 && capital400?.ratePercent === 7.1,
  "Capital SFB 400 Days special general = 7.10 (single-day tenure)",
);
assert(
  capital400?.scheme === "Capital 400 Days Deposit",
  "Capital SFB 400 Days tagged with a scheme",
);
const capital400Sr = capitalFd.find(
  (r) => r.customer === "SENIOR" && r.tenure.minDays === 400,
);
assert(capital400Sr?.ratePercent === 7.6, "Capital SFB 400 Days senior = 7.60");
const capitalRd = capitalRows.filter((r) => r.product === "RD");
assert(
  !capitalRd.some((r) => r.tenure.minDays === 400),
  "Capital SFB: 400 Days special (odd day-count) NOT emitted as RD",
);
assert(
  capitalRd.length > 0 && capitalRd.every((r) => r.tenure.minDays >= 365),
  "Capital SFB: RD derived for >=1yr buckets",
);
assert(
  capital.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "Capital SFB: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// Shivalik Small Finance Bank: the interest-rate page carries ~10 tables. The
// RETAIL FD table is the clean 3-column (Tenure, General, Senior) grid headed
// "Amount less than Rs.2 Crores". Alongside it sit higher-amount slab tables
// (Rs.25 Lakh.../Rs.2 Crore and above / Rs.7 Crore) and a savings table (which
// also carries a 7.00% top slab) that must NOT be selected. The bespoke picker
// PINS the "< Rs.2 Crores" retail table by signature. Sentinels FAIL if a bulk
// slab or the savings table were picked. Source: shivalik.bank.in.
// ---------------------------------------------------------------------------
console.log("== Shivalik SFB (pin retail <Rs.2 Crore table among many) ==");
// NOTE: the slab labels ("less than Rs.2 Crores", "Rs.2 Crore and above",
// "Savings") are section HEADINGS ABOVE each table (the real page's shape), NOT
// text inside the <table> markup — so a signature test that only sees the
// <table> element is blind to them. CRUCIALLY the BULK table is placed BEFORE
// the retail "< Rs.2 Crores" table in DOM order: the adapter must STILL select
// retail by heading signature, not by DOM order. This fixture FAILS the old
// signature logic (which fell back to DOM order and would pick bulk) and PASSES
// once the pin reads the preceding heading context.
const SHIVALIK_FD_FIXTURE = `
<html><body>
  <h3>Savings Account Interest Rates</h3>
  <table>
    <tr><th>Balance Slab</th><th>Rate (% p.a.)</th></tr>
    <tr><td>Up to Rs.1 Lakh</td><td>2.50%</td></tr>
    <tr><td>Above Rs.5 Lakh</td><td>3.25%</td></tr>
    <tr><td>Above Rs.25 Lakh</td><td>7.00%</td></tr>
  </table>
  <h3>Fixed Deposit — Rs.2 Crore and above (Bulk)</h3>
  <table>
    <tr><th>Tenure Bucket</th><th>General</th><th>Senior Citizen</th></tr>
    <tr><td>7 days to 14 days</td><td>5.00%</td><td>5.25%</td></tr>
    <tr><td>181 days to 364 days</td><td>7.00%</td><td>7.25%</td></tr>
    <tr><td>1 year to less than 18 months</td><td>7.75%</td><td>8.00%</td></tr>
    <tr><td>18 months to 23 months</td><td>8.00%</td><td>8.25%</td></tr>
    <tr><td>23 months 1 day to 27 months</td><td>8.50%</td><td>8.75%</td></tr>
    <tr><td>36 months 1 day to 60 months</td><td>6.75%</td><td>7.00%</td></tr>
  </table>
  <h3>Fixed Deposit — Amount less than Rs.2 Crores</h3>
  <table>
    <tr><th>Tenure Bucket</th><th>General</th><th>Senior Citizen</th></tr>
    <tr><td>7 days to 14 days</td><td>3.50%</td><td>3.75%</td></tr>
    <tr><td>181 days to 364 days</td><td>6.50%</td><td>6.75%</td></tr>
    <tr><td>1 year to less than 18 months</td><td>7.25%</td><td>7.50%</td></tr>
    <tr><td>18 months to 23 months</td><td>7.50%</td><td>7.75%</td></tr>
    <tr><td>23 months 1 day to 27 months</td><td>8.00%</td><td>8.25%</td></tr>
    <tr><td>36 months 1 day to 60 months</td><td>6.25%</td><td>6.50%</td></tr>
    <tr><td>60 months 1 day to 120 months</td><td>6.25%</td><td>6.50%</td></tr>
  </table>
</body></html>`;
const shivalik = new ShivalikAdapter();
const shivalikRows = shivalik.parseFdRd(SHIVALIK_FD_FIXTURE, "2026-09-01");
const shivalikFd = shivalikRows.filter((r) => r.product === "FD");
assert(shivalikFd.length >= 12, `Shivalik SFB: >=12 FD rows (got ${shivalikFd.length})`);
assert(
  shivalikRows.every(
    (r) =>
      r.bankId === "shivalik" &&
      r.source.quality === "OFFICIAL" &&
      /shivalik\.bank\.in/.test(r.source.url),
  ),
  "Shivalik SFB: all rows OFFICIAL, bankId=shivalik, shivalik.bank.in source URL",
);
const shivalikTenures = new Set(
  shivalikFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(
  shivalikTenures.size >= 4,
  `Shivalik SFB: >=4 distinct FD tenures (got ${shivalikTenures.size})`,
);
// Table-pinning sentinel: the bulk table is placed BEFORE retail in DOM order,
// so this only passes if the pin selects retail by HEADING signature, not by
// order. The short 7-14 day bucket must be 3.50 retail (bulk is 5.00), and the
// peak 23m1d-27m must be 8.00/8.25 retail (bulk is 8.50/8.75). If the bulk
// table were picked, these fail.
const shivalikShort = shivalikFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 7 && r.tenure.maxDays === 14,
);
assert(
  shivalikShort?.ratePercent === 3.5,
  "Shivalik SFB 7-14d general = 3.50 (retail <Rs.2cr table, NOT bulk 5.00)",
);
const shivalikPeak = shivalikFd.filter(
  (r) => r.tenure.minDays === 691 && r.tenure.maxDays === 810,
);
const shivalikPeakGen = shivalikPeak.find((r) => r.customer === "GENERAL");
const shivalikPeakSr = shivalikPeak.find((r) => r.customer === "SENIOR");
assert(
  shivalikPeakGen?.ratePercent === 8.0,
  "Shivalik SFB 23m1d-27m general = 8.00 (retail)",
);
assert(
  shivalikPeakSr?.ratePercent === 8.25,
  "Shivalik SFB 23m1d-27m senior = 8.25 (senior col, not general; fails if cols swapped)",
);
// 1yr bucket: general 7.25 < senior 7.50 (correct column order).
const shivalik1y = shivalikFd.filter((r) => r.tenure.minDays === 365);
const shivalik1yGen = shivalik1y.find((r) => r.customer === "GENERAL");
const shivalik1ySr = shivalik1y.find((r) => r.customer === "SENIOR");
assert(shivalik1yGen?.ratePercent === 7.25, "Shivalik SFB 1yr general = 7.25 (retail)");
assert(shivalik1ySr?.ratePercent === 7.5, "Shivalik SFB 1yr senior = 7.50 (retail)");
// Savings 7.00% top slab must never appear as an FD rate.
assert(
  !shivalikFd.some((r) => r.ratePercent === 7.0 && r.tenure.minDays < 365),
  "Shivalik SFB: savings 7.00% slab not mistaken for a short FD rate",
);
assert(
  shivalik.parseFdRd("<html>no rate tables</html>", "2026-01-01").length === 0,
  "Shivalik SFB: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// RBL Bank: the interest-rates page is client-rendered and carries multiple
// tables. table[0] = savings balance-slab; table[1] = the retail FD grid headed
// "Deposits below INR 3 crore". The retail grid interleaves Effective
// Annualised Yield columns between the rate columns and carries a super-senior
// column, so the correct RETAIL columns are generalCol=1 and seniorCol=3 (cols
// 2/4/6 are yields, col 5 super-senior). Cells can carry a "% Highest" suffix.
// The fixture places the savings + a bulk (>= INR 3 crore) table around the
// retail grid so the pin + column mapping is exercised. Sentinels FAIL if a
// yield / super-senior / bulk / savings column were picked, or if general and
// senior were swapped. Source: rblbank.com.
// ---------------------------------------------------------------------------
console.log("== RBL (pin retail below-3cr grid; general=1 senior=3, skip yields) ==");
const RBL_FD_FIXTURE = `
<html><body>
  <h3>Savings Account Interest Rates</h3>
  <table>
    <tr><th>Balance Slab</th><th>Rate (% p.a.)</th></tr>
    <tr><td>Up to Rs.1 lakh</td><td>3.00%</td></tr>
    <tr><td>Above Rs.25 lakh</td><td>5.50%</td></tr>
    <tr><td>Above Rs.5 crore</td><td>6.75%</td></tr>
  </table>
  <h3>Fixed Deposits INR 3 crore & above (Bulk)</h3>
  <table>
    <tr>
      <th>Period of Deposit</th><th>Interest Rates (per annum)</th>
      <th>Effective Annualised Yield</th><th>Senior Citizen Interest Rates (per annum)</th>
      <th>Effective Annualised Yield</th>
    </tr>
    <tr><td>7 days to 14 days</td><td>4.50%</td><td>4.55%</td><td>4.50%</td><td>4.55%</td></tr>
    <tr><td>365 days to 500 days</td><td>8.00%</td><td>8.24%</td><td>8.00%</td><td>8.24%</td></tr>
    <tr><td>18 months to 36 months</td><td>8.10%</td><td>8.35%</td><td>8.10%</td><td>8.35%</td></tr>
    <tr><td>36 months to 60 months</td><td>7.90%</td><td>8.10%</td><td>7.90%</td><td>8.10%</td></tr>
  </table>
  <h3>Fixed Deposits below INR 3 crore</h3>
  <table>
    <tr>
      <th>Period of Deposit</th>
      <th>Interest Rates (per annum)</th>
      <th>Effective Annualised Yield</th>
      <th>Senior Citizen Interest Rates (per annum)</th>
      <th>Effective Annualised Yield</th>
      <th>Super Senior Citizen Interest Rates (per annum)</th>
      <th>Effective Annualised Yield</th>
    </tr>
    <tr><td>7 days to 14 days</td><td>3.50%</td><td>3.55%</td><td>4.00%</td><td>4.06%</td><td>4.25%</td><td>4.31%</td></tr>
    <tr><td>181 days to 240 days</td><td>6.05%</td><td>6.19%</td><td>6.55%</td><td>6.71%</td><td>6.80%</td><td>6.98%</td></tr>
    <tr><td>365 days to 500 days</td><td>7.00%</td><td>7.19%</td><td>7.50%</td><td>7.71%</td><td>7.75%</td><td>7.98%</td></tr>
    <tr><td>18 months to 36 months</td><td>7.20% Highest</td><td>7.40%</td><td>7.70% Highest</td><td>7.92%</td><td>7.95%</td><td>8.18%</td></tr>
    <tr><td>36 months to 60 months</td><td>6.95%</td><td>7.13%</td><td>7.45%</td><td>7.66%</td><td>7.70%</td><td>7.92%</td></tr>
  </table>
</body></html>`;
const rbl = new RblAdapter();
const rblRows = rbl.parseFdRd(RBL_FD_FIXTURE, "2026-09-10");
const rblFd = rblRows.filter((r) => r.product === "FD");
assert(rblFd.length >= 8, `RBL: >=8 FD rows (got ${rblFd.length})`);
assert(
  rblRows.every(
    (r) =>
      r.bankId === "rbl" &&
      r.source.quality === "OFFICIAL" &&
      /rblbank\.com/.test(r.source.url),
  ),
  "RBL: all rows OFFICIAL, bankId=rbl, rblbank.com source URL",
);
const rblTenures = new Set(
  rblFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(rblTenures.size >= 4, `RBL: >=4 distinct FD tenures (got ${rblTenures.size})`);
// 1yr bucket (365 days to 500 days): retail general = 7.00 (NOT the bulk 8.00,
// NOT the yield 7.19). Senior = 7.50 (senior col 3, NOT super-senior 7.75, NOT
// the yield 7.71). Fails if columns are swapped or a yield/bulk col is picked.
const rbl1y = rblFd.filter((r) => r.tenure.minDays === 365 && r.tenure.maxDays === 500);
const rbl1yGen = rbl1y.find((r) => r.customer === "GENERAL");
const rbl1ySr = rbl1y.find((r) => r.customer === "SENIOR");
assert(rbl1yGen?.ratePercent === 7.0, "RBL 365-500d general = 7.00 (retail, not bulk 8.00, not yield)");
assert(
  rbl1ySr?.ratePercent === 7.5,
  "RBL 365-500d senior = 7.50 (senior col 3, not super-senior 7.75, not yield; fails if cols swapped)",
);
// Suffix tolerance: "7.20% Highest" -> 7.20 general, "7.70% Highest" -> 7.70 senior.
const rblPeak = rblFd.filter((r) => r.tenure.minDays === 540 && r.tenure.maxDays === 1080);
const rblPeakGen = rblPeak.find((r) => r.customer === "GENERAL");
const rblPeakSr = rblPeak.find((r) => r.customer === "SENIOR");
assert(rblPeakGen?.ratePercent === 7.2, "RBL 18-36m general = 7.20 (parsePercent tolerates '% Highest')");
assert(rblPeakSr?.ratePercent === 7.7, "RBL 18-36m senior = 7.70 (senior col, suffix tolerated)");
// No yield / super-senior value should ever surface as a published rate.
assert(
  !rblFd.some((r) => [3.55, 7.19, 7.71, 7.75, 7.98, 8.0].includes(r.ratePercent)),
  "RBL: no yield / super-senior / bulk value published as a retail rate",
);
// RD derived for the >=1yr bucket.
assert(
  rblRows.some((r) => r.product === "RD" && r.tenure.minDays === 365),
  "RBL: RD derived for >=1yr bucket",
);
assert(
  rbl.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "RBL: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// City Union Bank: the deposit-interest-rate page is client-rendered with ~19
// tables. The retail FD table titled "Domestic/NRO Callable Term Deposit" has
// TWO stacked header rows (Period | Rate of Interest %; then General | Senior |
// Super Senior) and data rows <tenure> | <general%> | <senior%> | <super%>.
// Columns: generalCol=1, seniorCol=2 (super-senior col 3 ignored). The fixture
// surrounds the retail table with savings + NRE tables so the pin is exercised.
// Sentinels FAIL if the super-senior column is published as senior, if general
// and senior are swapped, or if the savings/NRE table were picked. Source:
// cityunionbank.com.
// ---------------------------------------------------------------------------
console.log("== City Union (pin callable-term-deposit; general=1 senior=2, skip super-senior) ==");
const CITYUNION_FD_FIXTURE = `
<html><body>
  <h3>Savings Bank Account</h3>
  <table>
    <tr><th>Balance Slab</th><th>Rate (% p.a.)</th></tr>
    <tr><td>Up to Rs.1 lakh</td><td>2.50%</td></tr>
    <tr><td>Above Rs.5 lakh</td><td>3.00%</td></tr>
  </table>
  <h3>NRE Term Deposit</h3>
  <table>
    <tr><th>Period</th><th>General</th><th>Senior Citizen</th><th>Super Senior Citizen</th></tr>
    <tr><td>365 days to 443 days</td><td>9.00%</td><td>9.25%</td><td>9.40%</td></tr>
    <tr><td>444 days</td><td>9.10%</td><td>9.35%</td><td>9.50%</td></tr>
    <tr><td>556 days to 3 years</td><td>8.50%</td><td>8.75%</td><td>8.90%</td></tr>
    <tr><td>3 years to 5 years</td><td>8.00%</td><td>8.25%</td><td>8.40%</td></tr>
  </table>
  <h3>Domestic/NRO Callable Term Deposit</h3>
  <table>
    <tr><th>Period</th><th colspan="3">Rate of Interest % p.a</th></tr>
    <tr><th></th><th>General</th><th>Senior Citizen</th><th>Super Senior Citizen</th></tr>
    <tr><td>7 days to 45 days</td><td>4.50%</td><td>4.75%</td><td>4.90%</td></tr>
    <tr><td>181 days to 364 days</td><td>6.00%</td><td>6.25%</td><td>6.40%</td></tr>
    <tr><td>365 days to 443 days</td><td>6.65%</td><td>6.90%</td><td>7.05%</td></tr>
    <tr><td>444 days</td><td>7.10%</td><td>7.35%</td><td>7.50%</td></tr>
    <tr><td>555 days</td><td>7.25%</td><td>7.50%</td><td>7.65%</td></tr>
    <tr><td>556 days to 3 years</td><td>6.50%</td><td>6.75%</td><td>6.90%</td></tr>
    <tr><td>3 years to 5 years</td><td>6.25%</td><td>6.50%</td><td>6.65%</td></tr>
  </table>
</body></html>`;
const cityunion = new CityunionAdapter();
const cuRows = cityunion.parseFdRd(CITYUNION_FD_FIXTURE, "2026-09-12");
const cuFd = cuRows.filter((r) => r.product === "FD");
assert(cuFd.length >= 10, `City Union: >=10 FD rows (got ${cuFd.length})`);
assert(
  cuRows.every(
    (r) =>
      r.bankId === "cityunion" &&
      r.source.quality === "OFFICIAL" &&
      /cityunionbank\.com/.test(r.source.url),
  ),
  "City Union: all rows OFFICIAL, bankId=cityunion, cityunionbank.com source URL",
);
const cuTenures = new Set(
  cuFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(cuTenures.size >= 4, `City Union: >=4 distinct FD tenures (got ${cuTenures.size})`);
// 1yr bucket (365 days to 443 days): retail general = 6.65 (NOT NRE 9.00),
// senior = 6.90 (senior col 2, NOT super-senior 7.05; fails if cols swapped).
const cu1y = cuFd.filter((r) => r.tenure.minDays === 365 && r.tenure.maxDays === 443);
const cu1yGen = cu1y.find((r) => r.customer === "GENERAL");
const cu1ySr = cu1y.find((r) => r.customer === "SENIOR");
assert(cu1yGen?.ratePercent === 6.65, "City Union 365-443d general = 6.65 (callable retail, not NRE 9.00)");
assert(
  cu1ySr?.ratePercent === 6.9,
  "City Union 365-443d senior = 6.90 (senior col 2, not super-senior 7.05; fails if cols swapped)",
);
// 556d to 3y bucket: general 6.50 / senior 6.75.
const cuMid = cuFd.filter((r) => r.tenure.minDays === 556 && r.tenure.maxDays === 1095);
assert(
  cuMid.find((r) => r.customer === "GENERAL")?.ratePercent === 6.5,
  "City Union 556d-3y general = 6.50 (callable retail)",
);
assert(
  cuMid.find((r) => r.customer === "SENIOR")?.ratePercent === 6.75,
  "City Union 556d-3y senior = 6.75 (senior col, not super-senior)",
);
// Specials: 444-day is tagged (odd single-day tenure), general 7.10 retail.
const cu444 = cuFd.find(
  (r) => r.customer === "GENERAL" && r.tenure.minDays === 444 && r.tenure.maxDays === 444,
);
assert(cu444?.ratePercent === 7.1 && cu444?.scheme != null, "City Union 444-day special general = 7.10 (scheme-tagged)");
// No super-senior value should surface as a published rate.
assert(
  !cuFd.some((r) => [4.9, 6.4, 7.05, 7.65, 6.65 + 0.4].includes(r.ratePercent) && r.customer === "SENIOR"),
  "City Union: super-senior column never published as senior",
);
// No NRE value should surface at all.
assert(
  !cuFd.some((r) => [9.0, 9.1, 8.5, 8.0].includes(r.ratePercent)),
  "City Union: NRE table never selected as retail FD",
);
assert(
  cuRows.some((r) => r.product === "RD" && r.tenure.minDays >= 365),
  "City Union: RD derived for >=1yr bucket",
);
assert(
  cityunion.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "City Union: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// CSB Bank: the interest-rates page is client-rendered with ~31 tables. The
// retail "DOMESTIC TERM DEPOSITS" table has a LEADING SERIAL-NUMBER column:
// Slab | Deposit Tenor | Below Rs. 3 Crore (general) | Rs 2 Crore and above
// (bulk). So tenor=cells[1], retail general=cells[2] (NOT bulk cells[3], NOT
// the serial cells[0]). This table publishes GENERAL rates only (no senior
// column), so CSB emits GENERAL-only OFFICIAL rows. The fixture includes the
// savings table + a distinct bulk column so the pin + column mapping are
// exercised. Sentinels FAIL if the bulk column, the serial column, or the
// savings table were used, or if any SENIOR row were fabricated. Source:
// csb.bank.in.
// ---------------------------------------------------------------------------
console.log("== CSB (leading serial col; retail general=cells[2], GENERAL-only) ==");
const CSB_FD_FIXTURE = `
<html><body>
  <h3>DOMESTIC SAVINGS BANK DEPOSITS</h3>
  <table>
    <tr><th>Slab</th><th>Balance</th><th>Rate of Interest p.a.</th></tr>
    <tr><td>1</td><td>Up to Rs.5 lakh</td><td>2.10%</td></tr>
    <tr><td>2</td><td>Above Rs.5 lakh</td><td>3.00%</td></tr>
  </table>
  <h3>INTEREST RATES (P.A.) ON DOMESTIC TERM DEPOSITS (W.E.F 01.09.2026)</h3>
  <table>
    <tr>
      <th>Slab</th><th>Deposit Tenor</th>
      <th>Below Rs. 3 Crore (Rate of Interest p.a.)</th>
      <th>Rs 2 Crore and above</th>
    </tr>
    <tr><td>1</td><td>7 days to 45 days</td><td>3.00%</td><td>5.75%</td></tr>
    <tr><td>2</td><td>181 days to 364 days</td><td>5.25%</td><td>6.50%</td></tr>
    <tr><td>3</td><td>365 days to 443 days</td><td>6.75%</td><td>7.10%</td></tr>
    <tr><td>4</td><td>444 days</td><td>7.25%</td><td>7.50%</td></tr>
    <tr><td>5</td><td>555 days</td><td>7.00%</td><td>7.25%</td></tr>
    <tr><td>6</td><td>1100 days</td><td>5.50%</td><td>5.75%</td></tr>
    <tr><td>7</td><td>556 days to 5 years</td><td>6.00%</td><td>6.25%</td></tr>
  </table>
</body></html>`;
const csb = new CsbAdapter();
const csbRows = csb.parseFdRd(CSB_FD_FIXTURE, "2026-09-01");
const csbFd = csbRows.filter((r) => r.product === "FD");
assert(csbFd.length >= 5, `CSB: >=5 FD rows (got ${csbFd.length})`);
assert(
  csbRows.every(
    (r) =>
      r.bankId === "csb" &&
      r.source.quality === "OFFICIAL" &&
      /csb\.bank\.in/.test(r.source.url),
  ),
  "CSB: all rows OFFICIAL, bankId=csb, csb.bank.in source URL",
);
// GENERAL-only: no SENIOR rows are emitted (senior column absent; never copied).
assert(
  csbRows.every((r) => r.customer === "GENERAL"),
  "CSB: GENERAL-only (no fabricated SENIOR rows)",
);
const csbTenures = new Set(
  csbFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(csbTenures.size >= 4, `CSB: >=4 distinct FD tenures (got ${csbTenures.size})`);
// 1yr bucket (365 days to 443 days): retail general = 6.75 (the "Below Rs.3
// Crore" col cells[2]), NOT the bulk 7.10 (cells[3]).
const csb1y = csbFd.filter((r) => r.tenure.minDays === 365 && r.tenure.maxDays === 443);
assert(
  csb1y.find((r) => r.customer === "GENERAL")?.ratePercent === 6.75,
  "CSB 365-443d general = 6.75 (Below Rs.3 Crore col, not bulk 7.10)",
);
// The bulk column values (cells[3]) must NEVER be published.
// Bulk-only values (present in the "Rs 2 Crore and above" col but NOT in the
// retail general col) must never appear. 7.25 is excluded here because it is a
// legitimate retail general rate (444-day) that also happens to be a bulk rate
// on a different row; the collision-free bulk values below are the real signal.
assert(
  !csbFd.some((r) => [5.75, 6.5, 7.1, 7.5, 6.25].includes(r.ratePercent)),
  "CSB: 'Rs 2 Crore and above' bulk column never published as retail",
);
// The serial column (cells[0]) must not be read as a tenure: no 1-day or 7-day
// bucket derived from a serial number should appear.
assert(
  !csbFd.some((r) => r.tenure.minDays === r.tenure.maxDays && r.tenure.minDays <= 7 && r.tenure.maxDays <= 7),
  "CSB: leading serial column not mistaken for a tenure",
);
// Specials: 444-day general = 7.25, scheme-tagged.
const csb444 = csbFd.find(
  (r) => r.tenure.minDays === 444 && r.tenure.maxDays === 444,
);
assert(csb444?.ratePercent === 7.25 && csb444?.scheme != null, "CSB 444-day special general = 7.25 (scheme-tagged)");
// RD derived for the >=1yr bucket.
assert(
  csbRows.some((r) => r.product === "RD" && r.tenure.minDays >= 365),
  "CSB: RD derived for >=1yr bucket",
);
assert(
  csb.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "CSB: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// Fino Payments Bank (SAVINGS-ONLY, tiered by balance slab, from PDF rate card).
// Payments banks legally cannot offer FD/RD; the adapter must emit ONLY SAVINGS
// rows, one per balance band, each with a correct AmountThreshold. The
// authoritative source is a PDF rate card whose extracted text collapses table
// cells into lines mixing a balance-band phrase with a rate. We feed the pure
// parseSavingsPdf a realistic fixture of that extracted text and assert the
// per-slab rate + amount mapping, that NO FD/RD rows are produced, and that a
// reverted/wrong parse (e.g. reading the FD-less config as an FD ladder, or
// mis-tiering a slab) would fail.
// ---------------------------------------------------------------------------
console.log("== Fino Payments Bank (savings-only, tiered from PDF) ==");
const fino = new FinoAdapter();

// Fixture modeled on Fino's REAL 1 Dec 2025 PDF rate card as extracted by
// pdf-parse (observed via a CI ingest debug run): the whole slab table lands as
// one run of text with each band phrase GLUED directly to its rate, preceded by
// footnote prose that itself mentions "Above INR 1,95,000". The parser must
// scan the whole text (not line-by-line), skip the footnote figure, and map the
// two real bands: "Up to and including Rs. 1 Lakh" = 1.50%, "Above Rs. 1 Lakh"
// = 4.50%. (1.50% is below a naive 2% floor — the parser must accept it.)
const FINO_PDF_TEXT =
  "Classification: Public Fino Payments Bank Savings Account – Change in Rate of Interest " +
  "•Eff 1 st December 2025 onwards, Interest on Balances in Fino Payment Bank Saving Account will be revised as follows : " +
  "•Interest on balance in Sweep Account with our Partner Bank Suryoday Small Finance Bank will be as per partner bank policy & norms. " +
  "ii. Balances Above INR 1,95,000 on EOD will be transferred to Customer’s Sweep Account held with Partner Bank " +
  "Balance Slab %ROI per annum Up to and including Rs. 1 Lakh1.50% Above Rs. 1 Lakh4.50%";

const finoSav = fino.parseSavingsPdf(FINO_PDF_TEXT);

// Only SAVINGS rows, correct bankId, OFFICIAL, sane band.
assert(finoSav.length > 0, "Fino: parses >=1 savings row from PDF text");
assert(
  finoSav.every(
    (r) =>
      r.product === "SAVINGS" &&
      r.bankId === "fino" &&
      r.source.quality === "OFFICIAL" &&
      r.ratePercent >= 1 &&
      r.ratePercent <= 7,
  ),
  "Fino: all rows SAVINGS + fino + OFFICIAL + sane 1..7% band",
);
// NEVER FD or RD (payments-bank hard rule).
assert(
  !finoSav.some((r) => r.product === "FD" || r.product === "RD"),
  "Fino: NO FD/RD rows produced (payments bank is savings-only)",
);
// parseFdRd / parsePdfFdRd must always yield 0 rows regardless of input.
assert(
  fino.parseFdRd("<html><table><tr><td>1 Year</td><td>6.25</td><td>6.75</td></tr></table></html>", "2026-01-01").length === 0,
  "Fino: parseFdRd always returns 0 rows (never emits FD)",
);
assert(
  fino.parsePdfFdRd("1 year to less than 2 years 6.25% 6.75%", "x").length === 0,
  "Fino: parsePdfFdRd always returns 0 rows (never emits FD)",
);

// Two balance slabs -> 2 bands x (general+senior) = 4 rows.
assert(finoSav.length === 4, `Fino: 2 slabs x 2 customers = 4 rows (got ${finoSav.length})`);
assert(
  finoSav.filter((r) => r.customer === "GENERAL").length === 2 &&
    finoSav.filter((r) => r.customer === "SENIOR").length === 2,
  "Fino: 2 GENERAL + 2 SENIOR savings rows",
);

// Per-slab AmountThreshold mapping (behavioral: fails if bands are mis-tiered).
const finoGen = finoSav.filter((r) => r.customer === "GENERAL");
const bottom = finoGen.find((r) => r.amount.minAmount === 0);
assert(
  bottom?.ratePercent === 1.5 && bottom?.amount.maxAmount === 100000,
  "Fino: [0, 1,00,000] band = 1.50%",
);
const top = finoGen.find((r) => r.amount.minAmount === 100000);
assert(
  top?.ratePercent === 4.5 && top?.amount.maxAmount === null,
  "Fino: [1,00,000, and above] band = 4.50%",
);
// The top slab rate must NOT be attached to the base band (mis-tier guard):
// a reverted parser that glued 4.50% onto the [0,1L] base band would fail here.
assert(
  bottom?.ratePercent !== 4.5 &&
    !finoGen.some((r) => r.amount.minAmount === 0 && r.ratePercent === 4.5),
  "Fino: top-slab 4.50% is never mis-tiered onto the base [0,1L] band",
);
// The footnote figure (Above INR 1,95,000) must NOT become a rate band: no row
// should carry a 195000 threshold, and only the two real rates appear.
assert(
  !finoSav.some((r) => r.amount.minAmount === 195000 || r.amount.maxAmount === 195000),
  "Fino: footnote 'Above INR 1,95,000' is not mistaken for a rate band",
);
assert(
  new Set(finoSav.map((r) => r.ratePercent)).size === 2,
  "Fino: exactly two distinct rates (1.50 / 4.50), no stray footnote-derived rate",
);

// Effective date parsed from the PDF header ("Eff 1 st December 2025").
assert(
  finoSav.every((r) => r.source.effectiveDate === "2025-12-01"),
  "Fino: effective date parsed from PDF = 2025-12-01",
);

// Single flat headline rate (no tiers) -> one all-balances band.
const FINO_FLAT_TEXT =
  "Savings Account Interest Rate. Interest rate on all savings balances 3.00% p.a.";
const finoFlat = fino.parseSavingsPdf(FINO_FLAT_TEXT);
assert(
  finoFlat.length === 2 &&
    finoFlat.every((r) => r.product === "SAVINGS" && r.ratePercent === 3.0) &&
    finoFlat.every((r) => r.amount.minAmount === 0 && r.amount.maxAmount === null),
  "Fino: single flat rate -> 2 all-balances SAVINGS rows at 3.00%",
);

// Non-rate / junk PDF text -> 0 rows (keeps last-known-good, never fabricates).
assert(
  fino.parseSavingsPdf("Terms and conditions apply. TDS as per IT Act.").length === 0,
  "Fino: non-rate PDF text -> 0 rows (no fabrication)",
);

// ---------------------------------------------------------------------------
// Deutsche Bank India (FOREIGN): the resident FD page is client-rendered and
// carries EXACTLY ONE clean retail table (19 rows = 1 header + 17 data + 1
// trailing note) headed "Tenure | Normal interest rate (% p.a.) <Rs. 3 crore |
// Senior citizen interest rate (% p.a.) <Rs. 3 crore". So generalCol=1,
// seniorCol=2. Deutsche sets senior == general on every row but DOES publish a
// distinct senior column, so both GENERAL and SENIOR rows are emitted
// (faithful, not fabricated).
//
// This fixture mirrors the REAL rendered T0 EXACTLY and reproduces the
// real-page hazards that caused the two prior live failures (a bogus 1.5%
// OFFICIAL row):
//   1. Rate cells carry BARE numbers WITHOUT a "%" sign (e.g. <td>3.00</td>).
//   2. The header cells carry a literal BARE "<Rs. 3 crore" (unescaped "<"),
//      and one data row is "> 4 Yrs - <5 Yrs" (bare "<5"). stripTags() uses
//      /<[^>]*>/ and eats from that bare "<" to the next ">", DELETING
//      "Rs. 3 crore" / "5 Yrs" from the plain-stripped text.
//   3. The <table> carries AEM class names ("cmp-savings-grid") and an
//      attribute ("data-nre") whose bare substrings "saving" / "nre" appear in
//      the RAW markup. The PRE-FIX adapter ran its decoy test against the RAW
//      table html, so "saving" (from the class) matched the decoy regex and the
//      CORRECT retail table was rejected -> 0 rows -> ingest kept the bogus
//      last-known-good row. The fixed picker tests decoys against a SAFE
//      signature text (markup removed, bare "<" neutralised so "crore"
//      survives), so class/attribute substrings can no longer cause a false
//      decoy match. This assertion FAILS against the pre-fix adapter (it
//      selected NO table -> 0 rows -> the >=8 GENERAL/SENIOR asserts fail).
//   4. A 19th trailing single-cell note row ("Rates are subject to change...")
//      carries no resolvable tenure, so it is skipped naturally (never data).
// A clearly-separate NRE decoy table is kept BEFORE T0 to prove the picker
// still rejects a genuine NRE header. Source: deutsche.bank.in.
// ---------------------------------------------------------------------------
console.log("== Deutsche Bank India (select real single-table resident <Rs.3cr grid; general=1 senior=2) ==");
const DEUTSCHE_FD_FIXTURE = `
<html><body>
  <h3>NRE Fixed Deposit interest rates</h3>
  <table class="rate-table nre-grid">
    <tr><th>Tenure</th><th>NRE interest rate (% p.a.)</th><th>Senior citizen</th></tr>
    <tr><td>271 Days - 1 Yr</td><td>9.10</td><td>9.10</td></tr>
    <tr><td>> 1 Yr - 1.5 Yrs</td><td>9.25</td><td>9.25</td></tr>
    <tr><td>> 1.5 Yrs - 2 Yrs</td><td>9.30</td><td>9.30</td></tr>
    <tr><td>> 2 Yrs - 3 Yrs</td><td>9.00</td><td>9.00</td></tr>
  </table>
  <h3>Resident Fixed Deposit interest rates</h3>
  <table class="cmp-savings-grid rate-table" data-nre="false">
    <tr>
      <th>Tenure</th>
      <th>Normal interest rate (% p.a.) <Rs. 3 crore</th>
      <th>Senior citizen interest rate (% p.a.) <Rs. 3 crore</th>
    </tr>
    <tr><td>7 Days</td><td>3.00</td><td>3.00</td></tr>
    <tr><td>8 - 14 Days</td><td>3.00</td><td>3.00</td></tr>
    <tr><td>15 - 29 Days</td><td>3.25</td><td>3.25</td></tr>
    <tr><td>30 Days</td><td>3.50</td><td>3.50</td></tr>
    <tr><td>31 - 45 Days</td><td>3.75</td><td>3.75</td></tr>
    <tr><td>46 - 59 Days</td><td>4.00</td><td>4.00</td></tr>
    <tr><td>60 - 89 Days</td><td>4.25</td><td>4.25</td></tr>
    <tr><td>90 - 99 Days</td><td>4.50</td><td>4.50</td></tr>
    <tr><td>100 Days</td><td>5.00</td><td>5.00</td></tr>
    <tr><td>101 - 180 Days</td><td>5.25</td><td>5.25</td></tr>
    <tr><td>181 - 270 Days</td><td>5.50</td><td>5.50</td></tr>
    <tr><td>271 Days - 1 Yr</td><td>6.50</td><td>6.50</td></tr>
    <tr><td>> 1 Yr - 1.5 Yrs</td><td>7.00</td><td>7.00</td></tr>
    <tr><td>> 1.5 Yrs - 2 Yrs</td><td>6.75</td><td>6.75</td></tr>
    <tr><td>> 2 Yrs - 3 Yrs</td><td>6.50</td><td>6.50</td></tr>
    <tr><td>> 3 Yrs - 4 Yrs</td><td>6.25</td><td>6.25</td></tr>
    <tr><td>> 4 Yrs - <5 Yrs</td><td>6.00</td><td>6.00</td></tr>
    <tr><td>5 Yrs</td><td>5.75</td><td>5.75</td></tr>
    <tr><td>Rates are subject to change without notice</td></tr>
  </table>
</body></html>`;
const deutsche = new DeutscheAdapter();
const deuRows = deutsche.parseFdRd(DEUTSCHE_FD_FIXTURE, "2026-09-15");
const deuFd = deuRows.filter((r) => r.product === "FD");
const deuFdGen = deuFd.filter((r) => r.customer === "GENERAL");
const deuFdSr = deuFd.filter((r) => r.customer === "SENIOR");
// The real table has 17 data tenures; selecting it yields 17 GENERAL + 17
// SENIOR FD rows. >=8 each is the regression floor and FAILS against the
// pre-fix adapter (which selected NO table -> 0 rows).
assert(deuFdGen.length >= 8, `Deutsche: >=8 GENERAL FD rows (got ${deuFdGen.length})`);
assert(deuFdSr.length >= 8, `Deutsche: >=8 SENIOR FD rows (got ${deuFdSr.length})`);
assert(
  deuRows.every(
    (r) =>
      r.bankId === "deutsche" &&
      r.source.quality === "OFFICIAL" &&
      /deutsche\.bank\.in/.test(r.source.url),
  ),
  "Deutsche: all rows OFFICIAL, bankId=deutsche, deutsche.bank.in source URL",
);
assert(
  deuFd.every((r) => r.product === "FD"),
  "Deutsche: all FD-filtered rows are product=FD",
);
const deuTenures = new Set(
  deuFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(deuTenures.size >= 4, `Deutsche: >=4 distinct FD tenures (got ${deuTenures.size})`);
// > 1 Yr - 1.5 Yrs bucket: retail general = 7.00 (resident, NOT the flat-text
// fallback's bogus 1.5 read of the "1.5 Yrs" label, NOT NRE 9.25). Senior =
// 7.00 (col 2, present and equal to general). This assertion FAILS against the
// buggy adapter (which published 1.5 / selected no table).
const deu15 = deuFd.filter((r) => r.tenure.minDays === 365 && r.tenure.maxDays === 548);
const deu15Gen = deu15.find((r) => r.customer === "GENERAL");
const deu15Sr = deu15.find((r) => r.customer === "SENIOR");
assert(deu15Gen?.ratePercent === 7.0, "Deutsche >1Yr-1.5Yrs general = 7.00 (resident, not 1.5, not NRE 9.25)");
assert(
  deu15Sr?.ratePercent === 7.0,
  "Deutsche >1Yr-1.5Yrs senior = 7.00 (col 2 present, equals general — faithful, not dropped)",
);
// 100 Days bucket general = 5.00 (the representative mid data row from the real
// page, bare-number rate cell parsed correctly).
const deu100 = deuFd.filter((r) => r.tenure.minDays === 100 && r.tenure.maxDays === 100);
assert(
  deu100.find((r) => r.customer === "GENERAL")?.ratePercent === 5.0,
  "Deutsche 100 Days general = 5.00 (bare number, no % sign)",
);
// 7 Days bucket general = 3.00 (bare-number rate cell parsed correctly).
const deu7d = deuFd.filter((r) => r.tenure.minDays === 7 && r.tenure.maxDays === 7);
assert(
  deu7d.find((r) => r.customer === "GENERAL")?.ratePercent === 3.0,
  "Deutsche 7 Days general = 3.00 (bare number, no % sign)",
);
// Both GENERAL and SENIOR rows are emitted (distinct senior column exists).
assert(
  deuFd.some((r) => r.customer === "GENERAL") && deuFd.some((r) => r.customer === "SENIOR"),
  "Deutsche: both GENERAL and SENIOR rows present (distinct senior column mapped)",
);
// "> 4 Yrs - <5 Yrs" bucket: stripTags eats the bare "<5 Yrs" from the cell so
// the label the parser sees is "> 4 Yrs -", which resolvePrivateTenure maps to
// a >4Yr point bucket (minDays 1460). The row is STILL emitted as data (rate
// 6.00), not swallowed — the point here is the bare-"<" label does not cause a
// row loss or a mis-read rate.
const deu45 = deuFd.filter((r) => r.tenure.minDays === 1460);
assert(
  deu45.find((r) => r.customer === "GENERAL")?.ratePercent === 6.0,
  "Deutsche >4Yrs bucket general = 6.00 (bare '<5' label row still emitted as data)",
);
// The 19th trailing note row must NOT produce a data row (no resolvable tenure).
const deu1p5 = deuFd.filter((r) => r.tenure.minDays === 548 && r.tenure.maxDays === 730);
assert(
  deu1p5.find((r) => r.customer === "GENERAL")?.ratePercent === 6.75,
  "Deutsche >1.5Yrs-2Yrs general = 6.75 (resident retail)",
);
// The bug's signature value 1.5 must NEVER appear (it was fabricated from the
// "1.5 Yrs" tenure label by the flat-text fallback). This is a core sentinel.
assert(
  !deuFd.some((r) => r.ratePercent === 1.5),
  "Deutsche: no row has ratePercent == 1.5 (the fabricated flat-text-fallback value)",
);
// No NRE value should ever surface as a published rate.
assert(
  !deuFd.some((r) => [9.1, 9.25, 9.3, 9.0].includes(r.ratePercent)),
  "Deutsche: NRE column never published as retail rate",
);
// The flat-text fallback is neutralised: even fed text whose tenure labels
// contain decimal "Yrs" tokens, parseTextFdRd must fabricate NOTHING. This
// guarantees a no-table scenario keeps Deutsche rate-less rather than shipping
// a bogus 1.5% row (the exact live bug).
assert(
  deutsche.parseTextFdRd(
    "Fixed Deposit\n> 1 Yr - 1.5 Yrs 7.00\n> 1.5 Yrs - 2 Yrs 7.00\n> 2 Yrs - 3 Yrs 6.25",
    "https://www.deutsche.bank.in/x",
    "2026-01-01",
  ).length === 0,
  "Deutsche: flat-text fallback neutralised (parseTextFdRd -> 0 rows, no fabrication)",
);
assert(
  deutsche.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "Deutsche: garbage HTML -> 0 rows",
);

// ---------------------------------------------------------------------------
// Deutsche Bank India — SECOND fixture: BROWSER-REPAIRED / DEGRADED HEADER.
//
// The live 0-row failure was NOT reproduced by the literal fixture above. On
// the REAL rendered page the header cell carries a bare, unescaped "<"
// ("Normal interest rate (% p.a.) <Rs. 3 crore"). The headless browser treats
// "<Rs. 3 crore</th>" as a malformed tag and DROPS that text when it
// serializes page.content(), so the header the adapter parses has LOST the
// "crore" token (and, in the extreme, the whole header row). Additionally the
// resident FD table carries a FOOTNOTE row referencing "NRE / NRO / FCNR
// deposits" / "Savings account" (pointing at other pages).
//
// The PRIOR adapter (a) required the positive header tokens
// normal-interest-rate + senior-citizen + crore to match the retail table, and
// (b) ran the decoy test against the WHOLE table text. On this degraded DOM
// the positive header match fails AND the footnote makes the whole-table decoy
// test reject the single correct table -> 0 rows -> ingest keeps the bogus
// 1.5% last-known-good row. This fixture reproduces exactly that and the
// assertions below FAIL against the prior header-token-dependent adapter
// (proven via git stash: 0 rows -> every selection/rate assert fails).
//
// The fix selects the resident table by SHAPE (most distinct tenures among
// non-decoy (tenure,%,%) grids) and computes the decoy signature from the
// heading + HEADER row ONLY (never the footnote). A clearly-separate NRE decoy
// table (its own heading + NRE column header) is kept and must NEVER be
// selected (Deutsche publishes no NRE rate on this page).
// ---------------------------------------------------------------------------
console.log("== Deutsche Bank India (degraded/repaired header: select resident grid by SHAPE) ==");
const DEUTSCHE_DEGRADED_FIXTURE = `
<html><body>
  <h3>NRE Fixed Deposit interest rates</h3>
  <table class="rate-table nre-grid" data-nre="true">
    <tr><th>Tenure</th><th>NRE interest rate (% p.a.)</th><th>Senior citizen</th></tr>
    <tr><td>271 Days - 1 Yr</td><td>9.10</td><td>9.10</td></tr>
    <tr><td>> 1 Yr - 1.5 Yrs</td><td>9.25</td><td>9.25</td></tr>
    <tr><td>> 1.5 Yrs - 2 Yrs</td><td>9.30</td><td>9.30</td></tr>
    <tr><td>> 2 Yrs - 3 Yrs</td><td>9.00</td><td>9.00</td></tr>
  </table>
  <h3>Resident Fixed Deposit interest rates</h3>
  <table class="cmp-savings-grid rate-table" data-nre="false">
    <tr>
      <th>Tenure</th>
      <th>Normal interest rate (% p.a.)</th>
      <th>Senior citizen interest rate (% p.a.)</th>
    </tr>
    <tr><td>7 Days</td><td>3.00</td><td>3.00</td></tr>
    <tr><td>8 - 14 Days</td><td>3.00</td><td>3.00</td></tr>
    <tr><td>15 - 29 Days</td><td>3.25</td><td>3.25</td></tr>
    <tr><td>30 Days</td><td>3.50</td><td>3.50</td></tr>
    <tr><td>31 - 45 Days</td><td>3.75</td><td>3.75</td></tr>
    <tr><td>46 - 59 Days</td><td>4.00</td><td>4.00</td></tr>
    <tr><td>60 - 89 Days</td><td>4.25</td><td>4.25</td></tr>
    <tr><td>90 - 99 Days</td><td>4.50</td><td>4.50</td></tr>
    <tr><td>100 Days</td><td>5.00</td><td>5.00</td></tr>
    <tr><td>101 - 180 Days</td><td>5.25</td><td>5.25</td></tr>
    <tr><td>181 - 270 Days</td><td>5.50</td><td>5.50</td></tr>
    <tr><td>271 Days - 1 Yr</td><td>6.50</td><td>6.50</td></tr>
    <tr><td>> 1 Yr - 1.5 Yrs</td><td>7.00</td><td>7.00</td></tr>
    <tr><td>> 1.5 Yrs - 2 Yrs</td><td>6.75</td><td>6.75</td></tr>
    <tr><td>> 2 Yrs - 3 Yrs</td><td>6.50</td><td>6.50</td></tr>
    <tr><td>> 3 Yrs - 4 Yrs</td><td>6.25</td><td>6.25</td></tr>
    <tr><td>> 4 Yrs - 5 Yrs</td><td>6.00</td><td>6.00</td></tr>
    <tr><td>5 Yrs</td><td>5.75</td><td>5.75</td></tr>
    <tr><td colspan="3">For NRE / NRO / FCNR deposits please refer to the respective pages. Savings account rates apply separately. Rates are subject to change without notice.</td></tr>
  </table>
</body></html>`;
const deuDegRows = deutsche.parseFdRd(DEUTSCHE_DEGRADED_FIXTURE, "2026-09-15");
const deuDegFd = deuDegRows.filter((r) => r.product === "FD");
const deuDegGen = deuDegFd.filter((r) => r.customer === "GENERAL");
const deuDegSr = deuDegFd.filter((r) => r.customer === "SENIOR");
// Shape-based selection must still find the resident ladder despite the
// degraded header. >=8 each FAILS against the prior header-token adapter
// (0 rows). Real ladder = 18 tenures -> 18 GENERAL + 18 SENIOR.
assert(deuDegGen.length >= 8, `Deutsche(degraded): >=8 GENERAL FD rows (got ${deuDegGen.length})`);
assert(deuDegSr.length >= 8, `Deutsche(degraded): >=8 SENIOR FD rows (got ${deuDegSr.length})`);
// Correct rates from the resident column, not the NRE decoy, not the flat-text
// fabricated 1.5.
const deuDeg7 = deuDegFd.find((r) => r.tenure.minDays === 7 && r.customer === "GENERAL");
assert(deuDeg7?.ratePercent === 3.0, "Deutsche(degraded): 7 Days general = 3.00");
const deuDeg15 = deuDegFd.find(
  (r) => r.tenure.minDays === 365 && r.tenure.maxDays === 548 && r.customer === "GENERAL",
);
assert(deuDeg15?.ratePercent === 7.0, "Deutsche(degraded): >1Yr-1.5Yrs general = 7.00 (not NRE 9.25, not 1.5)");
const deuDeg15Sr = deuDegFd.find(
  (r) => r.tenure.minDays === 365 && r.tenure.maxDays === 548 && r.customer === "SENIOR",
);
assert(deuDeg15Sr?.ratePercent === 7.0, "Deutsche(degraded): >1Yr-1.5Yrs senior = 7.00 (col 2 present)");
const deuDeg100 = deuDegFd.find((r) => r.tenure.minDays === 100 && r.customer === "GENERAL");
assert(deuDeg100?.ratePercent === 5.0, "Deutsche(degraded): 100 Days general = 5.00");
// The NRE decoy table must NEVER be selected (no NRE rate published).
assert(
  !deuDegFd.some((r) => [9.1, 9.25, 9.3, 9.0].includes(r.ratePercent)),
  "Deutsche(degraded): NRE decoy table never selected (no 9.x rate published)",
);
// Core sentinel: the fabricated flat-text 1.5 value must never appear.
assert(
  !deuDegFd.some((r) => r.ratePercent === 1.5),
  "Deutsche(degraded): no row has ratePercent == 1.5 (the fabricated fallback value)",
);
// All rows bankId-correct + OFFICIAL + official domain.
assert(
  deuDegRows.every(
    (r) =>
      r.bankId === "deutsche" &&
      r.source.quality === "OFFICIAL" &&
      /deutsche\.bank\.in/.test(r.source.url),
  ),
  "Deutsche(degraded): all rows OFFICIAL, bankId=deutsche, deutsche.bank.in source URL",
);
// parseTextFdRd still fabricates nothing.
assert(
  deutsche.parseTextFdRd(
    "Fixed Deposit\n> 1 Yr - 1.5 Yrs 7.00\n> 1.5 Yrs - 2 Yrs 7.00",
    "https://www.deutsche.bank.in/x",
    "2026-01-01",
  ).length === 0,
  "Deutsche(degraded): flat-text fallback neutralised (parseTextFdRd -> 0 rows)",
);

// ---------------------------------------------------------------------------
// DBS Bank India (FOREIGN): the DBS Treasures FD page is client-rendered and
// its retail INR table has TWO stacked header rows and INTERLEAVES an
// annualised-yield column after each rate column: <tenor> | general rate% |
// general yield% | senior rate% | senior yield%, e.g. 1 year 5.75/5.88/6.25/
// 6.40. So generalCol=1, seniorCol=3 (cols 2 and 4 are yields, NEVER a rate).
// DBS gives a real senior premium (6.25 vs 5.75 at 1yr). The fixture surrounds
// the retail grid with a savings balance-slab table and an NRE table so the pin
// + column mapping are exercised. Sentinels FAIL if a yield column, the savings
// or NRE table were picked, or if general and senior were swapped. Source:
// dbs.bank.in.
// ---------------------------------------------------------------------------
console.log("== DBS Bank India (pin retail grid; general=1 senior=3, skip yields) ==");
const DBS_FD_FIXTURE = `
<html><body>
  <h3>Savings Account Interest Rates</h3>
  <table>
    <tr><th>Balance Slab</th><th>Rate (% p.a.)</th></tr>
    <tr><td>Up to Rs.1 lakh</td><td>3.00%</td></tr>
    <tr><td>Above Rs.5 lakh</td><td>3.50%</td></tr>
  </table>
  <h3>NRE Fixed Deposit interest rates</h3>
  <table>
    <tr><th>Tenor</th><th>Interest Rate</th><th>Senior Citizens</th></tr>
    <tr><td>1 year</td><td>8.50%</td><td>8.50%</td></tr>
    <tr><td>2 years</td><td>8.60%</td><td>8.60%</td></tr>
    <tr><td>3 years</td><td>8.40%</td><td>8.40%</td></tr>
    <tr><td>4 years</td><td>8.30%</td><td>8.30%</td></tr>
  </table>
  <h3>Fixed Deposit interest rates (below Rs. 3 crore)</h3>
  <table>
    <tr><th rowspan="2">Tenor</th><th colspan="2">General</th><th colspan="2">Senior Citizens</th></tr>
    <tr><th>Interest Rate</th><th>Annualised Yield</th><th>Interest Rate</th><th>Annualised Yield</th></tr>
    <tr><td>1 year</td><td>5.75%</td><td>5.88%</td><td>6.25%</td><td>6.40%</td></tr>
    <tr><td>2 years</td><td>6.50%</td><td>6.88%</td><td>7.00%</td><td>7.44%</td></tr>
    <tr><td>3 years</td><td>6.25%</td><td>6.82%</td><td>6.75%</td><td>7.41%</td></tr>
    <tr><td>4 years</td><td>6.25%</td><td>7.04%</td><td>6.75%</td><td>7.68%</td></tr>
    <tr><td>5 years</td><td>6.25%</td><td>7.27%</td><td>6.75%</td><td>7.95%</td></tr>
  </table>
</body></html>`;
const dbs = new DbsAdapter();
const dbsRows = dbs.parseFdRd(DBS_FD_FIXTURE, "2026-09-15");
const dbsFd = dbsRows.filter((r) => r.product === "FD");
assert(dbsFd.length >= 8, `DBS: >=8 FD rows (got ${dbsFd.length})`);
assert(
  dbsRows.every(
    (r) =>
      r.bankId === "dbs" &&
      r.source.quality === "OFFICIAL" &&
      /dbs\.bank\.in/.test(r.source.url),
  ),
  "DBS: all rows OFFICIAL, bankId=dbs, dbs.bank.in source URL",
);
const dbsTenures = new Set(
  dbsFd.map((r) => `${r.tenure.minDays}-${r.tenure.maxDays}`),
);
assert(dbsTenures.size >= 4, `DBS: >=4 distinct FD tenures (got ${dbsTenures.size})`);
// 1 year: retail general = 5.75 (col 1, NOT the yield 5.88, NOT NRE 8.50).
// Senior = 6.25 (RATE col 3, NOT the yield col 2/4, NOT swapped with general).
const dbs1y = dbsFd.filter((r) => r.tenure.minDays === 365 && r.tenure.maxDays === 365);
const dbs1yGen = dbs1y.find((r) => r.customer === "GENERAL");
const dbs1ySr = dbs1y.find((r) => r.customer === "SENIOR");
assert(dbs1yGen?.ratePercent === 5.75, "DBS 1 year general = 5.75 (rate col 1, not yield 5.88, not NRE 8.50)");
assert(
  dbs1ySr?.ratePercent === 6.25,
  "DBS 1 year senior = 6.25 (RATE col 3, not yield 6.40/5.88; fails if cols swapped)",
);
// 2 years: general 6.50 / senior 7.00 (real senior premium).
const dbs2y = dbsFd.filter((r) => r.tenure.minDays === 730 && r.tenure.maxDays === 730);
assert(
  dbs2y.find((r) => r.customer === "GENERAL")?.ratePercent === 6.5,
  "DBS 2 years general = 6.50 (rate col 1)",
);
assert(
  dbs2y.find((r) => r.customer === "SENIOR")?.ratePercent === 7.0,
  "DBS 2 years senior = 7.00 (rate col 3, real premium)",
);
// No annualised-yield value must EVER surface as a published rate.
assert(
  !dbsFd.some((r) => [5.88, 6.4, 6.88, 7.44, 6.82, 7.41, 7.04, 7.68, 7.27, 7.95].includes(r.ratePercent)),
  "DBS: no annualised-yield value (col 2/4) ever published as a rate",
);
// No NRE value must surface at all.
assert(
  !dbsFd.some((r) => [8.5, 8.6, 8.4, 8.3].includes(r.ratePercent)),
  "DBS: NRE table never selected as retail FD",
);
// RD derived for the >=1yr buckets.
assert(
  dbsRows.some((r) => r.product === "RD"),
  "DBS: RD derived from FD card rates",
);
assert(
  dbs.parseFdRd("<html>no tables</html>", "2026-01-01").length === 0,
  "DBS: garbage HTML -> 0 rows",
);

if (failures === 0) {
  console.log("\nAll adapter + merge + PDF + div tests passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
