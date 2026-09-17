import type { AmountThreshold, RateEntry, RateSource } from "../types.js";
import { parseTenure } from "./tenure.js";

/**
 * Parse deposit rates out of the flat text extracted from a PDF rate card.
 *
 * PDF extraction loses table cell boundaries, so a row typically arrives as one
 * line mixing a tenure phrase with its rate figures, e.g.:
 *
 *   "1 year to less than 2 years        6.25%   6.75%"
 *   "444 Days (bob Square Drive)   6.45   6.95"
 *   "7 days to 45 days 3.50 4.00"
 *
 * Strategy per line: find a tenure phrase, then collect the percentage-looking
 * numbers that follow it. First % = general, second (if any) = senior.
 * Lines without a tenure, or with implausible rates, are skipped — so headers,
 * footnotes and totals are ignored.
 */
export interface PdfRateParseOptions {
  bankId: string;
  source: RateSource;
  amount: AmountThreshold;
  /** Emit RD rows (tracking FD) for tenures >= this many days. 0 disables RD. */
  rdMinDays?: number;
  schemeNamer?: (tenureText: string) => string | undefined;
}

function plausibleRate(n: number): boolean {
  return n >= 1 && n <= 15;
}

export function parsePdfRates(
  text: string,
  opts: PdfRateParseOptions,
): RateEntry[] {
  const rdMinDays = opts.rdMinDays ?? 365;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out: RateEntry[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Split the line into a tenure part and a rates part. Rates are the
    // trailing figures; the tenure phrase is what's left before them.
    const split = splitTenureAndRates(line);
    if (!split) continue;
    const tenure = parseTenure(split.tenureText);
    if (!tenure) continue;
    // Use the clean tenure phrase as the label (not the whole line).
    tenure.label = split.tenureText.trim();
    const rates = split.rates;
    if (rates.length === 0) continue;

    const general = rates[0];
    const senior = rates.length > 1 ? rates[1] : null;
    if (!plausibleRate(general)) continue;

    const isSpecial =
      tenure.maxDays != null && tenure.minDays === tenure.maxDays;
    const scheme = isSpecial ? opts.schemeNamer?.(line) : undefined;

    const key = `${tenure.minDays}-${tenure.maxDays}-${general}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mk = (
      product: "FD" | "RD",
      customer: "GENERAL" | "SENIOR",
      rate: number,
      amount: AmountThreshold,
    ): RateEntry => ({
      bankId: opts.bankId,
      product,
      customer,
      ratePercent: rate,
      tenure,
      amount,
      ...(scheme && product === "FD" ? { scheme } : {}),
      source: opts.source,
    });

    out.push(mk("FD", "GENERAL", general, opts.amount));
    if (senior != null && plausibleRate(senior))
      out.push(mk("FD", "SENIOR", senior, opts.amount));

    if (rdMinDays > 0 && !isSpecial && tenure.minDays >= rdMinDays) {
      const anyAmount: AmountThreshold = {
        minAmount: 0,
        maxAmount: null,
        label: "Any amount",
      };
      out.push(mk("RD", "GENERAL", general, anyAmount));
      if (senior != null && plausibleRate(senior))
        out.push(mk("RD", "SENIOR", senior, anyAmount));
    }
  }

  return out;
}

/**
 * Split a line into its tenure phrase and trailing rate figures.
 *
 * Rate cards put the tenure first and rates after, e.g.
 *   "1 year to less than 2 years   6.25%   6.75%"
 * We find the first *rate-like* token (a "%" value, or a bare decimal such as
 * "6.25" once a tenure word has appeared) and treat everything before it as the
 * tenure text and everything from it on as rates. Returns null if there's no
 * tenure word or no rate figure.
 */
function splitTenureAndRates(
  line: string,
): { tenureText: string; rates: number[] } | null {
  // Prefer "%"-terminated figures; fall back to bare decimals.
  const hasPct = /\d{1,2}(?:\.\d{1,2})?\s*%/.test(line);
  const tokenRe = hasPct
    ? /(\d{1,2}(?:\.\d{1,2})?)\s*%/g
    : /(?<![\d.])(\d{1,2}\.\d{1,2})(?![\d.])/g;

  const matches: { value: number; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line)) !== null) {
    const v = Number(m[1]);
    if (plausibleRate(v)) matches.push({ value: v, index: m.index });
  }
  if (matches.length === 0) return null;

  // Tenure text = everything before the first rate figure.
  const firstIdx = matches[0].index;
  const tenureText = line.slice(0, firstIdx).trim();
  if (!/\d/.test(tenureText) || !/(day|year|yr|month|mon)/i.test(tenureText)) {
    return null; // the "tenure" part isn't actually a tenure
  }
  return { tenureText, rates: matches.map((x) => x.value) };
}
