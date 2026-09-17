/**
 * Runs a set of adapters and merges their output. On per-adapter failure it
 * keeps going (best-effort refresh) and reports which banks failed so the
 * pipeline can retain prior data for them.
 */
export async function runAdapters(adapters) {
    const rates = [];
    const failed = [];
    const results = await Promise.allSettled(adapters.map(async (a) => ({
        bankId: a.bankId,
        rates: await a.fetchRates(),
    })));
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
            rates.push(...r.value.rates);
        }
        else {
            failed.push(adapters[i].bankId);
            // Surface WHY an adapter failed so URL/parse issues are debuggable in CI.
            console.warn(`  adapter ${adapters[i].bankId} failed: ${String(r.reason)}`);
        }
    }
    return { rates, failed };
}
