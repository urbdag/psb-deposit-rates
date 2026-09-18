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
export async function fetchRendered(url, timeoutMs = 60000) {
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
        // Block heavy/irrelevant resources so slow pages still reach a usable state
        // (bank sites load lots of fonts/images/trackers that stall networkidle).
        try {
            await page.route("**/*", (route) => {
                const type = route.request().resourceType();
                if (type === "image" || type === "media" || type === "font") {
                    route.abort();
                }
                else {
                    route.continue();
                }
            });
        }
        catch {
            /* routing optional */
        }
        // "commit" resolves as soon as the response starts — robust against slow
        // pages. We then wait for content heuristics below. Swallow goto timeouts.
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        }
        catch {
            try {
                await page.goto(url, { waitUntil: "commit", timeout: timeoutMs });
            }
            catch {
                /* proceed with whatever loaded */
            }
        }
        try {
            await page.waitForLoadState("networkidle", { timeout: 10000 });
        }
        catch {
            /* keep going */
        }
        // Nudge lazy-loaded / on-scroll content, then wait for a table OR a
        // rate-like percentage to appear in the body text.
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        catch {
            /* ignore */
        }
        try {
            await page.waitForFunction(() => document.querySelector("table") !== null ||
                /\b\d{1,2}\.\d{2}\s*%/.test(document.body?.innerText ?? ""), { timeout: 15000 });
        }
        catch {
            /* return whatever rendered so the caller can decide */
        }
        return await page.content();
    }
    finally {
        await browser.close();
    }
}
