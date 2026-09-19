/** Common tenure presets (in days) offered as quick picks in the UI. */
export const TENURE_PRESETS = [
    { label: "46–90 days", days: 60 },
    { label: "6 months", days: 182 },
    { label: "1 year", days: 365 },
    { label: "2 years", days: 730 },
    { label: "3 years", days: 1095 },
    { label: "5 years", days: 1825 },
    { label: "10 years", days: 3650 },
];
/** Common amount presets (in Rupees) offered as quick picks. */
export const AMOUNT_PRESETS = [
    { label: "₹50,000", amount: 50000 },
    { label: "₹1 lakh", amount: 100000 },
    { label: "₹5 lakh", amount: 500000 },
    { label: "₹10 lakh", amount: 1000000 },
    { label: "₹1 crore", amount: 10000000 },
    { label: "₹5 crore", amount: 50000000 },
];
export function tenureMatches(range, days) {
    const aboveMin = days >= range.minDays;
    const belowMax = range.maxDays === null || days <= range.maxDays;
    return aboveMin && belowMax;
}
export function amountMatches(threshold, amount) {
    const aboveMin = amount >= threshold.minAmount;
    const belowMax = threshold.maxAmount === null || amount < threshold.maxAmount;
    return aboveMin && belowMax;
}
/**
 * Returns the rate entries for one bank that apply to a query, best first.
 * SAVINGS ignores tenure. FD/RD require a tenure match.
 */
export function applicableEntries(rates, bankId, query) {
    return rates
        .filter((e) => e.bankId === bankId)
        .filter((e) => e.product === query.product)
        .filter((e) => e.customer === query.customer)
        .filter((e) => amountMatches(e.amount, query.amount))
        .filter((e) => {
        if (query.product === "SAVINGS")
            return true;
        if (query.tenureDays == null)
            return true;
        return tenureMatches(e.tenure, query.tenureDays);
    })
        .sort((a, b) => b.ratePercent - a.ratePercent);
}
/** The single best applicable rate for a bank, or undefined if none applies. */
export function bestEntryForBank(rates, bankId, query) {
    return applicableEntries(rates, bankId, query)[0];
}
/**
 * Ranks all banks for a query by their best applicable rate (highest first).
 * Banks with no applicable rate are omitted. Ties break alphabetically by name.
 */
export function rankBanks(dataset, query) {
    const bankById = new Map(dataset.banks.map((b) => [b.id, b]));
    const rows = [];
    // Optional per-category filter: when query.category is set, only banks of
    // that sector are considered. When omitted, all banks are ranked (unchanged).
    const banks = query.category
        ? dataset.banks.filter((b) => b.category === query.category)
        : dataset.banks;
    for (const bank of banks) {
        const best = bestEntryForBank(dataset.rates, bank.id, query);
        if (best)
            rows.push({ bank, entry: best });
    }
    rows.sort((a, b) => {
        if (b.entry.ratePercent !== a.entry.ratePercent) {
            return b.entry.ratePercent - a.entry.ratePercent;
        }
        return a.bank.name.localeCompare(b.bank.name);
    });
    return rows.map((r, i) => ({
        rank: i + 1,
        ...r,
        bank: bankById.get(r.bank.id),
    }));
}
/**
 * Builds a "best rate by tenure" matrix: for each tenure preset, the top bank
 * and rate for the given product/customer/amount. Used by the leaderboard.
 */
export function bestByTenure(dataset, base) {
    return TENURE_PRESETS.map((preset) => {
        const ranked = rankBanks(dataset, { ...base, tenureDays: preset.days });
        return { tenureLabel: preset.label, days: preset.days, top: ranked[0] };
    });
}
/** Highest single rate across the whole dataset for a product + customer. */
export function headlineRate(dataset, product, customer, category) {
    const bankById = new Map(dataset.banks.map((b) => [b.id, b]));
    const candidates = dataset.rates.filter((e) => {
        if (e.product !== product || e.customer !== customer)
            return false;
        if (category) {
            const bank = bankById.get(e.bankId);
            if (!bank || bank.category !== category)
                return false;
        }
        return true;
    });
    if (candidates.length === 0)
        return undefined;
    let best = candidates[0];
    for (const e of candidates)
        if (e.ratePercent > best.ratePercent)
            best = e;
    return { rank: 1, bank: bankById.get(best.bankId), entry: best };
}
