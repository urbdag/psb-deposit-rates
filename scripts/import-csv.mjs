// Import official rates from a CSV file, merge with the bank list, and write
// public/data/dataset.json (replacing the sample data).
//
//   node scripts/import-csv.mjs data/your-rates.csv
//
// Requires a prior `tsc` build so compiled JS exists in public/js.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/import-csv.mjs <path-to-csv>");
  process.exit(1);
}

const { BANKS } = await import(resolve(root, "public/js/data/banks.js"));
const { parseRatesCsv } = await import(
  resolve(root, "public/js/ingest/csv.js")
);

const csv = await readFile(resolve(process.cwd(), csvPath), "utf8");
const rates = parseRatesCsv(csv);

const knownIds = new Set(BANKS.map((b) => b.id));
const unknown = [...new Set(rates.map((r) => r.bankId))].filter(
  (id) => !knownIds.has(id),
);
if (unknown.length) {
  console.warn(
    `Warning: rows reference unknown bankId(s): ${unknown.join(", ")}`,
  );
}

const dataset = {
  banks: BANKS,
  rates,
  generatedAt: new Date().toISOString(),
  containsSampleData: rates.some((r) => r.source.quality === "SAMPLE"),
};

const outDir = resolve(root, "public/data");
await mkdir(outDir, { recursive: true });
const outFile = resolve(outDir, "dataset.json");
await writeFile(outFile, JSON.stringify(dataset, null, 2), "utf8");

console.log(`Imported ${rates.length} rates from ${csvPath} -> ${outFile}`);
