/**
 * CSV importer — the pragmatic path to getting real, official rates in quickly.
 *
 * Expected header (order-independent):
 *   bankId,product,customer,ratePercent,minDays,maxDays,tenureLabel,
 *   minAmount,maxAmount,amountLabel,scheme,sourceUrl,effectiveDate
 *
 * - maxDays / maxAmount: leave blank for "and above" (parsed as null).
 * - scheme: optional.
 * - quality: optional column ("OFFICIAL" | "AGGREGATOR" | "SAMPLE"). Defaults to
 *   AGGREGATOR, since CSV imports are usually compiled from third-party sources.
 *
 * See data/rates-template.csv for a ready-to-fill template.
 */
export function parseRatesCsv(csv) {
    const lines = csv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
    if (lines.length < 2)
        return [];
    const header = splitCsvLine(lines[0]).map((h) => h.trim());
    const idx = (name) => header.indexOf(name);
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
        quality: idx("quality"),
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
        if (idx(r) === -1)
            throw new Error(`CSV missing required column: ${r}`);
    }
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        const get = (c) => c >= 0 && c < cells.length ? cells[c].trim() : "";
        const numOrNull = (s) => (s === "" ? null : Number(s));
        const scheme = get(col.scheme);
        entries.push({
            bankId: get(col.bankId),
            product: get(col.product),
            customer: get(col.customer),
            ratePercent: Number(get(col.ratePercent)),
            tenure: {
                minDays: Number(get(col.minDays)),
                maxDays: numOrNull(get(col.maxDays)),
                label: get(col.tenureLabel) ||
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
                // Default CSV imports to AGGREGATOR (that's their usual origin); an
                // explicit `quality` column can override to OFFICIAL/SAMPLE.
                quality: normalizeQuality(get(col.quality)),
            },
        });
    }
    return entries;
}
function tenureLabelFallback(minDays, maxDays) {
    if (maxDays === "" || maxDays == null)
        return `${minDays} days & above`;
    return `${minDays}–${maxDays} days`;
}
function normalizeQuality(v) {
    const u = v.trim().toUpperCase();
    if (u === "OFFICIAL" || u === "SAMPLE")
        return u;
    return "AGGREGATOR";
}
/** Minimal CSV splitter supporting double-quoted fields with embedded commas. */
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                cur += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === ",") {
            out.push(cur);
            cur = "";
        }
        else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}
