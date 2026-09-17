import type { CustomerCategory, ProductType, RateEntry } from "../types.js";

/**
 * CSV importer — the pragmatic path to getting real, official rates in quickly.
 *
 * Expected header (order-independent):
 *   bankId,product,customer,ratePercent,minDays,maxDays,tenureLabel,
 *   minAmount,maxAmount,amountLabel,scheme,sourceUrl,effectiveDate
 *
 * - maxDays / maxAmount: leave blank for "and above" (parsed as null).
 * - scheme: optional.
 * - Every imported row is stamped source.quality = "OFFICIAL".
 *
 * See data/rates-template.csv for a ready-to-fill template.
 */
export function parseRatesCsv(csv: string): RateEntry[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);

  const col = {
    bankId: idx("bankId"),
    product: idx("product"),
    customer: idx("customer"),
    ratePercent: idx("ratePercent"),
    minDays: idx("minDays"),
    maxDays: idx("maxDays"),
    tenureLabel: idx("tenureLabel"),
    minAmount: idx("minAmount"),
    maxAmount: idx("maxAmount"),
    amountLabel: idx("amountLabel"),
    scheme: idx("scheme"),
    sourceUrl: idx("sourceUrl"),
    effectiveDate: idx("effectiveDate"),
  };

  const required = [
    "bankId",
    "product",
    "customer",
    "ratePercent",
    "minDays",
    "minAmount",
  ];
  for (const r of required) {
    if (idx(r) === -1) throw new Error(`CSV missing required column: ${r}`);
  }

  const entries: RateEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (c: number) =>
      c >= 0 && c < cells.length ? cells[c].trim() : "";

    const numOrNull = (s: string) => (s === "" ? null : Number(s));
    const scheme = get(col.scheme);

    entries.push({
      bankId: get(col.bankId),
      product: get(col.product) as ProductType,
      customer: get(col.customer) as CustomerCategory,
      ratePercent: Number(get(col.ratePercent)),
      tenure: {
        minDays: Number(get(col.minDays)),
        maxDays: numOrNull(get(col.maxDays)),
        label:
          get(col.tenureLabel) ||
          tenureLabelFallback(get(col.minDays), get(col.maxDays)),
      },
      amount: {
        minAmount: Number(get(col.minAmount)),
        maxAmount: numOrNull(get(col.maxAmount)),
        label: get(col.amountLabel) || "—",
      },
      ...(scheme ? { scheme } : {}),
      source: {
        url: get(col.sourceUrl),
        effectiveDate: get(col.effectiveDate),
        quality: "OFFICIAL",
      },
    });
  }
  return entries;
}

function tenureLabelFallback(minDays: string, maxDays: string): string {
  if (maxDays === "" || maxDays == null) return `${minDays} days & above`;
  return `${minDays}–${maxDays} days`;
}

/** Minimal CSV splitter supporting double-quoted fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
