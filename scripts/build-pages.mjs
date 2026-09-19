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
// Merge richer bank metadata (headquarters, established) from the source module
// over the dataset's bank list — the committed dataset.json may predate those
// fields (it's produced by ingestion), so enrich it here.
const { BANKS: BANK_META } = await import(
  resolve(root, "public/js/data/banks.js")
);
{
  const metaById = new Map(BANK_META.map((b) => [b.id, b]));
  const datasetIds = new Set(DATASET.banks.map((b) => b.id));
  // Enrich the dataset's banks with source metadata (headquarters, category…),
  // preferring dataset fields where both are present.
  const enriched = DATASET.banks.map((b) => ({ ...metaById.get(b.id), ...b }));
  // Union in banks defined in the source module that are not yet in the
  // committed dataset (e.g. private banks whose OFFICIAL rates arrive later via
  // the ingest workflow). They render gracefully with no rate rows until then.
  const extras = BANK_META.filter((b) => !datasetIds.has(b.id));
  DATASET.banks = [...enriched, ...extras];
}

// Ensure a baseline history snapshot exists so the movements page has data to
// work with, then load history + recent changes for rendering.
const { appendSnapshot, loadHistory, recentChanges, rateKey } = await import(
  resolve(here, "history.mjs")
);
const { seriesForKey, sparklineSvg } = await import(
  resolve(root, "public/js/history.js")
);
await appendSnapshot(DATASET, DATASET.generatedAt);
const HISTORY = await loadHistory();
const CHANGES = recentChanges(HISTORY);
const bankById = new Map(DATASET.banks.map((b) => [b.id, b]));

/**
 * Human labels for a bank category, used across profile + landing copy.
 *   sector      -> "public sector" / "private sector" / "small finance"
 *   peers       -> "public sector banks" / "private banks" / "small finance banks"
 *   average     -> "public sector average" / "private sector average" / "small finance bank average"
 *   identity    -> "Nationalised bank" / "Private sector bank" / "Small finance bank"
 *   introNoun   -> "a nationalised public sector bank" / "a private sector bank" / "a small finance bank"
 */
function categoryLabels(category) {
  if (category === "PRIVATE") {
    return {
      sector: "private sector",
      peers: "private banks",
      average: "private sector average",
      identity: "Private sector bank",
      introNoun: "a private sector bank",
    };
  }
  if (category === "SMALL_FINANCE") {
    return {
      sector: "small finance",
      peers: "small finance banks",
      average: "small finance bank average",
      identity: "Small finance bank",
      introNoun: "a small finance bank",
    };
  }
  return {
    sector: "public sector",
    peers: "public sector banks",
    average: "public sector average",
    identity: "Nationalised bank",
    introNoun: "a nationalised public sector bank",
  };
}

/**
 * Average headline 1-year GENERAL FD rate across a bank's OWN-CATEGORY peers,
 * EXCLUDING the bank itself (rounded 2dp). Uses the same ranked query
 * fdRankSummary relies on so the subject rate and the peer average stay
 * directly comparable. Returns null when the peer set is empty (the category
 * has only one ranked bank, so excluding self leaves nothing to average).
 */
function computePeerFdAverage(bankId, category) {
  const ranked = rankBanks(DATASET, {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: 365,
    category,
  });
  const rates = ranked
    .filter((r) => r.bank.id !== bankId)
    .map((r) => r.entry.ratePercent)
    .filter((n) => Number.isFinite(n));
  if (!rates.length) return null;
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return Math.round(avg * 100) / 100;
}

const TENURE_PAGES = [
  { slug: "6-months", label: "6 months", days: 182 },
  { slug: "1-year", label: "1 year", days: 365 },
  { slug: "2-year", label: "2 years", days: 730 },
  { slug: "3-year", label: "3 years", days: 1095 },
  { slug: "5-year", label: "5 years", days: 1825 },
];

const SITE_ORIGIN = "https://urbdag.github.io/psb-deposit-rates";

const OFFICIAL_RE =
  /bank\.in|sbi\.co\.in|bank\.sbi|centralbankofindia|aubank\.in|equitasbank\.com|ujjivansfb\.in|janabank\.com|suryodaybank\.com|utkarsh\.bank|utkarshbank\.com|esafbank\.com|capitalbank\.co\.in|nesfb\.com|shivalikbank\.com|theunitybank\.com|unitybank\.co\.in/;
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

/**
 * Rank of this bank's best 1-year general FD among its OWN-CATEGORY peers
 * (a private bank vs private banks, a PSU vs public sector banks).
 */
