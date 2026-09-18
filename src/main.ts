import type {
  CustomerCategory,
  Dataset,
  ProductType,
  RateQuery,
} from "./types.js";
import {
  AMOUNT_PRESETS,
  TENURE_PRESETS,
  bestByTenure,
  headlineRate,
  rankBanks,
} from "./query.js";
import {
  amountLabel,
  assessFreshness,
  formatDate,
  formatINR,
  formatRate,
  productLabel,
} from "./format.js";

interface UiState {
  product: ProductType;
  customer: CustomerCategory;
  amount: number;
  tenureDays: number;
  showAll: boolean;
}

const state: UiState = {
  product: "FD",
  customer: "GENERAL",
  amount: 500000,
  tenureDays: 365,
  showAll: false,
};

let dataset: Dataset;

async function boot(): Promise<void> {
  const res = await fetch("data/dataset.json");
  dataset = (await res.json()) as Dataset;
  renderShell();
  renderAll();
  wireScroll();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children)
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function renderShell(): void {
  const root = document.getElementById("app")!;
  root.innerHTML = "";
  const fresh = assessFreshness(dataset.generatedAt);

  // ---- Sticky nav ----
  root.append(
    el("nav", { class: "nav", id: "nav" }, [
      el("div", { class: "container nav-inner" }, [
        el("div", { class: "brand" }, [
          el("span", { class: "brand-mark", html: "₹" }),
          el("span", {}, ["RateRadar"]),
        ]),
        el("div", { class: "nav-right" }, [
          el(
            "span",
            {
              class: `nav-pill hide-sm freshness-${fresh.level}`,
              title: fresh.label,
            },
            [
              el("span", { class: "freshness-dot" }),
              fresh.level === "fresh" ? "Live" : capitalize(fresh.label),
            ],
          ),
          el("span", { class: "nav-pill" }, [
            el("span", { class: "live-dot" }),
            `${dataset.banks.length} banks tracked`,
          ]),
        ]),
      ]),
    ]),
  );

  // ---- Hero ----
  const hero = el("header", { class: "hero" }, [
    el("div", { class: "hero-bg" }),
  ]);
  const heroInner = el("div", { class: "container" }, [
    el("div", { class: "hero-inner rise rise-1" }, [
      el("span", { class: "eyebrow" }, [
        el("span", { class: "live-dot" }),
        "Updated " + fresh.label.replace("updated ", ""),
      ]),
      el("h1", {
        html: `Find the <span class="grad">highest deposit rate</span> across India's public sector banks.`,
      }),
      el("p", { class: "hero-sub" }, [
        "Compare Fixed Deposit, Savings and Recurring Deposit rates for all 12 nationalised banks — filtered to your exact amount and tenure, with rates verified from official bank sources.",
      ]),
    ]),
    el("div", { class: "headline-card rise rise-2", id: "headline-region" }),
  ]);
  hero.append(heroInner);
  root.append(hero);

  if (dataset.containsSampleData) {
    root.append(
      el("div", { class: "container" }, [
        el("div", { class: "banner banner-warn", id: "sample-banner" }, [
          el("strong", {}, ["Sample data. "]),
          "Rates shown are placeholders for demonstration — not for financial decisions.",
        ]),
      ]),
    );
  }

  // ---- Controls ----
  root.append(
    el("section", { class: "container block rise rise-3" }, [
      el("div", { class: "panel controls", id: "controls" }),
    ]),
  );

  // ---- Podium / results ----
  root.append(el("section", { class: "container block", id: "podium-region" }));
  root.append(
    el("section", { class: "container block", id: "leaderboard-region" }),
  );
  root.append(el("section", { class: "container block", id: "table-region" }));

  // ---- Footer ----
  root.append(
    el("footer", { class: "site-footer" }, [
      el("div", { class: "container" }, [
        el("div", { class: "footer-grid" }, [
          el("div", {}, [
            el("div", { class: "brand", style: "margin-bottom:10px" }, [
              el("span", { class: "brand-mark", html: "₹" }),
              el("span", {}, ["RateRadar"]),
            ]),
            el("p", { class: "muted" }, [
              "Deposit rates for State Bank of India and the 11 nationalised banks. Informational only — always verify on the bank's official website before investing.",
            ]),
          ]),
          el("div", {}, [
            el("div", { class: "legend" }, [
              legendItem("tag-official", "official", "scraped from the bank"),
              legendItem("tag-aggregator", "aggregator", "third-party source"),
            ]),
            el("p", { class: "muted", style: "margin-top:14px" }, [
              `Updated ${formatDate(dataset.generatedAt)} · ${dataset.rates.length} rate entries`,
            ]),
          ]),
        ]),
      ]),
    ]),
  );

  renderControls();
}

