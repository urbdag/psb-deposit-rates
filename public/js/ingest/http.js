/**
 * Tiny fetch helper for adapters — no external dependencies.
 * Uses the global `fetch` (Node 18+ / browsers). Adds a browser-like
 * User-Agent (some bank sites reject the default Node UA), a timeout, and
 * throws on non-2xx so adapter failures propagate to the ingest fallback.
 */
export async function fetchText(url, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml",
            },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
    }
    finally {
        clearTimeout(timer);
    }
}
