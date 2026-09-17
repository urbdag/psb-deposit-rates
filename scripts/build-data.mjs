// Emits the compiled dataset to public/data/dataset.json so the static site can
// fetch it at runtime. Run after `tsc` (see package.json "build").
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { DATASET } = await import(resolve(root, "public/js/data/dataset.js"));

const outDir = resolve(root, "public/data");
await mkdir(outDir, { recursive: true });
const outFile = resolve(outDir, "dataset.json");
await writeFile(outFile, JSON.stringify(DATASET, null, 2), "utf8");

console.log(
  `Wrote ${outFile} — ${DATASET.banks.length} banks, ${DATASET.rates.length} rate entries` +
    (DATASET.containsSampleData ? " (contains SAMPLE data)" : ""),
);
