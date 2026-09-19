/**
 * PDF rate-card fetch + text extraction.
 * -------------------------------------------------------------------------
 * Several banks publish their deposit rates only as a linked PDF "rate card"
 * (so the HTML page has no <table>). This module downloads such a PDF and
 * extracts its text, which `parsePdfRates` (see pdf-parse-rates.ts) then turns
 * into rate rows.
 *
 * `pdf-parse` is an OPTIONAL, lazily-imported dependency — only installed in the
 * ingest CI job, never needed for the browser bundle, build, or unit tests. The
 * dynamic import uses a runtime-built specifier so the compiler doesn't try to
 * resolve its types.
 */
export async function fetchPdfText(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let bytes;
    let ct = "";
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                Accept: "application/pdf,*/*",
            },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status} for ${url}`);
        ct = res.headers.get("content-type") ?? "";
        bytes = new Uint8Array(await res.arrayBuffer());
    }
    finally {
        clearTimeout(timer);
    }
    // Guard: make sure we actually got a PDF, not an HTML error page.
    const head = String.fromCharCode(...bytes.subarray(0, 5));
    if (!head.startsWith("%PDF") && !ct.includes("pdf")) {
        throw new Error(`not a PDF (content-type: ${ct || "unknown"})`);
    }
    // Import the internal library module directly, NOT the package entrypoint.
    // pdf-parse@1.1.1's index.js contains a debug block guarded by
    // `!module.parent`, which is truthy under an ESM dynamic import — it then
    // tries to read a bundled test fixture (`./test/data/05-versions-space.pdf`)
    // that isn't shipped, throwing ENOENT before our buffer is ever parsed. The
    // `lib/pdf-parse.js` module is just the parser function with no debug block,
    // so importing it directly avoids that crash. Fall back to the package
    // entrypoint if the internal path ever moves.
    // Runtime-built specifiers so the compiler doesn't try to resolve pdf-parse
    // (it's installed only in the ingest CI job).
    const libSpec = "pdf-parse/lib/pdf-parse.js";
    const pkgSpec = "pdf-parse";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod;
    try {
        mod = await import(/* @vite-ignore */ libSpec);
    }
    catch {
        mod = await import(/* @vite-ignore */ pkgSpec);
    }
    const pdfParse = mod.default ?? mod;
    // pdf-parse accepts a Buffer/Uint8Array; wrap via the runtime Buffer if present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis;
    const data = g.Buffer ? g.Buffer.from(bytes) : bytes;
    const parsed = await pdfParse(data);
    return String(parsed.text ?? "");
}
