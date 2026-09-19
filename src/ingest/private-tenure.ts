import type { TenureRange } from "../types.js";
import { parseTenure } from "./tenure.js";

/**
 * Tenure resolver for private-sector bank rate tables.
 * -------------------------------------------------------------------------
 * Public-sector banks quote tidy tenure ranges ("1 Year to less than 2 years")
 * that {@link parseTenure} already handles. Several private banks instead use
 * *compound* labels the two-pair PSU parser cannot resolve, e.g.
 *
 *   "2 Years 11 Months (35 months)"           (compound single bucket)
 *   "3 Years 1 day to < 4 Years 7 Months"     (compound "+1 day" bound + "<")
 *   "5 years 1 day – 10 years"                (en-dash, "+1 day" lower bound)
 *   "Above 3 Years up to below 61 Months"     ("up to below" separator)
 *
 * `parseTenure` reads such a label as two independent (value, unit) pairs and
 * produces an inverted range (maxDays < minDays), which the adapters correctly
 * reject — but that would silently DROP genuine long-tenure buckets (3Y / 5Y),
 * mis-representing the bank. {@link resolvePrivateTenure} fixes this by summing
 * every (value, unit) token on each side of the range separator into a single
 * day count, so "2 Year 11 Months" becomes one 1060-day bound rather than a
 * 730→330 range.
 *
 * Strategy: try the shared PSU parser first (it handles shared-unit compact
 * ranges like "7 - 14 days" that the summing splitter cannot), and fall back to
 * the compound resolver only when the PSU parser fails or yields an inverted /
 * degenerate range for a label that clearly carries a range separator. Anything
 * still unresolved returns null so the adapter drops the row rather than
 * publishing a wrong tenure under an OFFICIAL badge.
 */

/** Convert one (value, unit) token to a day count. */
function toDays(value: number, unit: string): number {
  if (/year|yr/i.test(unit)) return Math.round(value * 365);
  if (/month|mon/i.test(unit)) return Math.round(value * 30);
  return Math.round(value); // days
}

/** Sum every "<n> <unit>" token on one side of a range into total days. */
function sumSide(s: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mons?|days?)/gi;
  let m: RegExpExecArray | null;
  let total = 0;
  let seen = false;
  while ((m = re.exec(s)) !== null) {
    total += toDays(Number(m[1]), m[2]);
    seen = true;
  }
  if (seen) return total;
  // Bare number with no unit (e.g. the "185" in "185 to < 1 Year"): a lone
  // leading integer in a tenure label is a day count. Only treat it as such
  // when it is the sole token, so we never mis-read a stray footnote number.
  const bare = s.trim().match(/^(\d{1,4})$/);
  return bare ? Number(bare[1]) : null;
}

/** Range separators private banks use, in priority order. */
const SEP_RE = /\s+to\s+|\s+up\s?to\s+|\s*<=\s*|\s*<\s*|\s*[-–—]\s*/i;

/**
 * Decode the dash HTML entities banks render between range bounds so both the
 * literal Unicode dashes (from a rendered DOM) and the numeric/named entities
 * (from raw server HTML) collapse to a plain "-". The dependency-free
 * `stripTags` only decodes a small entity set and leaves these intact.
 */
function decodeDashes(s: string): string {
  return s
    .replace(/&#8211;|&#x2013;|&ndash;/gi, "-")
    .replace(/&#8212;|&#x2014;|&mdash;/gi, "-");
}

/**
 * Resolve a compound label by summing each side of its range separator. Handles
 * the "+1 day" lower-bound offset and "<"/"less than"/"below" exclusive upper
 * bounds. Returns null when neither side carries a time token.
 */
function resolveCompound(raw: string): { minDays: number; maxDays: number | null } | null {
  const t = decodeDashes(raw)
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\([^)]*\)/g, " ") // drop parenthetical restatements like "(35 months)"
    .replace(/\s+/g, " ")
    .trim();

  // "X and above" / "X onwards" → open-ended upper bound.
  if (/\b(and\s+above|onwards|\+)\b/i.test(t) && !SEP_RE.test(t.replace(/and\s+above/i, ""))) {
    const lo = sumSide(t);
    return lo == null ? null : { minDays: lo, maxDays: null };
  }

  const idx = t.search(SEP_RE);
  if (idx >= 0) {
    const sep = t.match(SEP_RE)![0];
    const lower = t.slice(0, idx);
    const upper = t.slice(idx + sep.length);
    const lo = sumSide(lower);
    const hi = sumSide(upper);
    if (lo == null || hi == null) return null;
    const exclusiveUpper = /<(?!=)/.test(sep) || /less than|below/i.test(upper);
    let H = hi;
    if (exclusiveUpper && H > lo) H -= 1;
    return { minDays: lo, maxDays: H };
  }

  const d = sumSide(t);
  return d == null ? null : { minDays: d, maxDays: d };
}

/**
 * Resolve a private-bank tenure label to a {@link TenureRange}, or null when it
 * is not a tenure or cannot be resolved to a sane (maxDays >= minDays) range.
 */
export function resolvePrivateTenure(raw: string): TenureRange | null {
  const label = decodeDashes(raw).replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const hasSeparator = SEP_RE.test(label);

  const psu = parseTenure(label);
  const psuOk = psu != null && (psu.maxDays == null || psu.maxDays >= psu.minDays);
  // Prefer the compound resolver when the label clearly carries a range
  // separator but the PSU parser collapsed it to a degenerate single-day bucket
  // (e.g. "1 Year to below 1 Year 6 Month" → 365..365): the compound resolver
  // recovers the real upper bound. Otherwise keep the PSU parser's result,
  // which correctly handles shared-unit compact ranges ("7 - 14 days").
  const psuDegenerate =
    psuOk && hasSeparator && psu!.maxDays != null && psu!.maxDays === psu!.minDays;

  if (psuOk && !psuDegenerate) return psu;

  const compound = resolveCompound(label);
  if (compound && (compound.maxDays == null || compound.maxDays >= compound.minDays)) {
    return { minDays: compound.minDays, maxDays: compound.maxDays, label };
  }
  // Fall back to the PSU result even if degenerate (better a narrow bucket than
  // dropping a real rate) when the compound resolver produced nothing usable.
  return psuOk ? psu : null;
}