function fdRankSummary(bankId) {
  const bank = bankById.get(bankId);
  // Use a representative 1-year retail query, filtered to the bank's category.
  const q = {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: 365,
    category: bank?.category,
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
  const showTrend = HISTORY.snapshots.length >= 2;
  const body = rows
    .map(({ g, srRate }) => {
      const scheme = g.scheme
        ? `<div class="bank-short muted">${esc(g.scheme)}</div>`
        : "";
      let trendCell = "";
      if (showTrend) {
        const series = seriesForKey(HISTORY, rateKey(g));
        const spark = sparklineSvg(series, bank.color);
        trendCell = `<td class="num spark-cell">${spark || '<span class="muted">—</span>'}</td>`;
      }
      return `<tr>
        <td><div class="bank-name">${esc(g.tenure.label)}</div>${scheme}</td>
        <td class="muted">${esc(fmt.amountLabel(g.amount))}</td>
        <td class="num rate-cell" style="color:${bank.color}">${fmt.formatRate(g.ratePercent)}</td>
        <td class="num rate-cell muted">${srRate != null ? fmt.formatRate(srRate) : "—"}</td>
        ${trendCell}
      </tr>`;
    })
    .join("");
  const trendHead = showTrend ? `<th class="num">Trend</th>` : "";
  return `<section class="block">
    <div class="section-head"><div>
      <h2 class="section-title">${esc(title)}</h2>
      <p class="section-note">Rates for deposits below ₹3 crore · general vs senior citizen${showTrend ? " · trend over time" : ""}</p>
    </div></div>
    <div class="table-wrap"><table class="rate-table">
      <thead><tr><th>Tenure</th><th>Applies to</th><th class="num">General</th><th class="num">Senior</th>${trendHead}</tr></thead>
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
        `of ${rk.of} ${categoryLabels(bank.category).peers} · ${fmt.formatRate(rk.rate)}`,
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

/** Effective date from a bank's first rate source (mirrors sourceLine). */
function effectiveDateFor(bankId) {
  return DATASET.rates.find((r) => r.bankId === bankId)?.source?.effectiveDate;
}

/** Format an approximate ₹-crore figure into lakh-crore / crore prose. */
function croreLabel(crore) {
  if (!Number.isFinite(crore)) return null;
  if (crore >= 100000) {
    const lc = crore / 100000;
    const s = Number.isInteger(lc) ? String(lc) : lc.toFixed(1);
    return `₹${s} lakh crore`;
  }
  return `₹${Math.round(crore).toLocaleString("en-IN")} crore`;
}

/**
 * Signed delta description of a bank's rate vs the average of its OWN-CATEGORY
 * peers, EXCLUDING the bank itself. Returns null (so the caller omits the
 * clause) when the self-excluded peer average is unavailable or rate is not
 * finite.
 */
function deltaVsPeer(rate, category, bankId) {
  const avg = computePeerFdAverage(bankId, category);
  const avgLabel = categoryLabels(category).average;
  if (avg == null || !Number.isFinite(rate)) return null;
  const delta = Math.round((rate - avg) * 100) / 100;
  const avgStr = fmt.formatRate(avg);
  if (Math.abs(delta) < 0.03) {
    return { delta, sign: "flat", text: `in line with the ${avgLabel} of ${avgStr}` };
  }
  const signed = `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}%`;
  const word = delta > 0 ? "above" : "below";
  return { delta, sign: delta > 0 ? "up" : "down", text: `${signed} ${word} the ${avgLabel} of ${avgStr}` };
}

/**
 * 2–3 sentence templated intro built ONLY from real metadata + computed
 * figures. Clauses whose source field is missing are omitted gracefully.
 */
function bankIntro(bank) {
  const labels = categoryLabels(bank.category);
  const s1parts = [`${esc(bank.name)} (${esc(bank.shortName)}) is ${labels.introNoun}`];
  if (bank.headquarters) s1parts.push(`headquartered in ${esc(bank.headquarters)}`);
  if (bank.established) s1parts.push(`established in ${bank.established}`);
  const sentence1 = s1parts.join(", ") + ".";

  const sentences = [sentence1];
  const rk = fdRankSummary(bank.id);
  const d = rk ? deltaVsPeer(rk.rate, bank.category, bank.id) : null;
  if (rk && d) {
    sentences.push(
      `Its headline 1-year FD rate of ${fmt.formatRate(rk.rate)} is ${d.text}, ranking #${rk.rank} of ${rk.of} ${labels.peers}.`,
    );
  }
  return `<p class="bank-intro">${sentences.join(" ")}</p>`;
}

/** A small grid of only the present, clearly-approximate institution facts. */
function institutionSnapshot(bank) {
  const items = [];
  if (bank.headquarters)
    items.push(instItem("Headquarters", esc(bank.headquarters)));
  if (bank.established)
    items.push(instItem("Established", String(bank.established)));
  if (Number.isFinite(bank.branches))
    items.push(instItem("Branches", `~${bank.branches.toLocaleString("en-IN")}`, true));
  if (Number.isFinite(bank.atms))
    items.push(instItem("ATMs", `~${bank.atms.toLocaleString("en-IN")}`, true));
  if (Number.isFinite(bank.totalBusinessCrore)) {
    const lbl = croreLabel(bank.totalBusinessCrore);
    if (lbl) items.push(instItem("Total business", `~${lbl}`, true));
  }
  if (bank.ownership) items.push(instItem("Ownership", esc(bank.ownership)));
  if (!items.length) return "";

  const hasApprox = Number.isFinite(bank.branches) ||
    Number.isFinite(bank.atms) ||
    Number.isFinite(bank.totalBusinessCrore);
  const asOf = bank.statsAsOf && hasApprox
    ? `<p class="inst-note muted">Figures marked “approx.” are rounded public estimates as of ${bank.statsAsOf}.</p>`
    : "";
  return `<div class="inst-snapshot">
    <div class="inst-grid">${items.join("")}</div>
    ${asOf}
  </div>`;
}

