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
export async function fetchPdfText(
  url: string,
  timeoutMs = 30000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let bytes: Uint8Array;
  let ct = "";
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    ct = res.headers.get("content-type") ?? "";
    bytes = new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  // Guard: make sure we actually got a PDF, not an HTML error page.
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (!head.startsWith("%PDF") && !ct.includes("pdf")) {
    throw new Error(`not a PDF (content-type: ${ct || "unknown"})`);
  }

  const spec = "pdf-parse";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ spec);
  const pdfParse = mod.default ?? mod;
  // pdf-parse accepts a Buffer/Uint8Array; wrap via the runtime Buffer if present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis;
  const data = g.Buffer ? g.Buffer.from(bytes) : bytes;
  const parsed = await pdfParse(data);
  return String(parsed.text ?? "");
}
