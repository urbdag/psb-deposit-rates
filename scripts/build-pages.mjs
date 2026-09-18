// Static bank-profile page generator.
// -------------------------------------------------------------------------
// Emits public/bank/<id>/index.html for all 12 banks — real, standalone,
// URL-navigable pages with baked-in SEO (title, meta, Open Graph, JSON-LD) so
// they rank in search and preview richly when shared. Reuses the compiled
// query/format logic. Run after `tsc` (wired into npm build + CI).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

import { readFile } from "node:fs/promises";

// Read the COMMITTED dataset (real/ingested rates), not the sample seed module.
const DATASET = JSON.parse(
  await readFile(resolve(root, "public/data/dataset.json"), "utf8"),
);
const { rankBanks } = await import(resolve(root, "public/js/query.js"));
const fmt = await import(resolve(root, "public/js/format.js"));

const OFFICIAL_RE = /bank\.in|sbi\.co\.in|bank\.sbi|centralbankofindia/;
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function bankIsOfficial(bankId) {
  return DATASET.rates.some(
    (r) => r.bankId === bankId && OFFICIAL_RE.test(r.source.url || ""),
  );
}

/** Best rate for a bank for a product+customer (any tenure/amount). */
function bestFor(bankId, product, customer) {
  const rows = DATASET.rates.filter(
    (r) =>
      r.bankId === bankId && r.product === product && r.customer === customer,
  );
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.ratePercent > a.ratePercent ? b : a));
}

/** Rank of this bank's best FD (general) among all banks, by tenure preset. */
function fdRankSummary(bankId) {
  // Use a representative 1-year retail query.
  const q = {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: 365,
  };
  const ranked = rankBanks(DATASET, q);
  const idx = ranked.findIndex((r) => r.bank.id === bankId);
  return idx >= 0
    ? { rank: idx + 1, of: ranked.length, rate: ranked[idx].entry.ratePercent }
    : null;
}

function rateTableRows(bankId, product) {
  const gen = DATASET.rates
    .filter(
      (r) =>
        r.bankId === bankId &&
        r.product === product &&
        r.customer === "GENERAL",
    )
    .sort((a, b) => a.tenure.minDays - b.tenure.minDays);
  return gen.map((g) => {
    const sr = DATASET.rates.find(
      (r) =>
        r.bankId === bankId &&
        r.product === product &&
        r.customer === "SENIOR" &&
        r.tenure.minDays === g.tenure.minDays &&
        r.tenure.maxDays === g.tenure.maxDays &&
        (r.scheme || "") === (g.scheme || ""),
    );
    return { g, srRate: sr ? sr.ratePercent : null };
  });
}

function productSection(bank, product, title) {
  const rows = rateTableRows(bank.id, product);
  if (rows.length === 0) return "";
  const body = rows
    .map(({ g, srRate }) => {
      const scheme = g.scheme
        ? `<div class="bank-short muted">${esc(g.scheme)}</div>`
        : "";
      return `<tr>
        <td><div class="bank-name">${esc(g.tenure.label)}</div>${scheme}</td>
        <td class="muted">${esc(fmt.amountLabel(g.amount))}</td>
        <td class="num rate-cell" style="color:${bank.color}">${fmt.formatRate(g.ratePercent)}</td>
        <td class="num rate-cell muted">${srRate != null ? fmt.formatRate(srRate) : "—"}</td>
      </tr>`;
    })
    .join("");
  return `<section class="block">
    <div class="section-head"><div>
      <h2 class="section-title">${esc(title)}</h2>
      <p class="section-note">Rates for deposits below ₹3 crore · general vs senior citizen</p>
    </div></div>
    <div class="table-wrap"><table class="rate-table">
      <thead><tr><th>Tenure</th><th>Applies to</th><th class="num">General</th><th class="num">Senior</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function highlightsRow(bank) {
  const bestFd = bestFor(bank.id, "FD", "GENERAL");
  const bestFdSr = bestFor(bank.id, "FD", "SENIOR");
  const sav = bestFor(bank.id, "SAVINGS", "GENERAL");
  const cards = [];
  if (bestFd)
    cards.push(
      hlCard(
        "Top FD rate",
        fmt.formatRate(bestFd.ratePercent),
        `${bestFd.tenure.label}${bestFd.scheme ? " · " + bestFd.scheme : ""}`,
        bank.color,
        true,
      ),
    );
  if (bestFdSr)
    cards.push(
      hlCard(
        "Senior citizen FD",
        fmt.formatRate(bestFdSr.ratePercent),
        "best senior rate",
        bank.color,
      ),
    );
  if (sav)
    cards.push(
      hlCard(
        "Savings rate",
        fmt.formatRate(sav.ratePercent),
        fmt.amountLabel(sav.amount),
        bank.color,
      ),
    );
  const rk = fdRankSummary(bank.id);
  if (rk)
    cards.push(
      hlCard(
        "1-year FD rank",
        `#${rk.rank}`,
        `of ${rk.of} PSU banks · ${fmt.formatRate(rk.rate)}`,
        "#334155",
      ),
    );
  return `<div class="headline-card">${cards.join("")}</div>`;
}