function legendItem(cls: string, label: string, desc: string): HTMLElement {
  return el("span", {}, [
    el("span", { class: `tag ${cls}` }, [label]),
    el("span", { class: "muted" }, [desc]),
  ]);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wireScroll(): void {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function renderControls(): void {
  const host = document.getElementById("controls")!;
  host.innerHTML = "";

  const products: ProductType[] = ["FD", "RD", "SAVINGS"];
  host.append(
    segControl(
      "Product",
      products.map((p) => ({ v: p, label: productLabel(p) })),
      state.product,
      (v) => {
        state.product = v as ProductType;
        state.showAll = false;
        renderControls();
        renderAll();
      },
    ),
  );

  const customers = [
    { v: "GENERAL", label: "General" },
    { v: "SENIOR", label: "Senior (60+)" },
    { v: "SUPER_SENIOR", label: "Super senior" },
  ];
  host.append(
    segControl("Customer", customers, state.customer, (v) => {
      state.customer = v as CustomerCategory;
      renderControls();
      renderAll();
    }),
  );

  // Amount chips
  const amtGroup = el("div", { class: "control" }, [
    el("label", {}, ["Deposit amount"]),
  ]);
  const amtChips = el("div", { class: "chips" });
  for (const preset of AMOUNT_PRESETS) {
    amtChips.append(
      chip(preset.label, state.amount === preset.amount, () => {
        state.amount = preset.amount;
        renderControls();
        renderAll();
      }),
    );
  }
  amtGroup.append(amtChips);
  host.append(amtGroup);

  // Tenure chips (hidden for savings)
  if (state.product !== "SAVINGS") {
    const tenGroup = el("div", { class: "control" }, [
      el("label", {}, ["Tenure"]),
    ]);
    const tenChips = el("div", { class: "chips" });
    for (const preset of TENURE_PRESETS) {
      tenChips.append(
        chip(preset.label, state.tenureDays === preset.days, () => {
          state.tenureDays = preset.days;
          renderControls();
          renderAll();
        }),
      );
    }
    tenGroup.append(tenChips);
    host.append(tenGroup);
  }
}

function segControl(
  label: string,
  opts: { v: string; label: string }[],
  active: string,
  onPick: (v: string) => void,
): HTMLElement {
  const group = el("div", { class: "control" }, [el("label", {}, [label])]);
  const seg = el("div", { class: "segment" });
  for (const o of opts) {
    const b = el(
      "button",
      { class: `seg-btn${active === o.v ? " active" : ""}`, type: "button" },
      [o.label],
    );
    b.addEventListener("click", () => onPick(o.v));
    seg.append(b);
  }
  group.append(seg);
  return group;
}

function chip(
  label: string,
  active: boolean,
  onClick: () => void,
): HTMLElement {
  const b = el(
    "button",
    { class: `chip${active ? " active" : ""}`, type: "button" },
    [label],
  );
  b.addEventListener("click", onClick);
  return b;
}

function query(): RateQuery {
  return {
    product: state.product,
    customer: state.customer,
    amount: state.amount,
    tenureDays: state.product === "SAVINGS" ? undefined : state.tenureDays,
  };
}

function renderAll(): void {
  renderHeadline();
  renderPodium();
  renderLeaderboard();
  renderTable();
}

// ---- Hero headline strip ----
function renderHeadline(): void {
  const host = document.getElementById("headline-region")!;
  host.innerHTML = "";
  const top = rankBanks(dataset, query())[0];
  const overall = headlineRate(dataset, state.product, state.customer);

  const feature = el("div", { class: "hl-cell feature" }, [
    el("div", { class: "hl-label" }, ["Top rate for your selection"]),
    el(
      "div",
      {
        class: "hl-value",
        "data-count": top ? String(top.entry.ratePercent) : "0",
      },
      [top ? "0.00%" : "—"],
    ),
    el("div", { class: "hl-sub" }, [
      top
        ? `${top.bank.name}${top.entry.scheme ? " · " + top.entry.scheme : ""}`
        : "No matching product",
    ]),
  ]);

  const overallCell = el("div", { class: "hl-cell" }, [
    el("div", { class: "hl-label" }, [
      `Best ${productLabel(state.product)} overall`,
    ]),
    el(
      "div",
      {
        class: "hl-value",
        style: overall ? `color:${overall.bank.color}` : "",
      },
      [overall ? formatRate(overall.entry.ratePercent) : "—"],
    ),
    el("div", { class: "hl-sub" }, [
      overall
        ? `${overall.bank.shortName} · ${overall.entry.tenure.label}`
        : "—",
    ]),
  ]);

  const officialCount = new Set(
    dataset.rates
      .filter(
        (r) =>
          r.source.quality === "OFFICIAL" &&
          /bank\.in|sbi\.co\.in|bank\.sbi|centralbankofindia/.test(
            r.source.url,
          ),
      )
      .map((r) => r.bankId),
  ).size;
  const trustCell = el("div", { class: "hl-cell" }, [
    el("div", { class: "hl-label" }, ["Verified from source"]),
    el("div", { class: "hl-value" }, [
      `${officialCount}/${dataset.banks.length}`,
    ]),
    el("div", { class: "hl-sub" }, ["banks scraped from official sites"]),
  ]);

  host.append(feature, overallCell, trustCell);
  if (top)
    countUp(
      feature.querySelector(".hl-value") as HTMLElement,
      top.entry.ratePercent,
    );
}

function countUp(node: HTMLElement, target: number): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = formatRate(target);
    return;
  }
  const dur = 700;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = (target * eased).toFixed(2) + "%";
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = formatRate(target);
  };
  requestAnimationFrame(tick);
}

