/**
 * Headless-browser fetch for JS-rendered bank pages.
 * -------------------------------------------------------------------------
 * Many bank rate pages build their tables client-side, so a plain HTTP GET
 * returns HTML with no <table> ("0 rows"). This helper drives Playwright's
 * bundled Chromium to load the page, wait for content, and return the fully
 * rendered HTML — which the existing table parser can then handle.
 *
 * Playwright is an OPTIONAL, lazily-imported dependency: it is only needed in
 * the ingest CI job (which installs it), never in the browser bundle or the
 * unit tests. The import is dynamic so type-check / build succeed without it.
 */
export async function fetchRendered(url, timeoutMs = 45000) {
    // Dynamic, untyped import so the project builds/tests without Playwright
    // installed (it's only present in the ingest CI job). The module specifier is
    // built at runtime so the compiler doesn't try to resolve types for it.
    const spec = "playwright";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = await import(/* @vite-ignore */ spec);
    const browser = await pw.chromium.launch({
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            viewport: { width: 1280, height: 900 },
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
        // Give client-side rate tables a beat to populate, then prefer a table.
        try {
            await page.waitForSelector("table", { timeout: 8000 });
        }
        catch {
            // no table appeared; return whatever rendered so the caller can decide
        }
        return await page.content();
    }
    finally {
        await browser.close();
    }
}
