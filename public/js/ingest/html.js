/**
 * Dependency-free HTML helpers for scraping rate tables.
 *
 * Deliberately avoids cheerio/jsdom so adapters run in any environment with no
 * install step. These are intentionally forgiving parsers: bank rate pages are
 * simple server-rendered tables, and we locate the right table by its *content*
 * (tenure + rate patterns) rather than brittle CSS classes that change on
 * redesigns.
 */
/** Strip tags and decode the handful of entities that appear in rate tables. */
export function stripTags(html) {
    return html
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;|&rsquo;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}
/** Extract every <table>…</table> block (case-insensitive, non-greedy). */
export function extractTables(html) {
    const out = [];
    const re = /<table\b[\s\S]*?<\/table>/gi;
    let m;
    while ((m = re.exec(html)) !== null)
        out.push(m[0]);
    return out;
}
/** Extract rows (as arrays of cleaned cell text) from one <table> block. */
export function extractRows(tableHtml) {
    const rows = [];
    const rowRe = /<tr\b[\s\S]*?<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tableHtml)) !== null) {
        const cells = [];
        const cellRe = /<(td|th)\b[\s\S]*?<\/\1>/gi;
        let cm;
        while ((cm = cellRe.exec(rm[0])) !== null) {
            cells.push(stripTags(cm[0]));
        }
        if (cells.length > 0)
            rows.push(cells);
    }
    return rows;
}
/** Parse a percentage like "6.45", "6.45%", "6.45 %" → 6.45; else null. */
export function parsePercent(text) {
    const m = text.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%?/);
    if (!m)
        return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
}
/**
 * Read the client-side rate-data globals that {@link fetchRendered} serialized
 * into the page as an inert `<script id="__rate_globals__" type="application/
 * json">` block. Returns the parsed object (e.g. `{ interestData: [...] }`) or
 * null when the block is absent (plain HTTP fetch, or a page that exposes no
 * such global). Adapters use this to recover a FULL rate set from banks that
 * hydrate only a couple of "featured" rows into the DOM (e.g. ICICI).
 */
export function extractRateGlobals(html) {
    const m = html.match(/<script[^>]*id="__rate_globals__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m)
        return null;
    try {
        const json = m[1].replace(/<\\\/script>/gi, "</script>");
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * Convert HTML to newline-separated text, treating row/block boundaries as line
 * breaks so a "tenure … rate … rate" row stays on ONE line. Used for pages that
 * lay rates out in <div>s instead of a <table>, so the flat-text (PDF-style)
 * line parser can read them.
 */
export function htmlToText(html) {
    return (html
        // drop non-content elements entirely
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        // row/block/heading ends → newline; cells → space
        .replace(/<\/(tr|div|li|p|h[1-6]|section|article)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(td|th|span)>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;|&rsquo;/gi, "'")
        // collapse spaces within lines, keep newlines
        .split(/\n+/)
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n"));
}