function instItem(label, value, approx = false) {
  return `<div class="inst-item">
    <div class="inst-label">${esc(label)}</div>
    <div class="inst-value">${value}${approx ? ' <span class="inst-approx">approx.</span>' : ""}</div>
  </div>`;
}

/** Part B: how this bank compares — signed delta, rank, movement, trust line. */
function compareStrip(bank) {
  const rk = fdRankSummary(bank.id);
  const items = [];

  const labels = categoryLabels(bank.category);
  if (rk) {
    const d = deltaVsPeer(rk.rate, bank.category, bank.id);
    const deltaClass = d ? `delta-${d.sign}` : "";
    items.push(`<div class="compare-item">
      <div class="compare-label">1-year FD rate</div>
      <div class="compare-value" style="color:${bank.color}">${fmt.formatRate(rk.rate)}</div>
      <div class="compare-sub ${deltaClass}">${d ? esc(d.text) : `${labels.average} unavailable`}</div>
    </div>`);
    items.push(`<div class="compare-item">
      <div class="compare-label">Peer rank</div>
      <div class="compare-value">#${rk.rank}</div>
      <div class="compare-sub muted">of ${rk.of} ${labels.peers}</div>
    </div>`);
  }

  // Movement indicator — gated exactly like productSection().
  const showTrend = HISTORY.snapshots.length >= 2;
  const headline = bestFor(bank.id, "FD", "GENERAL");
  let movePill = `<span class="move-pill move-new">Tracking started</span>`;
  if (showTrend && headline) {
    const series = seriesForKey(HISTORY, rateKey(headline));
    if (series.length >= 2) {
      const first = series[0];
      const last = series[series.length - 1];
      const diff = Math.round((last - first) * 100) / 100;
      const spark = sparklineSvg(series, bank.color);
      if (diff > 0) {
        movePill = `<span class="move-pill move-rose">${triUp()} rose ${Math.abs(diff).toFixed(2)}%</span>${spark}`;
      } else if (diff < 0) {
        movePill = `<span class="move-pill move-fell">${triDown()} fell ${Math.abs(diff).toFixed(2)}%</span>${spark}`;
      } else {
        movePill = `<span class="move-pill move-flat">unchanged</span>${spark}`;
      }
    }
  }
  items.push(`<div class="compare-item">
    <div class="compare-label">Recent movement</div>
    <div class="compare-move">${movePill}</div>
  </div>`);

  const official = bankIsOfficial(bank.id);
  const eff = effectiveDateFor(bank.id);
  const freshness = eff
    ? `Rates as of ${esc(fmt.formatDate(eff))}, verified from ${official ? "official source" : "aggregated sources"}.`
    : `Rates ${official ? "verified from official source" : "from aggregated sources"}.`;
  const trust =
    bank.category === "PRIVATE"
      ? `<span class="trust-strong">Scheduled private sector bank</span> — deposits insured by DICGC up to ₹5,00,000.`
      : bank.category === "SMALL_FINANCE"
        ? `<span class="trust-strong">Scheduled small finance bank (RBI-licensed)</span> — deposits insured by DICGC up to ₹5,00,000.`
        : `<span class="trust-strong">Majority Government-of-India owned</span> — deposits insured by DICGC up to ₹5,00,000.`;

  return `<div class="compare-strip">
    <div class="compare-items">${items.join("")}</div>
    <p class="trust-line">${freshness} ${trust}</p>
  </div>`;
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
    categoryLabels(bank.category).identity,
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
  ${navBar("../../", "")}

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
    <section class="block">
      <div class="panel overview-panel" style="padding:24px">
        <div class="section-head" style="margin-bottom:6px"><div>
          <h2 class="section-title">Overview</h2>
          <p class="section-note">${esc(bank.shortName)} at a glance and how it compares with its ${esc(categoryLabels(bank.category).sector)} peers</p>
        </div></div>
        ${bankIntro(bank)}
        ${institutionSnapshot(bank)}
        ${compareStrip(bank)}
      </div>
    </section>
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
          <p class="muted">Deposit rates across India's public sector, private and small finance banks. <a class="modal-link" href="../../">Compare all banks ${arrowSvg()}</a></p>
        </div>
        <div>
          <p class="muted">Updated ${esc(fmt.formatDate(DATASET.generatedAt))} · ${DATASET.rates.length} rate entries</p>
        </div>
      </div>
    </div>
  </footer>

  <script>
  ${navScript()}
  (function(){
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

/**
 * Shared responsive nav. `base` is the relative prefix to site root
 * (e.g. "../../" for /bank/sbi/, "../" for /fixed-deposit/, "" for root pages).
 * `active` marks the current section.
 */
function navBar(base, active = "") {
  const link = (href, label, key) =>
    `<a class="nav-link${active === key ? " nav-active" : ""}" href="${base}${href}">${label}</a>`;
  return `<nav class="nav" id="nav">
    <div class="container nav-inner">
      <a class="brand" href="${base || "./"}">
        <span class="brand-mark">${brandMark()}</span>
        <span class="brand-word">Rate<span class="brand-accent">Radar</span></span>
      </a>
      <div class="nav-links" id="nav-links">
        ${link("", "Compare", "home")}
        <div class="nav-dd">
          <a class="nav-link${active === "fd" ? " nav-active" : ""}" href="${base}fixed-deposit/" aria-haspopup="true">Fixed Deposits ${caretSvg()}</a>
          <div class="nav-dd-menu">
            <a class="nav-dd-item" href="${base}fixed-deposit/">All FD rates</a>
            ${TENURE_PAGES.map((t) => `<a class="nav-dd-item" href="${base}fixed-deposit/${t.slug}/">${esc(t.label)}</a>`).join("")}
            <a class="nav-dd-item" href="${base}senior-citizen-fd-rates/">Senior citizen FD</a>
          </div>
        </div>
        ${link("savings-account/", "Savings", "savings")}
        ${link("recurring-deposit/", "Recurring", "rd")}
        ${link("banks/", "Banks", "banks")}
        ${link("rate-movements/", "Movements", "movements")}
      </div>
      <button class="nav-burger" id="nav-burger" aria-label="Menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="nav-drawer" id="nav-drawer">
      ${link("", "Compare all", "home")}
      <div class="drawer-group">Fixed Deposits</div>
      ${link("fixed-deposit/", "All FD rates", "fd")}
      ${TENURE_PAGES.map((t) => `<a class="nav-link nav-sub" href="${base}fixed-deposit/${t.slug}/">${esc(t.label)}</a>`).join("")}
      ${link("senior-citizen-fd-rates/", "Senior citizen FD", "senior")}
      <div class="drawer-group">Other products</div>
      ${link("savings-account/", "Savings account rates", "savings")}
      ${link("recurring-deposit/", "Recurring Deposit rates", "rd")}
      <div class="drawer-group">Banks</div>
      ${link("banks/", "All banks", "banks")}
      <div class="drawer-group">Insights</div>
      ${link("rate-movements/", "Rate movements", "movements")}
    </div>
  </nav>`;
}

function caretSvg() {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-left:2px"><path d="M6 9l6 6 6-6"/></svg>`;
}

/** Small script (inlined on every generated page) for scroll + mobile drawer. */
function navScript() {
  return `(function(){var nav=document.getElementById('nav');addEventListener('scroll',function(){nav.classList.toggle('scrolled',scrollY>8)},{passive:true});var b=document.getElementById('nav-burger'),d=document.getElementById('nav-drawer');if(b&&d){b.addEventListener('click',function(){var open=nav.classList.toggle('drawer-open');b.setAttribute('aria-expanded',open?'true':'false')});d.addEventListener('click',function(e){if(e.target.closest('a'))nav.classList.remove('drawer-open')})}})();`;
}

function checkSvg() {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M20 6L9 17l-5-5"/></svg>`;
}

function extLinkSvg() {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
}

function arrowSvg() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
}

// ==========================================================================
//  Landing pages: per-product + per-FD-tenure + senior-citizen FD
// ==========================================================================

const YEAR = new Date().getFullYear();
const MONTH = new Date().toLocaleDateString("en-IN", {
  month: "long",
  year: "numeric",
});

/** A ranked leaderboard table (rank, bank→profile link, rate, applies-to). */
function leaderboardTable(ranked, base) {
  const rows = ranked
    .map((r, i) => {
      const badge =
        i < 3
          ? `<span class="medal medal-${i + 1}">${i + 1}</span>`
          : `<span class="rank">${i + 1}</span>`;
      const detail = r.entry.scheme
        ? `${esc(r.entry.tenure.label)} · ${esc(r.entry.scheme)}`
        : esc(r.entry.tenure.label);
      return `<tr>
        <td>${badge}</td>
        <td><a class="bank-name bank-link" href="${base}bank/${r.bank.id}/">${esc(r.bank.name)}</a>
            <div class="bank-short muted">${esc(r.bank.shortName)}</div></td>
        <td class="num rate-cell" style="color:${r.bank.color}">${fmt.formatRate(r.entry.ratePercent)}</td>
        <td class="muted">${detail}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="rate-table">
    <thead><tr><th>#</th><th>Bank</th><th class="num">Rate</th><th>Applies to</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function landingShell({
  base,
  title,
  desc,
  canonical,
  h1Html,
  sub,
  active,
  sections,
  appLink,
  crumbs,
  ogImage,
}) {
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description: desc,
  };
  const crumbHtml =
    crumbs && crumbs.length
      ? `<nav class="breadcrumbs" aria-label="Breadcrumb"><div class="container">${crumbs
          .map((c, i) =>
            c.href
              ? `<a href="${base}${c.href}">${esc(c.label)}</a><span class="crumb-sep">/</span>`
              : `<span class="crumb-current">${esc(c.label)}</span>`,
          )
          .join("")}</div></nav>`
      : "";
  const og = `${SITE_ORIGIN}/${ogImage || "og/default.png"}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#4f46e5" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${og}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${og}" />
  <link rel="icon" href="${base}favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${base}styles.css" />
  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
  ${navBar(base, active)}
  ${crumbHtml}
  <header class="hero" style="padding-bottom:20px">
    <div class="hero-bg"></div>
    <div class="container"><div class="hero-inner">
      <span class="eyebrow"><span class="live-dot"></span> Updated ${esc(MONTH)}</span>
      <h1 style="font-size:clamp(30px,5vw,50px)">${h1Html}</h1>
      <p class="hero-sub">${esc(sub)}</p>
      <div style="margin-top:18px"><a class="reveal-btn" href="${base}${appLink}">Open interactive comparison ${arrowSvg()}</a></div>
    </div></div>
  </header>
  <div class="container">
    ${sections}
    <section class="block"><div class="panel" style="padding:22px">
      <h2 class="section-title" style="margin-bottom:10px">About these rates</h2>
      <p class="muted" style="margin:0">Rates are compiled across India's public sector, private and small finance banks and refreshed daily; ${new Set(DATASET.rates.filter((r) => OFFICIAL_RE.test(r.source.url || "")).map((r) => r.bankId)).size} banks are scraped directly from their official sites, the rest from aggregated sources. Deposits are DICGC-insured up to ₹5 lakh. Verify on the bank's site before investing.</p>
    </div></section>
  </div>
  <footer class="site-footer"><div class="container"><div class="footer-grid">
    <div><div class="brand" style="margin-bottom:10px"><span class="brand-mark">${brandMark()}</span><span class="brand-word">Rate<span class="brand-accent">Radar</span></span></div>
      <p class="muted">Best deposit rates across India's public sector, private and small finance banks. <a class="modal-link" href="${base}">Compare all ${arrowSvg()}</a></p></div>
    <div><p class="muted">Updated ${esc(fmt.formatDate(DATASET.generatedAt))} · ${DATASET.rates.length} rate entries</p></div>
  </div></div></footer>
  <script>${navScript()}</script>
</body>
</html>`;
}

function productLandingPage(product) {
  const base = "../";
  const name = fmt.productLabel(product);
  const slug =
    product === "FD"
      ? "fixed-deposit"
      : product === "RD"
        ? "recurring-deposit"
        : "savings-account";
  const q = { product, customer: "GENERAL", amount: 500000, tenureDays: 365 };
  const ranked = rankBanks(DATASET, q);
  const top = ranked[0];
  const sub =
    product === "SAVINGS"
      ? `Compare savings account interest rates across India's public sector, private and small finance banks.`
      : `The highest ${name} rates across India's public sector, private and small finance banks, ranked. Amounts below ₹3 crore, general public.`;
  let sections = `<section class="block">
    <div class="section-head"><div><h2 class="section-title">Best ${esc(name)} rates${product !== "SAVINGS" ? " (1 year)" : ""}</h2>
    <p class="section-note">Ranked across public sector, private and small finance banks · ${MONTH}</p></div></div>
    ${leaderboardTable(ranked, base)}</section>`;

  // For FD/RD, add a "best by tenure" quick grid with links to tenure pages.
  if (product === "FD") {
    const cells = TENURE_PAGES.map((tp) => {
      const r = rankBanks(DATASET, {
        product,
        customer: "GENERAL",
        amount: 500000,
        tenureDays: tp.days,
      })[0];
      return `<a class="tenure-card" href="${base}fixed-deposit/${tp.slug}/" style="text-decoration:none">
        <div class="tenure-label">${esc(tp.label)}</div>
        <div class="tenure-rate" style="color:${r ? r.bank.color : "#888"}">${r ? fmt.formatRate(r.entry.ratePercent) : "—"}</div>
        <div class="tenure-bank">${r ? esc(r.bank.shortName) : ""}</div></a>`;
    }).join("");
    sections += `<section class="block"><div class="section-head"><div>
      <h2 class="section-title">Best FD rate by tenure</h2>
      <p class="section-note">Tap a tenure for the full ranking</p></div></div>
      <div class="tenure-grid">${cells}</div></section>`;
  }

  const title = `Best ${name} Rates ${YEAR} — Public & Private Sector Banks | RateRadar`;
  const desc = `Compare the best ${name} interest rates across India's public sector, private and small finance banks${top ? ` — up to ${fmt.formatRate(top.entry.ratePercent)} at ${top.bank.shortName}` : ""}. Updated ${MONTH}.`;
  return {
    slug,
    html: landingShell({
      base,
      title,
      desc,
      canonical: `${slug}/`,
      h1Html: `Best <span class="grad">${esc(name)}</span> rates`,
      sub,
      active: product === "FD" ? "fd" : product === "RD" ? "rd" : "savings",
      sections,
      appLink: `?product=${product}`,
    }),
  };
}

function tenureLandingPage(tp) {
  const base = "../../";
  const q = {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: tp.days,
  };
  const ranked = rankBanks(DATASET, q);
  const top = ranked[0];
  const title = `Best ${tp.label} FD Rates ${YEAR} — Public & Private Sector Banks | RateRadar`;
  const desc = `Highest ${tp.label} fixed deposit rates across India's public sector, private and small finance banks${top ? ` — up to ${fmt.formatRate(top.entry.ratePercent)} at ${top.bank.shortName}` : ""}. Updated ${MONTH}.`;
  const sections = `<section class="block">
    <div class="section-head"><div><h2 class="section-title">Best ${esc(tp.label)} FD rates</h2>
    <p class="section-note">General public · below ₹3 crore · ${MONTH}</p></div></div>
    ${leaderboardTable(ranked, base)}</section>`;
  return {
    slug: tp.slug,
    html: landingShell({
      base,
      title,
      desc,
      canonical: `fixed-deposit/${tp.slug}/`,
      h1Html: `Best <span class="grad">${esc(tp.label)}</span> FD rates`,
      sub: `The public sector, private and small finance banks offering the highest fixed-deposit rate for a ${tp.label} tenure, ranked.`,
      active: "fd",
      sections,
      appLink: `?product=FD&tenure=${tp.days}`,
      crumbs: [
        { label: "Home", href: "" },
        { label: "Fixed Deposits", href: "fixed-deposit/" },
        { label: `${tp.label} FD` },
      ],
      ogImage: `og/fd-${tp.slug}.png`,
    }),
  };
}

function seniorLandingPage() {
  const base = "../";
  const q = {
    product: "FD",
    customer: "SENIOR",
    amount: 500000,
    tenureDays: 365,
  };
  const ranked = rankBanks(DATASET, q);
  const top = ranked[0];
  const title = `Senior Citizen FD Rates ${YEAR} — Public & Private Sector Banks | RateRadar`;
  const desc = `Best senior citizen fixed deposit rates across India's public sector, private and small finance banks${top ? ` — up to ${fmt.formatRate(top.entry.ratePercent)} at ${top.bank.shortName}` : ""}. Seniors typically earn +0.50% over general rates. Updated ${MONTH}.`;
  const sections = `<section class="block">
    <div class="section-head"><div><h2 class="section-title">Best senior citizen FD rates (1 year)</h2>
    <p class="section-note">Age 60+ · below ₹3 crore · ${MONTH}</p></div></div>
    ${leaderboardTable(ranked, base)}</section>`;
  return {
    slug: "senior-citizen-fd-rates",
    html: landingShell({
      base,
      title,
      desc,
      canonical: `senior-citizen-fd-rates/`,
      h1Html: `Best <span class="grad">senior citizen</span> FD rates`,
      sub: `Banks give senior citizens (60+) an extra ~0.50% p.a. Here are the highest senior FD rates across public sector, private and small finance banks, ranked.`,
      active: "senior",
      sections,
      appLink: `?product=FD&customer=SENIOR`,
    }),
  };
}

function banksDirectoryPage() {
  const base = "../";
  // Scales to any number of banks: searchable grid, sorted by best FD rate.
  const withBest = DATASET.banks
    .map((b) => ({ b, best: bestFor(b.id, "FD", "GENERAL") }))
    .sort((x, y) => (y.best?.ratePercent ?? 0) - (x.best?.ratePercent ?? 0));

  const cards = withBest
    .map(({ b, best }) => {
      const official = bankIsOfficial(b.id);
      const identity = categoryLabels(b.category).identity;
      const searchStr =
        `${b.name} ${b.shortName} ${b.headquarters || ""} ${identity}`.toLowerCase();
      return `<a class="dir-card" href="${base}bank/${b.id}/" data-search="${esc(searchStr)}" style="--bank:${b.color}">
        <div class="dir-card-top">
          <span class="bank-dot" style="--bank:${b.color};background:${b.color}"></span>
          <div class="dir-name">${esc(b.name)}</div>
        </div>
        <div class="dir-meta muted">${esc(b.shortName)}${b.headquarters ? " · " + esc(b.headquarters) : ""}</div>
        <div class="dir-category"><span class="tag tag-category">${esc(identity)}</span></div>
        <div class="dir-rate">${best ? fmt.formatRate(best.ratePercent) : "—"} <span class="dir-rate-label muted">top FD</span></div>
        <div class="dir-tag">${official ? '<span class="tag tag-official">official</span>' : '<span class="tag tag-aggregator">aggregator</span>'}</div>
      </a>`;
    })
    .join("");

  const title = `All Banks — Deposit Rates ${YEAR} | RateRadar`;
  const desc = `Browse deposit rates for all ${DATASET.banks.length} of India's public sector, private and small finance banks. Search and compare fixed deposit, savings and recurring deposit rates.`;
  const sections = `<section class="block">
    <div class="dir-search-wrap">
      <input id="dir-search" class="dir-search" type="search" placeholder="Search banks by name, code or city…" aria-label="Search banks" autocomplete="off" />
    </div>
    <div class="dir-grid" id="dir-grid">${cards}</div>
    <div class="empty" id="dir-empty" style="display:none">No banks match your search.</div>
  </section>`;

  const html = landingShell({
    base,
    title,
    desc,
    canonical: `banks/`,
    h1Html: `All <span class="grad">public, private & small finance banks</span>`,
    sub: `${DATASET.banks.length} banks tracked. Search or tap any bank for its full deposit-rate profile and maturity calculator.`,
    active: "banks",
    sections,
    appLink: "",
    crumbs: [{ label: "Home", href: "" }, { label: "Banks" }],
  }).replace(
    "</body>",
    `<script>(function(){var q=document.getElementById('dir-search'),g=document.getElementById('dir-grid'),e=document.getElementById('dir-empty');if(!q)return;q.addEventListener('input',function(){var v=q.value.trim().toLowerCase(),n=0;g.querySelectorAll('.dir-card').forEach(function(c){var m=c.getAttribute('data-search').indexOf(v)>=0;c.style.display=m?'':'none';if(m)n++});e.style.display=n?'none':'block'})})();</script></body>`,
  );
  return { slug: "banks", html };
}

function triUp() {
  return `<svg viewBox="0 0 10 10" width="9" height="9" style="vertical-align:0"><path d="M5 1l4 7H1z" fill="currentColor"/></svg>`;
}
function triDown() {
  return `<svg viewBox="0 0 10 10" width="9" height="9" style="vertical-align:0"><path d="M5 9L1 2h8z" fill="currentColor"/></svg>`;
}

function tenureLabelFromKey(minDays, maxDays) {
  if (!minDays) return "Any tenure";
  const tp = TENURE_PAGES.find((t) => String(t.days) === String(minDays));
  if (tp) return tp.label;
  if (maxDays && minDays === maxDays) return `${minDays} days`;
  return `${minDays}${maxDays ? "–" + maxDays : "+"} days`;
}

function movementsPage() {
  const base = "../";
  const nSnaps = HISTORY.snapshots.length;
  const first = HISTORY.snapshots[0]?.date;
  const last = HISTORY.snapshots[nSnaps - 1]?.date;

  let sections;
  if (CHANGES.length === 0) {
    sections = `<section class="block"><div class="panel" style="padding:32px;text-align:center">
      <div class="move-empty-emoji">📈</div>
      <h2 class="section-title" style="margin:8px 0">Tracking has started</h2>
      <p class="muted" style="max-width:520px;margin:0 auto">We record a daily snapshot of every rate${first ? ` (since ${esc(fmt.formatDate(first))})` : ""}. As banks raise or cut rates, the changes appear here — which bank moved, by how much, and when.</p>
    </div></section>`;
  } else {
    const rows = CHANGES.slice(0, 60)
      .map((c) => {
        const bank = bankById.get(c.bankId);
        if (!bank) return "";
        const up = c.delta > 0;
        const parts = c.key.split("|");
        const tenure = tenureLabelFromKey(parts[3], parts[4]);
        return `<tr>
          <td><a class="bank-name bank-link" href="${base}bank/${bank.id}/">${esc(bank.name)}</a>
              <div class="bank-short muted">${esc(fmt.productLabel(c.product))} · ${esc(tenure)} · ${c.customer === "SENIOR" ? "Senior" : "General"}</div></td>
          <td class="num muted">${fmt.formatRate(c.from)}</td>
          <td class="num rate-cell" style="color:${bank.color}">${fmt.formatRate(c.to)}</td>
          <td class="num"><span class="move-delta ${up ? "move-up" : "move-down"}">${up ? triUp() : triDown()} ${Math.abs(c.delta).toFixed(2)}%</span></td>
          <td class="muted">${esc(fmt.formatDate(c.date))}</td>
        </tr>`;
      })
      .join("");
    const ups = CHANGES.filter((c) => c.delta > 0).length;
    const downs = CHANGES.filter((c) => c.delta < 0).length;
    sections = `<section class="block">
      <div class="headline-card" style="grid-template-columns:1fr 1fr 1fr">
        <div class="hl-cell feature" style="background:linear-gradient(135deg,#4f46e5,#6d28d9)">
          <div class="hl-label">Rate changes tracked</div><div class="hl-value">${CHANGES.length}</div>
          <div class="hl-sub">across ${nSnaps} daily snapshots</div></div>
        <div class="hl-cell"><div class="hl-label">Hikes</div><div class="hl-value" style="color:#10b981">${ups}</div><div class="hl-sub">rates raised</div></div>
        <div class="hl-cell"><div class="hl-label">Cuts</div><div class="hl-value" style="color:#ef4444">${downs}</div><div class="hl-sub">rates lowered</div></div>
      </div></section>
      <section class="block"><div class="section-head"><div>
        <h2 class="section-title">Recent rate changes</h2>
        <p class="section-note">Biggest moves first${first && last ? ` · ${esc(fmt.formatDate(first))}–${esc(fmt.formatDate(last))}` : ""}</p></div></div>
        <div class="table-wrap"><table class="rate-table">
          <thead><tr><th>Bank &amp; product</th><th class="num">Was</th><th class="num">Now</th><th class="num">Change</th><th>On</th></tr></thead>
          <tbody>${rows}</tbody></table></div></section>`;
  }

  const title = `Deposit Rate Movements ${YEAR} — Who Raised or Cut FD Rates | RateRadar`;
  const desc = `Track which of India's public sector, private and small finance banks recently raised or cut their fixed deposit, savings and recurring deposit rates, and by how much.`;
  return {
    slug: "rate-movements",
    html: landingShell({
      base,
      title,
      desc,
      canonical: `rate-movements/`,
      h1Html: `Who <span class="grad">raised or cut</span> deposit rates`,
      sub: `A daily-tracked log of rate changes across India's public sector, private and small finance banks — hikes and cuts, ranked by how much they moved.`,
      active: "movements",
      sections,
      appLink: "",
      crumbs: [{ label: "Home", href: "" }, { label: "Rate movements" }],
    }),
  };
}

// ---- write pages + a favicon + sitemap ------------------------------------
let count = 0;
const sitemapUrls = [
  "",
  "banks/",
  "rate-movements/",
  ...DATASET.banks.map((b) => `bank/${b.id}/`),
];
for (const bank of DATASET.banks) {
  const dir = resolve(root, "public/bank", bank.id);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), page(bank), "utf8");
  count++;
}

// Banks directory (scales to any number of banks; searchable)
{
  const { slug, html } = banksDirectoryPage();
  const dir = resolve(root, "public", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), html, "utf8");
  count++;
}

// Rate movements page
{
  const { slug, html } = movementsPage();
  const dir = resolve(root, "public", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), html, "utf8");
  count++;
}