function hlCard(label, value, sub, color, feature = false) {
  return `<div class="hl-cell${feature ? " feature" : ""}"${feature ? ` style="background:linear-gradient(135deg,${color},${shade(color)})"` : ""}>
    <div class="hl-label">${esc(label)}</div>
    <div class="hl-value"${!feature ? ` style="color:${color}"` : ""}>${esc(value)}</div>
    <div class="hl-sub">${esc(sub)}</div>
  </div>`;
}

function shade(hex) {
  // darken a hex color ~18% for the gradient end
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, "$1$1") : m, 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `rgb(${r},${g},${b})`;
}

function page(bank) {
  const official = bankIsOfficial(bank.id);
  const src = DATASET.rates.find((r) => r.bankId === bank.id)?.source;
  const bestFd = bestFor(bank.id, "FD", "GENERAL");
  const title = `${bank.name} Deposit Rates ${new Date().getFullYear()} — FD, Savings & RD | RateRadar`;
  const desc = `Latest ${bank.name} (${bank.shortName}) fixed deposit, savings and recurring deposit interest rates${bestFd ? ` — up to ${fmt.formatRate(bestFd.ratePercent)}` : ""}. Compare all tenures for general and senior citizens.`;
  const canonical = `bank/${bank.id}/`;

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "BankOrCreditUnion",
    name: bank.name,
    alternateName: bank.shortName,
    url: bank.website,
    ...(bank.headquarters
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: bank.headquarters,
            addressCountry: "IN",
          },
        }
      : {}),
    ...(bank.established ? { foundingDate: String(bank.established) } : {}),
  };

  const identity = [
    bank.headquarters ? `HQ ${esc(bank.headquarters)}` : "",
    bank.established ? `Est. ${bank.established}` : "",
    "Nationalised bank",
  ]
    .filter(Boolean)
    .join(" · ");

  const sourceLine = src
    ? `<div class="modal-source">${official ? '<span class="tag tag-official">official</span>' : '<span class="tag tag-aggregator">aggregator</span>'}<span class="muted"> Effective ${esc(fmt.formatDate(src.effectiveDate))} · </span><a class="modal-link" href="${esc(src.url)}" target="_blank" rel="noopener">View source ${extLinkSvg()}</a></div>`
    : "";

  const defaultRate = bestFd ? bestFd.ratePercent : 6.5;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="${bank.color}" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta name="twitter:card" content="summary" />
  <link rel="icon" href="../../favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../../styles.css" />
  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
  <nav class="nav" id="nav">
    <div class="container nav-inner">
      <a class="brand" href="../../" style="text-decoration:none;color:inherit">
        <span class="brand-mark">${brandMark()}</span>
        <span class="brand-word">Rate<span class="brand-accent">Radar</span></span>
      </a>
      <div class="nav-right">
        <a class="nav-pill" href="../../">← All banks</a>
      </div>
    </div>
  </nav>

  <header class="hero" style="padding-bottom:24px">
    <div class="hero-bg" style="background:radial-gradient(55% 55% at 20% 8%, ${bank.color}55, transparent 70%)"></div>
    <div class="container">
      <div class="hero-inner">
        <span class="eyebrow" style="color:${bank.color};border-color:${bank.color}44;background:${bank.color}14">
          ${official ? `${checkSvg()} Rates verified from official source` : "Rates from aggregated sources"}
        </span>
        <h1 style="font-size:clamp(30px,5vw,46px)">${esc(bank.name)}<br/><span class="grad">deposit rates</span></h1>
        <p class="hero-sub">${esc(identity)} · ${DATASET.rates.filter((r) => r.bankId === bank.id).length} published rates. Full FD, savings and recurring-deposit schedule below, with a maturity calculator.</p>
      </div>
      ${highlightsRow(bank)}
    </div>
  </header>

  <div class="container">
    ${maturityCalc(bank, defaultRate)}
    ${productSection(bank, "FD", "Fixed Deposit rates")}
    ${productSection(bank, "RD", "Recurring Deposit rates")}
    ${productSection(bank, "SAVINGS", "Savings account rates")}

    <section class="block">
      <div class="panel" style="padding:22px">
        <h2 class="section-title" style="margin-bottom:10px">Good to know</h2>
        <p class="muted" style="margin:0 0 8px">Deposits with ${esc(bank.name)} are insured by DICGC up to ₹5,00,000 per depositor (principal + interest). Senior citizens (60+) typically earn an extra 0.50% p.a. over the published general rates.</p>
        ${sourceLine}
        <p class="muted" style="margin-top:12px">Informational only — always confirm the current rate on the <a class="modal-link" href="${esc(bank.website)}" target="_blank" rel="noopener">official ${esc(bank.shortName)} website ${extLinkSvg()}</a> before investing.</p>
      </div>
    </section>
  </div>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="brand" style="margin-bottom:10px"><span class="brand-mark">${brandMark()}</span><span class="brand-word">Rate<span class="brand-accent">Radar</span></span></div>
          <p class="muted">Deposit rates across India's 12 public sector banks. <a class="modal-link" href="../../">Compare all banks →</a></p>
        </div>
        <div>
          <p class="muted">Updated ${esc(fmt.formatDate(DATASET.generatedAt))} · ${DATASET.rates.length} rate entries</p>
        </div>
      </div>
    </div>
  </footer>

  <script>
  (function(){
    var nav=document.getElementById('nav');
    addEventListener('scroll',function(){nav.classList.toggle('scrolled',scrollY>8)},{passive:true});
    var amt=document.getElementById('mc-amount'), rate=document.getElementById('mc-rate'),
        ten=document.getElementById('mc-tenure'), out=document.getElementById('mc-out'), earn=document.getElementById('mc-earn');
    function inr(n){return '₹'+Math.round(n).toLocaleString('en-IN')}
    function calc(){
      var p=parseFloat(String(amt.value).replace(/[^0-9.]/g,''))||0;
      var r=parseFloat(rate.value)||0, d=parseFloat(ten.value)||0;
      var m=p*Math.pow(1+(r/100)/4,4*(d/365));
      out.textContent=inr(m); earn.textContent='+'+inr(m-p)+' interest';
    }
    [amt,rate,ten].forEach(function(x){x&&x.addEventListener('input',calc)});
    calc();
  })();
  </script>
