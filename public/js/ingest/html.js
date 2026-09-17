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