// ---- Podium (top 3) ----
function renderPodium(): void {
  const host = document.getElementById("podium-region")!;
  host.innerHTML = "";
  const ranked = rankBanks(dataset, query());
  if (ranked.length === 0) return;

  host.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { class: "section-title" }, ["Top picks for you"]),
        el("p", { class: "section-note" }, [contextLine()]),
      ]),
    ]),
  );

  const podium = el("div", { class: "podium" });
  ranked.slice(0, 3).forEach((r) => {
    const card = el(
      "div",
      {
        class: `podium-card${r.rank === 1 ? " first" : ""}`,
        style: `--bank:${r.bank.color}`,
      },
      [
        el("div", { class: "podium-rank" }, [
          el("span", { class: `medal medal-${r.rank}` }, [String(r.rank)]),
          r.rank === 1 ? "Best rate" : `#${r.rank}`,
        ]),
        el("div", { class: "podium-bank" }, [
          el("span", { class: "bank-dot" }),
          el("span", { class: "podium-bankname" }, [r.bank.name]),
        ]),
        el("div", { class: "podium-rate" }, [formatRate(r.entry.ratePercent)]),
        el("div", { class: "podium-detail" }, [
          r.entry.scheme
            ? `${r.entry.tenure.label} · ${r.entry.scheme}`
            : r.entry.tenure.label,
        ]),
      ],
    );
    podium.append(card);
  });
  host.append(podium);
}

function contextLine(): string {
  const amt = formatINR(state.amount);
  const cust = customerLabel(state.customer);
  if (state.product === "SAVINGS")
    return `${productLabel(state.product)} · ${cust} · balance ${amt}`;
  const ten =
    TENURE_PRESETS.find((t) => t.days === state.tenureDays)?.label ?? "";
  return `${productLabel(state.product)} · ${cust} · ${amt} · ${ten}`;
}

