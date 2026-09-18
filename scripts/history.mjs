// Rate-history helpers: append a dated snapshot of a dataset to
// public/data/history.json and compute recent changes. Used by ingest.mjs and
// by build-pages.mjs (to render the "Rate movements" page + change badges).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
export const HISTORY_PATH = resolve(root, "public/data/history.json");

const MAX_SNAPSHOTS = 400; // ~13 months of daily snapshots

/** Compact stable key for a single rate line. */
export function rateKey(r) {
  const max = r.tenure?.maxDays ?? "";
  return `${r.bankId}|${r.product}|${r.customer}|${r.tenure?.minDays ?? ""}|${max}|${r.scheme || ""}`;
}

export async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, "utf8"));
  } catch {
    return { snapshots: [] };
  }
}

/**
 * Append today's snapshot of `dataset` to history (idempotent per date, and
 * skipped if identical to the previous snapshot). Returns the updated history.
 */
export async function appendSnapshot(dataset, dateIso) {
  const history = await loadHistory();
  const date = (dateIso || new Date().toISOString()).slice(0, 10);

  const rates = {};
  for (const r of dataset.rates) rates[rateKey(r)] = r.ratePercent;

  const snaps = history.snapshots.filter((s) => s.date !== date); // replace same-day
  const prev = snaps[snaps.length - 1];
  const identical = prev && sameRates(prev.rates, rates);
  if (!identical) snaps.push({ date, rates });

  history.snapshots = snaps.slice(-MAX_SNAPSHOTS);
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history), "utf8");
  return history;
}

function sameRates(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Compute the most recent change per rate key, comparing the latest snapshot to
 * the most recent PRIOR snapshot that had a different value. Returns
 * [{ key, bankId, product, customer, from, to, delta, date }] sorted by |delta|.
 */
export function recentChanges(history) {
  const snaps = history.snapshots;
  if (snaps.length < 2) return [];
  const latest = snaps[snaps.length - 1];
  const out = [];
  for (const [key, to] of Object.entries(latest.rates)) {
    // walk backwards for the previous different value
    let from = null;
    let sinceDate = latest.date;
    for (let i = snaps.length - 2; i >= 0; i--) {
      const v = snaps[i].rates[key];
      if (v == null) continue;
      if (v !== to) {
        from = v;
        break;
      }
      sinceDate = snaps[i].date;
    }
    if (from != null) {
      const [bankId, product, customer] = key.split("|");
      out.push({
        key,
        bankId,
        product,
        customer,
        from,
        to,
        delta: Math.round((to - from) * 100) / 100,
        date: latest.date,
        sinceDate,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}
