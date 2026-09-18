/**
 * Parse the free-text tenure descriptions Indian banks use into day ranges.
 *
 * Handles the common shapes seen on PSU bank rate pages, e.g.:
 *   "7 days to 45 days"
 *   "46 days to 179 days"
 *   "180 days to 210 days"
 *   "211 days to less than 1 year"
 *   "1 Year to less than 2 years"
 *   "1 year to 2 years"
 *   "5 years and up to 10 years"
 *   "444 days" (single special tenure)
 *
 * Returns null if the text doesn't look like a tenure at all (e.g. a header).
 */
export function parseTenure(text) {
    const t = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!/\d/.test(t))
        return null;
    if (!/(day|year|yr|month|mon)/.test(t))
        return null;
    // Real tenure labels are short ("1 year to < 2 years", "444 days"). Reject
    // long prose (penalty/terms footnotes) that merely happen to contain a number
    // and a time word — these are not rate rows.
    if (t.length > 60)
        return null;
    if (/(premature|penalty|notice|closure|remained|w\.e\.f|prior notice)/.test(t))
        return null;
    const toDays = (value, unit) => {
        if (/year|yr/.test(unit))
            return Math.round(value * 365);
        if (/month|mon/.test(unit))
            return Math.round(value * 30);
        return Math.round(value); // days
    };
    // "less than" / "below" / "<" are EXCLUSIVE of the upper bound.
    // "up to" / "upto" are INCLUSIVE, so they must NOT trigger the -1 adjustment.
    const hasLessThan = /less than|below|</.test(t);
    // Shared-unit range: "7-14 days", "46 - 60 days", "180 to 269 days" — two
    // bare numbers sharing ONE trailing unit. Handle before the pair matcher,
    // which would otherwise only see the second number (e.g. treat "7-14 days"
    // as a single 14-day bucket). Requires the range to precede the unit with no
    // other unit between the numbers.
    const shared = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mons?|days?)\b/);
    if (shared && shared.index != null) {
        const between = t.slice(shared.index, shared.index + shared[0].length);
        // ensure no unit word sits between the two numbers (so "1 year to 2 years"
        // is NOT matched here — that's handled by the pair matcher below)
        if (!/(year|yr|month|mon|day)/.test(between.replace(shared[3], ""))) {
            const unit = shared[3];
            const a = toDays(Number(shared[1]), unit);
            let b = toDays(Number(shared[2]), unit);
            if (hasLessThan && b > a)
                b -= 1;
            return { minDays: a, maxDays: b, label: cap(text) };
        }
    }
    // Grab up to two "<number> <unit>" pairs in order.
    const pairRe = /(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mons?|days?)/g;
    const pairs = [];
    let m;
    while ((m = pairRe.exec(t)) !== null) {
        pairs.push({ value: Number(m[1]), unit: m[2] });
    }
    if (pairs.length === 0)
        return null;
    // Single value: either a single-day special ("444 days") or an open bound.
    if (pairs.length === 1) {
        const days = toDays(pairs[0].value, pairs[0].unit);
        // "X and above" / "above X"
        if (/above|onwards|and above|\+/.test(t)) {
            return { minDays: days, maxDays: null, label: cap(text) };
        }
        // A specific special tenure like "444 days" → single-day exact bucket.
        return { minDays: days, maxDays: days, label: cap(text) };
    }
    // Two values → a range [a, b]. If "less than b", cap at b-1.
    const a = toDays(pairs[0].value, pairs[0].unit);
    let b = toDays(pairs[1].value, pairs[1].unit);
    if (hasLessThan && b > a)
        b -= 1;
    return { minDays: a, maxDays: b, label: cap(text) };
}
function cap(s) {
    return s.replace(/\s+/g, " ").trim();
}