// Product landing pages
for (const product of ["FD", "SAVINGS", "RD"]) {
  const { slug, html } = productLandingPage(product);
  const dir = resolve(root, "public", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), html, "utf8");
  sitemapUrls.push(`${slug}/`);
  count++;
}

// FD tenure landing pages
for (const tp of TENURE_PAGES) {
  const { slug, html } = tenureLandingPage(tp);
  const dir = resolve(root, "public/fixed-deposit", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), html, "utf8");
  sitemapUrls.push(`fixed-deposit/${slug}/`);
  count++;
}

// Senior-citizen FD landing page
{
  const { slug, html } = seniorLandingPage();
  const dir = resolve(root, "public", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "index.html"), html, "utf8");
  sitemapUrls.push(`${slug}/`);
  count++;
}

// Shared favicon file referenced by profile pages.
await writeFile(
  resolve(root, "public/favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="0.6" stop-color="#6366f1"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(#g)"/><path d="M28 66 A24 24 0 0 1 66 34" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.55"/><path d="M34 66 A18 18 0 0 1 60 41" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.8"/><circle cx="66" cy="66" r="7" fill="white"/></svg>`,
  "utf8",
);

// ---- OG social-preview images (branded SVG) -------------------------------
// SVG is what we can generate offline (no rasteriser). Rendered by browsers and
// accepted by several crawlers; provides a branded 1200x630 card per key page.
function ogSvg(headline, sub) {
  const wrap = (s, n) => {
    const words = String(s).split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > n) {
        lines.push(cur.trim());
        cur = w;
      } else cur += " " + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.slice(0, 3);
  };
  const lines = wrap(headline, 22);
  const tspans = lines
    .map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 74}">${esc(l)}</tspan>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1050" cy="120" r="320" fill="#4f46e5" opacity="0.18"/>
  <g transform="translate(80,90)">
    <rect width="64" height="64" rx="16" fill="url(#acc)"/>
    <path d="M46 44 A16 16 0 0 1 72 24" transform="translate(-28,-8)" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
    <circle cx="44" cy="44" r="5" fill="white"/>
    <text x="82" y="42" font-family="Sora,Arial,sans-serif" font-size="30" font-weight="800" fill="#fff">RateRadar</text>
  </g>
  <text y="300" font-family="Sora,Arial,sans-serif" font-size="66" font-weight="800" fill="#ffffff">${tspans}</text>
  <text x="80" y="540" font-family="Inter,Arial,sans-serif" font-size="30" fill="#c7d2fe">${esc(sub)}</text>