// ---- Tenure strip ----
function renderLeaderboard(): void {
  const host = document.getElementById("leaderboard-region")!;
  host.innerHTML = "";
  if (state.product === "SAVINGS") return;

  host.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { class: "section-title" }, ["Best rate by tenure"]),
        el("p", { class: "section-note" }, [
          `${productLabel(state.product)} · ${customerLabel(state.customer)} · ${formatINR(state.amount)}`,
        ]),
      ]),
    ]),
  );

  const grid = el("div", { class: "tenure-grid" });
  for (const row of bestByTenure(dataset, {
    product: state.product,
    customer: state.customer,
    amount: state.amount,
  })) {
    const card = el("div", { class: "tenure-card" }, [
      el("div", { class: "tenure-label" }, [row.tenureLabel]),
    ]);
    if (row.top) {
      card.append(
        el(
          "div",
          { class: "tenure-rate", style: `color:${row.top.bank.color}` },
          [formatRate(row.top.entry.ratePercent)],
        ),
        el("div", { class: "tenure-bank" }, [row.top.bank.shortName]),
      );
    } else {
      card.append(el("div", { class: "tenure-rate muted" }, ["—"]));
    }
    grid.append(card);
  }
  host.append(grid);
}

function customerLabel(c: CustomerCategory): string {
  return c === "GENERAL"
    ? "General public"
    : c === "SENIOR"
      ? "Senior citizen"
      : "Super senior";
}

function qualityTag(quality: string): Node | string {
  if (quality === "OFFICIAL")
    return el("span", { class: "tag tag-official" }, ["official"]);
  if (quality === "AGGREGATOR")
    return el("span", { class: "tag tag-aggregator" }, ["aggregator"]);
  if (quality === "SAMPLE") return el("span", { class: "tag" }, ["sample"]);
  return "";
}

// ---- Full comparison table (collapsed to top 5 until expanded) ----
function renderTable(): void {
  const host = document.getElementById("table-region")!;
  host.innerHTML = "";
  const ranked = rankBanks(dataset, query());

  host.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { class: "section-title" }, ["All banks compared"]),
        el("p", { class: "section-note" }, [contextLine()]),
      ]),
    ]),
  );

  if (ranked.length === 0) {
    host.append(
      el("div", { class: "empty" }, [
        "No banks offer a matching product for this selection.",
      ]),
    );
    return;
  }

  const rows = state.showAll ? ranked : ranked.slice(0, 5);

  const table = el("table", { class: "rate-table" });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["#"]),
        el("th", {}, ["Bank"]),
        el("th", { class: "num" }, ["Rate"]),
        el("th", {}, ["Applies to"]),
        el("th", {}, ["Effective"]),
      ]),
    ]),
  );

  const tbody = el("tbody");
  for (const r of rows) {
    const detail = r.entry.scheme
      ? `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)} · ${r.entry.scheme}`
      : `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)}`;
    tbody.append(
      el("tr", { class: r.rank === 1 ? "top-row" : "" }, [
        el("td", {}, [
          r.rank <= 3
            ? el("span", { class: `medal medal-${r.rank}` }, [String(r.rank)])
            : el("span", { class: "rank" }, [String(r.rank)]),
        ]),
        el("td", {}, [
          el("div", { class: "bank-cell" }, [
            el("span", {
              class: "bank-dot",
              style: `--bank:${r.bank.color};background:${r.bank.color}`,
            }),
            el("div", {}, [
              el("div", { class: "bank-name" }, [r.bank.name]),
              el("div", { class: "bank-short muted" }, [r.bank.shortName]),
            ]),
          ]),
        ]),
        el("td", { class: "num rate-cell", style: `color:${r.bank.color}` }, [
          formatRate(r.entry.ratePercent),
        ]),
        el("td", { class: "muted" }, [detail]),
        el("td", { class: "muted" }, [
          formatDate(r.entry.source.effectiveDate),
          qualityTag(r.entry.source.quality),
        ]),
      ]),
    );
  }
  table.append(tbody);
  host.append(el("div", { class: "table-wrap" }, [table]));

  if (ranked.length > 5) {
    const btn = el("button", { class: "reveal-btn", type: "button" }, [
      state.showAll ? "Show top 5 only" : `Show all ${ranked.length} banks`,
    ]);
    btn.addEventListener("click", () => {
      state.showAll = !state.showAll;
      renderTable();
    });
    host.append(el("div", { class: "reveal-wrap" }, [btn]));
  }
}

boot().catch((err) => {
  const root = document.getElementById("app");
  if (root)
    root.innerHTML = `<div class="container"><div class="banner banner-warn">Failed to load data: ${String(err)}</div></div>`;
});
