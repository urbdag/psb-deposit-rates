// CI diagnostic: load a bank rate page in a headless browser and dump
// everything useful for figuring out where the rate data actually lives:
//   - the fully rendered HTML
//   - each iframe's URL + rendered HTML
//   - every XHR/fetch response the page made (esp. JSON — rates are often here)
//   - a short summary (tables, iframes, % samples, promising network URLs)
//
// Usage: node scripts/diagnose-page.mjs <url> [outDir]
// Requires Playwright (installed in the ingest CI job).
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractTables, extractRows } from "../public/js/ingest/html.js";

const url = process.argv[2];
const outDir = resolve(process.argv[3] || "diagnostics");
if (!url) {
  console.error("Usage: node scripts/diagnose-page.mjs <url> [outDir]");
  process.exit(1);
}

const pw = await import("playwright");
const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  viewport: { width: 1280, height: 1000 },
});
const page = await context.newPage();

// Capture network responses that might carry rate data.
const captured = [];
page.on("response", async (res) => {
  try {
    const ct = res.headers()["content-type"] || "";
    const u = res.url();
    if (/json|javascript|text\/plain/.test(ct) || /\.json(\?|$)|rate|deposit|interest/i.test(u)) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* non-text */
      }
      if (body && body.length < 500000) {
        const hasPct = /\d{1,2}\.\d{1,2}\s*%/.test(body) || /"rate"|interestRate|roi/i.test(body);
        captured.push({ url: u, status: res.status(), ct, len: body.length, hasPct, body });
      }
    }
  } catch {
    /* ignore */
  }
});

await mkdir(outDir, { recursive: true });

const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80);

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 20000 });
  } catch {
    /* keep going */
  }
  // Nudge lazy content: scroll and click common "tab" triggers.
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } catch {
    /* ignore */
  }
  await page.waitForTimeout(4000);

  const mainHtml = await page.content();
  await writeFile(resolve(outDir, `${slug}.main.html`), mainHtml, "utf8");

  // Iframes
  const frames = page.frames();
  const frameInfo = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f === page.mainFrame()) continue;
    let fhtml = "";
    try {
      fhtml = await f.content();
    } catch {
      /* cross-origin */
    }
    frameInfo.push({ index: i, url: f.url(), len: fhtml.length });
    if (fhtml) await writeFile(resolve(outDir, `${slug}.frame${i}.html`), fhtml, "utf8");
  }

  // Captured network payloads (most likely place rates live).
  await writeFile(resolve(outDir, `${slug}.network.json`), JSON.stringify(captured, null, 2), "utf8");

  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const pctSamples = (bodyText.match(/\d{1,2}\.\d{1,2}\s*%/g) || []).slice(0, 10);

  // Link discovery: surface links whose text/href mention deposit/interest/rate
  // so we can find the real rate-page URL without guessing.
  const rateLinks = await page.evaluate(() => {
    const out = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (/deposit|interest|rate|fixed|term/i.test(href + " " + text)) {
        out.push({ text: text.slice(0, 50), href });
      }
    }
    // de-dupe by href
    const seen = new Set();
    return out.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true))).slice(0, 40);
  });

  // Per-table cell-level layout: reuse the same forgiving extractors the
  // adapters use so what we see here matches what the parser sees. Truncate
  // cells and cap rows so this stays readable in the CI stdout log (artifacts
  // are not downloadable in some environments — the log is the source of truth).
  const CELL_MAX = 60;
  const ROW_CAP = 40;
  const tableRows = extractTables(mainHtml).map((t) => {
    const rows = extractRows(t);
    return rows
      .slice(0, ROW_CAP)
      .map((row) => row.map((cell) => (cell.length > CELL_MAX ? cell.slice(0, CELL_MAX) + "…" : cell)));
  });

  const summary = {
    url,
    mainHtmlLen: mainHtml.length,
    tables: (mainHtml.match(/<table\b/gi) || []).length,
    iframes: frameInfo,
    bodyPctSamples: pctSamples,
    tableRows,
    rateLinks,
    networkHits: captured.map((c) => ({ url: c.url, ct: c.ct, len: c.len, hasPct: c.hasPct })),
    promising: captured.filter((c) => c.hasPct).map((c) => c.url),
  };
  await writeFile(resolve(outDir, `${slug}.summary.json`), JSON.stringify(summary, null, 2), "utf8");

  console.log("=== DIAGNOSIS:", url, "===");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