</body>
</html>`;
}

function maturityCalc(bank, defaultRate) {
  return `<section class="block">
    <div class="section-head"><div>
      <h2 class="section-title">Maturity calculator</h2>
      <p class="section-note">Estimate returns at ${esc(bank.shortName)} (quarterly compounding)</p>
    </div></div>
    <div class="panel controls" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;gap:18px">
      <div class="control"><label>Amount (₹)</label>
        <div class="amount-row" style="max-width:none"><span class="amount-prefix">₹</span>
          <input id="mc-amount" class="amount-input" type="text" inputmode="numeric" value="500000" /></div></div>
      <div class="control"><label>Rate (% p.a.)</label>
        <div class="amount-row" style="max-width:none"><input id="mc-rate" class="amount-input" type="number" step="0.05" value="${defaultRate}" /></div></div>
      <div class="control"><label>Tenure (days)</label>
        <div class="amount-row" style="max-width:none"><input id="mc-tenure" class="amount-input" type="number" value="365" /></div></div>
      <div class="control" style="text-align:right">
        <label>Maturity value</label>
        <div class="podium-rate" id="mc-out" style="color:${bank.color}">—</div>
        <div class="section-note" id="mc-earn"></div>
      </div>
    </div>
  </section>`;
}

function brandMark() {
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><path d="M28 66 A24 24 0 0 1 66 34" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.5"/><path d="M34 66 A18 18 0 0 1 60 41" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.85"/><circle cx="66" cy="66" r="7.5" fill="white"/></svg>`;
}

function checkSvg() {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M20 6L9 17l-5-5"/></svg>`;
}

function extLinkSvg() {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
}

// ---- write pages + a favicon + sitemap ------------------------------------
let count = 0;
const sitemapUrls = ["", ...DATASET.banks.map((b) => `bank/${b.id}/`)];
for (const bank of DATASET.banks) {
  const dir = resolve(root, "public/bank", bank.id);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), page(bank), "utf8");
  count++;
}

// Shared favicon file referenced by profile pages.
await writeFile(
  resolve(root, "public/favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="0.6" stop-color="#6366f1"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(#g)"/><path d="M28 66 A24 24 0 0 1 66 34" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.55"/><path d="M34 66 A18 18 0 0 1 60 41" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.8"/><circle cx="66" cy="66" r="7" fill="white"/></svg>`,
  "utf8",
);

// sitemap.xml (relative-friendly; host is filled by deploy if desired)
await writeFile(
  resolve(root, "public/sitemap.txt"),
  sitemapUrls.join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${count} bank profile pages + favicon.svg + sitemap.txt`);