</svg>`;
}

// Write OG images as .svg SOURCES + a .png fallback (the SVG bytes). CI
// (scripts/rasterize-og.mjs, which has sharp) overwrites the .png files with
// true rasters so social platforms accept them.
const ogDir = resolve(root, "public/og");
await mkdir(ogDir, { recursive: true });
const ogPairs = [
  [
    "default",
    ogSvg(
      "Best deposit rates across India's public, private & small finance banks",
      "FD · Savings · RD · public sector, private and small finance banks, ranked",
    ),
  ],
  ...TENURE_PAGES.map((tp) => {
    const top = rankBanks(DATASET, {
      product: "FD",
      customer: "GENERAL",
      amount: 500000,
      tenureDays: tp.days,
    })[0];
    return [
      `fd-${tp.slug}`,
      ogSvg(
        `Best ${tp.label} FD rates`,
        top
          ? `Up to ${fmt.formatRate(top.entry.ratePercent)} · ${top.bank.name}`
          : "Public, private & small finance banks, ranked",
      ),
    ];
  }),
];
for (const [name, svg] of ogPairs) {
  await writeFile(resolve(ogDir, `${name}.svg`), svg, "utf8");
  await writeFile(resolve(ogDir, `${name}.png`), svg, "utf8"); // fallback
}

// ---- sitemap.xml + robots.txt --------------------------------------------
const lastmod = new Date().toISOString().slice(0, 10);
const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  sitemapUrls
    .map(
      (u) =>
        `  <url><loc>${SITE_ORIGIN}/${u}</loc><lastmod>${lastmod}</lastmod></url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;
await writeFile(resolve(root, "public/sitemap.xml"), xml, "utf8");
await writeFile(
  resolve(root, "public/robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  "utf8",
);
// keep the plain-text sitemap too (harmless)
await writeFile(
  resolve(root, "public/sitemap.txt"),
  sitemapUrls.join("\n") + "\n",
  "utf8",
);

console.log(
  `Wrote ${count} pages + favicon + ${TENURE_PAGES.length + 1} OG images + sitemap.xml + robots.txt`,
);
