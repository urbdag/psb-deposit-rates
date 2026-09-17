// Generates a comprehensive, ready-to-fill CSV scaffold covering all 12 banks
// across the standard tenure buckets (FD + RD) and savings slabs, with blank
// ratePercent cells for you to fill in from each bank's official rate page.
//
//   node scripts/gen-template.mjs > data/rates-to-fill.csv
//
// Then fill the RATE column, and import:
//   node scripts/build-data.mjs   # (once, so importer JS exists)
//   node scripts/import-csv.mjs data/rates-to-fill.csv

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const { BANKS } = await import(resolve(root, "public/js/data/banks.js"));

const RETAIL = { min: 0, max: 30000000, label: "Below ₹3 crore (retail)" };

const FD_BUCKETS = [
  [7, 45, "7–45 days"],
  [46, 90, "46–90 days"],
  [91, 180, "91–180 days"],
  [181, 364, "181 days to < 1 year"],
  [365, 729, "1 year to < 2 years"],
  [730, 1094, "2 years to < 3 years"],
  [1095, 1824, "3 years to < 5 years"],
  [1825, 3650, "5 years to 10 years"],
];

const RD_BUCKETS = FD_BUCKETS.filter(([min]) => min >= 365);

const SAVINGS_SLABS = [
  [0, 10000000, "Below ₹1 crore"],
  [10000000, "", "₹1 crore & above"],
];

const rows = [];
rows.push(
  "bankId,product,customer,ratePercent,minDays,maxDays,tenureLabel,minAmount,maxAmount,amountLabel,scheme,sourceUrl,effectiveDate",
);

const q = (s) => (String(s).includes(",") ? `"${s}"` : s);
const EFF = ""; // fill YYYY-MM-DD

for (const b of BANKS) {
  const src = b.website;
  // FD: general + senior for each bucket (retail slab)
  for (const [min, max, label] of FD_BUCKETS) {
    for (const cust of ["GENERAL", "SENIOR"]) {
      rows.push(
        [
          b.id,
          "FD",
          cust,
          "",
          min,
          max,
          q(label),
          RETAIL.min,
          RETAIL.max,
          q(RETAIL.label),
          "",
          src,
          EFF,
        ].join(","),
      );
    }
  }
  // RD: general + senior for each RD bucket (any amount)
  for (const [min, max, label] of RD_BUCKETS) {
    for (const cust of ["GENERAL", "SENIOR"]) {
      rows.push(
        [
          b.id,
          "RD",
          cust,
          "",
          min,
          max,
          q(label),
          0,
          "",
          "Any amount",
          "",
          src,
          EFF,
        ].join(","),
      );
    }
  }
  // Savings: general per slab
  for (const [min, max, label] of SAVINGS_SLABS) {
    rows.push(
      [
        b.id,
        "SAVINGS",
        "GENERAL",
        "",
        0,
        "",
        "Any tenure",
        min,
        max,
        q(label),
        "",
        src,
        EFF,
      ].join(","),
    );
  }
}

process.stdout.write(rows.join("\n") + "\n");
