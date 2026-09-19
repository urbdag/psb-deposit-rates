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
  formatINRFull,
  formatRate,
  parseAmountInput,
  productLabel,
} from "./format.js";
import type { History as RateHistory } from "./history.js";
import { banksChangedCount, recentChanges } from "./history.js";

type SortKey = "rate" | "name" | "effective";
type SectorFilter =
  | "ALL"
  | "PUBLIC"
  | "PRIVATE"
  | "SMALL_FINANCE"
  | "PAYMENTS_BANK"
  | "FOREIGN";
interface UiState {
  product: ProductType;
  customer: CustomerCategory;
  amount: number;
  tenureDays: number;
  category: SectorFilter;
  showAll: boolean;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}

const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 50000000; // ₹5 crore

const state: UiState = {
  product: "FD",
  customer: "GENERAL",
  amount: 500000,
  tenureDays: 365,
  category: "ALL",
  showAll: false,
  sortKey: "rate",
  sortDir: "desc",
};

let dataset: Dataset;

// ---- URL state (shareable links) -----------------------------------------

/** Read filters from the URL query string into state (called on load). */
function readStateFromUrl(): void {
  const p = new URLSearchParams(location.search);
  const prod = p.get("product");
  if (prod === "FD" || prod === "RD" || prod === "SAVINGS")
    state.product = prod;
  const cust = p.get("customer");
  if (cust === "GENERAL" || cust === "SENIOR" || cust === "SUPER_SENIOR")
    state.customer = cust;
  const amt = Number(p.get("amount"));
  if (Number.isFinite(amt) && amt > 0) state.amount = clampAmount(amt);
  const ten = Number(p.get("tenure"));
  if (Number.isFinite(ten) && ten > 0) state.tenureDays = ten;
  const sector = p.get("sector");
  if (sector === "all") state.category = "ALL";
  else if (sector === "public") state.category = "PUBLIC";
  else if (sector === "private") state.category = "PRIVATE";
  else if (sector === "small_finance") state.category = "SMALL_FINANCE";
  else if (sector === "payments_bank") state.category = "PAYMENTS_BANK";
  else if (sector === "foreign") state.category = "FOREIGN";
  const sort = p.get("sort");
  if (sort) {
    const [key, dir] = sort.split(".");
    if (key === "rate" || key === "name" || key === "effective")
      state.sortKey = key;
    if (dir === "asc" || dir === "desc") state.sortDir = dir;
  }
}

/** Reflect current state into the URL (replaceState, no history spam). */
function syncUrl(): void {
  const p = new URLSearchParams();
  p.set("product", state.product);
  p.set("customer", state.customer);
  p.set("amount", String(state.amount));
  if (state.product !== "SAVINGS") p.set("tenure", String(state.tenureDays));
  // Only include the sector filter when it deviates from the default (ALL).
  if (state.category !== "ALL") p.set("sector", state.category.toLowerCase());
  // Only include sort when it deviates from the default (rate.desc).
  if (!(state.sortKey === "rate" && state.sortDir === "desc"))
    p.set("sort", `${state.sortKey}.${state.sortDir}`);
  const url = `${location.pathname}?${p.toString()}`;
  history.replaceState(null, "", url);
}

function clampAmount(n: number): number {
  return Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, Math.round(n)));
}

let rateHistory: RateHistory = { snapshots: [] };

async function boot(): Promise<void> {
  const res = await fetch("data/dataset.json");
  dataset = (await res.json()) as Dataset;
  try {
    const hres = await fetch("data/history.json");
    if (hres.ok) rateHistory = (await hres.json()) as RateHistory;
  } catch {
    /* history optional */
  }
  // Capture deep-link params BEFORE syncUrl() rewrites the query string.
  const bankParam = new URLSearchParams(location.search).get("bank");
  const compareParam = new URLSearchParams(location.search).get("compare");
  readStateFromUrl();
  renderShell();
  renderAll();
  syncUrl();
  wireScroll();

  // Deep-link: ?bank=<id> opens that bank's detail modal on load.
  if (bankParam && dataset.banks.some((b) => b.id === bankParam)) {
    openBankDetail(bankParam);
  }
  // Deep-link: ?compare=sbi,pnb opens the compare view.
  if (compareParam) {
    const [a, b] = compareParam.split(",");
    if (
      dataset.banks.some((x) => x.id === a) &&
      dataset.banks.some((x) => x.id === b)
    ) {
      openCompare(a, b);
    }
  }
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

  // ---- Sticky nav (with responsive hamburger drawer) ----
  const navLink = (href: string, label: string, key: string) =>
    el("a", { class: `nav-link${key === "home" ? " nav-active" : ""}`, href }, [
      label,
    ]);
  root.append(
    el("nav", { class: "nav", id: "nav" }, [
      el("div", { class: "container nav-inner" }, [
        el("a", { class: "brand", href: "./" }, [
          el("span", { class: "brand-mark", html: brandMarkSvg() }),
          el("span", {
            class: "brand-word",
            html: `Rate<span class="brand-accent">Radar</span>`,
          }),
        ]),
        el("div", { class: "nav-links" }, [
          navLink("./", "Compare", "home"),
          navDropdown("Fixed Deposits", "fixed-deposit/", [
            { href: "fixed-deposit/", label: "All FD rates" },
            ...TENURE_LINKS,
            { href: "senior-citizen-fd-rates/", label: "Senior citizen FD" },
          ]),
          navLink("savings-account/", "Savings", "savings"),
          navLink("recurring-deposit/", "Recurring", "rd"),
          navLink("banks/", "Banks", "banks"),
          navLink("rate-movements/", "Movements", "movements"),
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
        ]),
        (() => {
          const b = el(
            "button",
            {
              class: "nav-burger",
              id: "nav-burger",
              "aria-label": "Menu",
              "aria-expanded": "false",
            },
            [el("span", {}), el("span", {}), el("span", {})],
          );
          return b;
        })(),
      ]),
      el("div", { class: "nav-drawer", id: "nav-drawer" }, [
        navLink("./", "Compare all", "home"),
        el("div", { class: "drawer-group" }, ["Fixed Deposits"]),
        navLink("fixed-deposit/", "All FD rates", "fd"),
        ...TENURE_LINKS.map((t) =>
          el("a", { class: "nav-link nav-sub", href: t.href }, [t.label]),
        ),
        navLink("senior-citizen-fd-rates/", "Senior citizen FD", "senior"),
        el("div", { class: "drawer-group" }, ["Other products"]),
        navLink("savings-account/", "Savings account rates", "savings"),
        navLink("recurring-deposit/", "Recurring Deposit rates", "rd"),
        el("div", { class: "drawer-group" }, ["Banks"]),
        navLink("banks/", "All banks", "banks"),
        el("div", { class: "drawer-group" }, ["Insights"]),
        navLink("rate-movements/", "Rate movements", "movements"),
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
        html: `Find the <span class="grad">highest deposit rate</span> across India's public sector, private, small finance, payments and foreign banks.`,
      }),
      el("p", { class: "hero-sub" }, [
        "Compare Fixed Deposit, Savings and Recurring Deposit rates across India's public sector, private, small finance, payments and foreign banks — filtered to your exact amount and tenure, with rates verified from official bank sources.",
      ]),
      movementsStrip(),
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

  // ---- Explore (discoverable landing pages) ----
  root.append(renderExplore());

  // ---- Footer ----
  root.append(
    el("footer", { class: "site-footer" }, [
      el("div", { class: "container" }, [
        el("div", { class: "footer-grid" }, [
          el("div", {}, [
            el("div", { class: "brand", style: "margin-bottom:10px" }, [
              el("span", { class: "brand-mark", html: brandMarkSvg() }),
              el("span", {
                class: "brand-word",
                html: `Rate<span class="brand-accent">Radar</span>`,
              }),
            ]),
            el("p", { class: "muted" }, [
              "Deposit rates across India's public sector, private, small finance, payments and foreign banks. Informational only — always verify on the bank's official website before investing.",
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

const TENURE_LINKS = [
  { href: "fixed-deposit/6-months/", label: "6 months" },
  { href: "fixed-deposit/1-year/", label: "1 year" },
  { href: "fixed-deposit/2-year/", label: "2 years" },
  { href: "fixed-deposit/3-year/", label: "3 years" },
  { href: "fixed-deposit/5-year/", label: "5 years" },
];

function caretSvg(): string {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-left:2px"><path d="M6 9l6 6 6-6"/></svg>`;
}

/** A hover/focus dropdown nav item. */
function navDropdown(
  label: string,
  href: string,
  items: { href: string; label: string }[],
  twoCol = false,
): HTMLElement {
  const trigger = el("a", {
    class: "nav-link",
    href,
    "aria-haspopup": "true",
    html: `${label} ${caretSvg()}`,
  });
  const menu = el("div", {
    class: `nav-dd-menu${twoCol ? " nav-dd-menu-2col" : ""}`,
  });
  for (const it of items) {
    menu.append(el("a", { class: "nav-dd-item", href: it.href }, [it.label]));
  }
  return el("div", { class: "nav-dd" }, [trigger, menu]);
}

/** Distinctive radar-arc brand mark (matches the favicon). */
function brandMarkSvg(): string {
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <path d="M28 66 A24 24 0 0 1 66 34" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.5"/>
    <path d="M34 66 A18 18 0 0 1 60 41" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.85"/>
    <circle cx="66" cy="66" r="7.5" fill="white"/>
  </svg>`;
}

/** Hero strip summarising recent rate changes (links to /rate-movements/). */
function movementsStrip(): Node | string {
  const changes = recentChanges(rateHistory);
  if (changes.length === 0) return ""; // nothing to show until data accrues
  const banks = banksChangedCount(rateHistory);
  const ups = changes.filter((c) => c.delta > 0).length;
  const downs = changes.filter((c) => c.delta < 0).length;
  const upTri = `<svg viewBox="0 0 10 10" width="9" height="9" style="vertical-align:0"><path d="M5 1l4 7H1z" fill="currentColor"/></svg>`;
  const downTri = `<svg viewBox="0 0 10 10" width="9" height="9" style="vertical-align:0"><path d="M5 9L1 2h8z" fill="currentColor"/></svg>`;
  const arrow = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
  const parts: string[] = [];
  if (ups) parts.push(`<span class="mv-up">${upTri} ${ups} raised</span>`);
  if (downs) parts.push(`<span class="mv-down">${downTri} ${downs} cut</span>`);
  const a = el("a", {
    class: "movements-strip",
    href: "rate-movements/",
    html:
      `<span class="mv-badge">Rates on the move</span>` +
      `<span class="mv-text"><strong>${banks}</strong> bank${banks === 1 ? "" : "s"} recently changed rates</span>` +
      `<span class="mv-nums">${parts.join(" · ")}</span>` +
      `<span class="mv-go">View all ${arrow}</span>`,
  });
  return a;
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

  // Mobile hamburger drawer.
  const burger = document.getElementById("nav-burger");
  const drawer = document.getElementById("nav-drawer");
  if (burger && drawer) {
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("drawer-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    drawer.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a"))
        nav.classList.remove("drawer-open");
    });
  }
}

// ---- Share ----------------------------------------------------------------

function shareIconSvg(): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>`;
}

async function shareCurrentView(
  btn: HTMLElement,
  bankId?: string,
): Promise<void> {
  syncUrl();
  let url = location.href;
  if (bankId) {
    const p = new URLSearchParams(location.search);
    p.set("bank", bankId);
    url = `${location.origin}${location.pathname}?${p.toString()}`;
  }
  const ok = await copyText(url);
  if (navigator.share && !ok) {
    try {
      await navigator.share({ title: "RateRadar", url });
      return;
    } catch {
      /* user cancelled */
    }
  }
  toast(ok ? "Link copied to clipboard" : "Copy this link:\n" + url, ok);
  flashCopied(btn);
}

/** Briefly swap a share button's label to "Copied!" for inline feedback. */
function flashCopied(btn: HTMLElement): void {
  btn.classList.add("copied");
  const label = btn.querySelector(".share-label");
  const prev = label?.textContent ?? null;
  if (label) label.textContent = "Copied!";
  setTimeout(() => {
    btn.classList.remove("copied");
    if (label && prev !== null) label.textContent = prev;
  }, 1500);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function toast(msg: string, success = true): void {
  document.getElementById("toast")?.remove();
  const t = el(
    "div",
    { class: `toast${success ? " toast-ok" : ""}`, id: "toast" },
    [
      success ? el("span", { class: "toast-check" }, ["✓"]) : "",
      el("span", {}, [msg]),
    ],
  );
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
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
        apply(true);
      },
    ),
  );

  const customers = [
    { v: "GENERAL", label: "General" },
    { v: "SENIOR", label: "Senior (60+)" },
  ];
  host.append(
    segControl("Customer", customers, state.customer, (v) => {
      state.customer = v as CustomerCategory;
      apply(true);
    }),
  );

  const sectors = [
    { v: "ALL", label: "All" },
    { v: "PUBLIC", label: "Public sector" },
    { v: "PRIVATE", label: "Private" },
    { v: "SMALL_FINANCE", label: "Small finance" },
    { v: "PAYMENTS_BANK", label: "Payments bank" },
    { v: "FOREIGN", label: "Foreign" },
  ];
  host.append(
    segControl("Sector", sectors, state.category, (v) => {
      state.category = v as SectorFilter;
      state.showAll = false;
      apply(true);
    }),
  );

  host.append(renderAmountControl());

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
          apply(true);
        }),
      );
    }
    tenGroup.append(tenChips);
    host.append(tenGroup);
  }
}

/** Re-render results; optionally re-render controls too; always sync URL. */
function apply(rerenderControls = false): void {
  if (rerenderControls) renderControls();
  renderAll();
  syncUrl();
}

/** Amount control: editable input + slider + quick-pick presets. */
function renderAmountControl(): HTMLElement {
  const group = el("div", { class: "control control-amount" }, [
    el("label", {}, ["Deposit amount"]),
  ]);

  const input = el("input", {
    class: "amount-input",
    type: "text",
    inputmode: "numeric",
    "aria-label": "Deposit amount in rupees",
    value: formatINRFull(state.amount),
  }) as HTMLInputElement;

  // Log-scaled slider so ₹1k–₹5cr feels natural across the range.
  const slider = el("input", {
    class: "amount-slider",
    type: "range",
    min: "0",
    max: "1000",
    step: "1",
    value: String(amountToSlider(state.amount)),
    "aria-label": "Deposit amount slider",
  }) as HTMLInputElement;

  const row = el("div", { class: "amount-row" }, [
    el("span", { class: "amount-prefix" }, ["₹"]),
    input,
  ]);

  const commitFromInput = () => {
    const parsed = parseAmountInput(input.value);
    if (parsed != null) {
      state.amount = clampAmount(parsed);
    }
    input.value = formatINRFull(state.amount);
    slider.value = String(amountToSlider(state.amount));
    apply();
  };
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") input.blur();
  });
  input.addEventListener("blur", commitFromInput);

  slider.addEventListener("input", () => {
    state.amount = sliderToAmount(Number(slider.value));
    input.value = formatINRFull(state.amount);
    // live-update results while dragging, but don't spam URL history
    renderAll();
  });
  slider.addEventListener("change", () => syncUrl());

  const chips = el("div", { class: "chips chips-sm" });
  for (const preset of AMOUNT_PRESETS) {
    chips.append(
      chip(preset.label, state.amount === preset.amount, () => {
        state.amount = preset.amount;
        apply(true);
      }),
    );
  }

  group.append(row, slider, chips);
  return group;
}

// Map amount <-> slider position (0..1000) on a log scale.
function amountToSlider(amount: number): number {
  const a = Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, amount));
  const t =
    (Math.log(a) - Math.log(MIN_AMOUNT)) /
    (Math.log(MAX_AMOUNT) - Math.log(MIN_AMOUNT));
  return Math.round(t * 1000);
}
function sliderToAmount(pos: number): number {
  const t = pos / 1000;
  const raw = Math.exp(
    Math.log(MIN_AMOUNT) + t * (Math.log(MAX_AMOUNT) - Math.log(MIN_AMOUNT)),
  );
  // Snap to sensible round steps for a clean feel.
  const step =
    raw < 100000
      ? 5000
      : raw < 1000000
        ? 25000
        : raw < 10000000
          ? 100000
          : 500000;
  return clampAmount(Math.round(raw / step) * step);
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

/** Map the UI sector filter to the query category (ALL -> undefined). */
function selectedCategory():
  | "PUBLIC"
  | "PRIVATE"
  | "SMALL_FINANCE"
  | "PAYMENTS_BANK"
  | "FOREIGN"
  | undefined {
  return state.category === "ALL" ? undefined : state.category;
}

function query(): RateQuery {
  return {
    product: state.product,
    customer: state.customer,
    amount: state.amount,
    tenureDays: state.product === "SAVINGS" ? undefined : state.tenureDays,
    category: selectedCategory(),
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
  const overall = headlineRate(
    dataset,
    state.product,
    state.customer,
    selectedCategory(),
  );

  const feature = el("div", { class: "hl-cell" }, [
    el("div", { class: "hl-label" }, ["Top rate for your selection"]),
    el(
      "div",
      {
        class: "hl-value",
        "data-count": top ? String(top.entry.ratePercent) : "0",
        style: top ? `color:${top.bank.color}` : "",
      },
      [top ? "0.00%" : "—"],
    ),
    el("div", { class: "hl-sub" }, [
      top
        ? `${top.bank.name}${top.entry.scheme ? " · " + top.entry.scheme : ""}`
        : "No matching product",
    ]),
  ]);

  const overallCell = el("div", { class: "hl-cell feature" }, [
    el("div", { class: "hl-label" }, [
      `Best ${productLabel(state.product)} overall`,
    ]),
    el(
      "div",
      {
        class: "hl-value",
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

  host.append(overallCell, feature, trustCell);
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
        class: `podium-card clickable${r.rank === 1 ? " first" : ""}`,
        style: `--bank:${r.bank.color}`,
        role: "button",
        tabindex: "0",
        title: `View all ${r.bank.name} rates`,
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
    card.addEventListener("click", () => openBankDetail(r.bank.id));
    card.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        openBankDetail(r.bank.id);
      }
    });
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
    category: selectedCategory(),
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

// ---- Sorting --------------------------------------------------------------

function sortRanked(
  ranked: ReturnType<typeof rankBanks>,
): ReturnType<typeof rankBanks> {
  const dir = state.sortDir === "asc" ? 1 : -1;
  const copy = [...ranked];
  copy.sort((a, b) => {
    let cmp = 0;
    if (state.sortKey === "rate")
      cmp = a.entry.ratePercent - b.entry.ratePercent;
    else if (state.sortKey === "name")
      cmp = a.bank.name.localeCompare(b.bank.name);
    else if (state.sortKey === "effective")
      cmp = a.entry.source.effectiveDate.localeCompare(
        b.entry.source.effectiveDate,
      );
    return cmp * dir;
  });
  return copy;
}

function sortableTh(label: string, key: SortKey, num = false): HTMLElement {
  const active = state.sortKey === key;
  const arrow = active ? (state.sortDir === "asc" ? " ↑" : " ↓") : "";
  const th = el(
    "th",
    {
      class: `sortable${num ? " num" : ""}${active ? " sort-active" : ""}`,
      role: "button",
      tabindex: "0",
      title: `Sort by ${label.toLowerCase()}`,
    },
    [label + arrow],
  );
  const onSort = () => {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      // sensible default direction per column
      state.sortDir = key === "name" ? "asc" : "desc";
    }
    renderTable();
    syncUrl();
  };
  th.addEventListener("click", onSort);
  th.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      onSort();
    }
  });
  return th;
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

  // Apply sort. Default (rate desc) preserves the ranked order & medals.
  const sorted = sortRanked(ranked);
  const rows = state.showAll ? sorted : sorted.slice(0, 5);

  const table = el("table", { class: "rate-table" });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["#"]),
        sortableTh("Bank", "name"),
        sortableTh("Rate", "rate", true),
        el("th", {}, ["Applies to"]),
        sortableTh("Effective", "effective"),
      ]),
    ]),
  );

  // Medals (rate-rank badges) only make sense in the default rate-desc view.
  const showMedals = state.sortKey === "rate" && state.sortDir === "desc";
  const tbody = el("tbody");
  rows.forEach((r, i) => {
    const detail = r.entry.scheme
      ? `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)} · ${r.entry.scheme}`
      : `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)}`;
    const tr = el(
      "tr",
      {
        class: `row-clickable${showMedals && r.rank === 1 ? " top-row" : ""}`,
        title: `View all ${r.bank.name} rates`,
      },
      [
        el("td", {}, [
          showMedals && r.rank <= 3
            ? el("span", { class: `medal medal-${r.rank}` }, [String(r.rank)])
            : el("span", { class: "rank" }, [
                String(showMedals ? r.rank : i + 1),
              ]),
        ]),
        el("td", {}, [
          el("div", { class: "bank-cell" }, [
            el("span", {
              class: "bank-dot",
              style: `--bank:${r.bank.color};background:${r.bank.color}`,
            }),
            el("div", {}, [
              el(
                "a",
                { class: "bank-name bank-link", href: `bank/${r.bank.id}/` },
                [r.bank.name],
              ),
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
      ],
    );
    // Row opens the quick modal; the bank-name link navigates to the full page.
    tr.querySelector(".bank-link")?.addEventListener("click", (e) =>
      e.stopPropagation(),
    );
    tr.addEventListener("click", () => openBankDetail(r.bank.id));
    tbody.append(tr);
  });
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

// ---- Explore section (links to the generated landing/profile pages) -------

function renderExplore(): HTMLElement {
  const section = el("section", { class: "container block", id: "explore" });
  section.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { class: "section-title" }, ["Explore rate pages"]),
        el("p", { class: "section-note" }, [
          "Dedicated, shareable pages for each product, tenure and bank.",
        ]),
      ]),
    ]),
  );

  // Product cards
  const products: {
    href: string;
    title: string;
    sub: string;
    key: ProductType;
  }[] = [
    {
      href: "fixed-deposit/",
      title: "Fixed Deposits",
      sub: "Best FD rates, all tenures",
      key: "FD",
    },
    {
      href: "savings-account/",
      title: "Savings accounts",
      sub: "Savings interest rates",
      key: "SAVINGS",
    },
    {
      href: "recurring-deposit/",
      title: "Recurring Deposits",
      sub: "Best RD rates",
      key: "RD",
    },
  ];
  const pgrid = el("div", { class: "explore-products" });
  for (const p of products) {
    const top = headlineRate(dataset, p.key, "GENERAL");
    pgrid.append(
      el("a", { class: "explore-card", href: p.href }, [
        el("div", { class: "explore-card-title" }, [p.title]),
        el("div", { class: "explore-card-sub muted" }, [p.sub]),
        el("div", { class: "explore-card-rate" }, [
          top ? `up to ${formatRate(top.entry.ratePercent)}` : "",
        ]),
      ]),
    );
  }
  section.append(pgrid);

  // Tenure chips
  section.append(
    el("div", { class: "explore-label muted" }, ["Best FD by tenure"]),
  );
  const tchips = el("div", { class: "chips" });
  for (const t of TENURE_LINKS) {
    tchips.append(el("a", { class: "chip", href: t.href }, [t.label]));
  }
  tchips.append(
    el("a", { class: "chip", href: "senior-citizen-fd-rates/" }, [
      "Senior citizen",
    ]),
  );
  section.append(tchips);

  // Compare-two-banks launcher
  section.append(el("div", { class: "explore-label muted" }, ["Head to head"]));
  const cmpRow = el("div", { class: "compare-launch" }, [
    el("span", { class: "muted" }, [
      "Compare any two banks side by side across every tenure.",
    ]),
    (() => {
      const b = el("button", { class: "reveal-btn", type: "button" }, [
        "Compare two banks",
      ]);
      b.addEventListener("click", () => openCompare());
      return b;
    })(),
  ]);
  section.append(cmpRow);

  // Bank grid
  section.append(
    el("div", { class: "explore-label muted" }, ["Browse by bank"]),
  );
  const bgrid = el("div", { class: "explore-banks" });
  // Teaser: top few banks by best FD rate, then a link to the full directory
  // (scales cleanly however many banks we track).
  const topBanks = rankBanks(dataset, {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: 365,
  }).slice(0, 6);
  for (const r of topBanks) {
    bgrid.append(
      el(
        "a",
        {
          class: "explore-bank",
          href: `bank/${r.bank.id}/`,
          title: r.bank.name,
        },
        [
          el("span", {
            class: "bank-dot",
            style: `--bank:${r.bank.color};background:${r.bank.color}`,
          }),
          el("span", {}, [r.bank.shortName]),
        ],
      ),
    );
  }
  bgrid.append(
    el("a", { class: "explore-bank explore-bank-all", href: "banks/" }, [
      `All ${dataset.banks.length} banks →`,
    ]),
  );
  section.append(bgrid);
  return section;
}

// ---- Compare two banks ----------------------------------------------------

const compareState = { a: "", b: "", product: "FD" as ProductType };

function openCompare(a?: string, b?: string): void {
  const banks = dataset.banks;
  compareState.a = a || compareState.a || banks[0].id;
  compareState.b = b || compareState.b || banks[1].id;

  const overlay = el(
    "div",
    {
      class: "modal-overlay",
      id: "modal-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Compare two banks",
    },
    [],
  );
  const card = el("div", { class: "modal-card compare-card" });
  overlay.append(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  modalReturnFocus = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onModalKeydown, true);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const bankSelect = (which: "a" | "b") => {
    const sel = el("select", {
      class: "cmp-select",
      "aria-label": `Bank ${which}`,
    }) as HTMLSelectElement;
    for (const bk of banks) {
      const opt = el("option", { value: bk.id }, [
        bk.name,
      ]) as HTMLOptionElement;
      if (bk.id === compareState[which]) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      compareState[which] = sel.value;
      draw();
    });
    return sel;
  };

  const prodSeg = el("div", { class: "segment" });
  const drawProd = () => {
    prodSeg.innerHTML = "";
    for (const p of ["FD", "RD", "SAVINGS"] as ProductType[]) {
      const btn = el(
        "button",
        {
          class: `seg-btn${compareState.product === p ? " active" : ""}`,
          type: "button",
        },
        [productLabel(p)],
      );
      btn.addEventListener("click", () => {
        compareState.product = p;
        draw();
      });
      prodSeg.append(btn);
    }
  };

  function draw(): void {
    drawProd();
    const bankA = banks.find((x) => x.id === compareState.a)!;
    const bankB = banks.find((x) => x.id === compareState.b)!;
    const rowsFor = (id: string) =>
      dataset.rates.filter(
        (r) =>
          r.bankId === id &&
          r.product === compareState.product &&
          r.customer === "GENERAL",
      );
    const ra = rowsFor(bankA.id);
    const rb = rowsFor(bankB.id);
    // union of tenures, sorted
    const tkeys = new Map<string, { min: number; label: string }>();
    for (const r of [...ra, ...rb])
      tkeys.set(`${r.tenure.minDays}-${r.tenure.maxDays}-${r.scheme || ""}`, {
        min: r.tenure.minDays,
        label: r.tenure.label + (r.scheme ? ` · ${r.scheme}` : ""),
      });
    const keys = [...tkeys.entries()].sort((x, y) => x[1].min - y[1].min);
    const rateAt = (rows: typeof ra, key: string) => {
      const r = rows.find(
        (x) =>
          `${x.tenure.minDays}-${x.tenure.maxDays}-${x.scheme || ""}` === key,
      );
      return r ? r.ratePercent : null;
    };
    const body = keys
      .map(([key, meta]) => {
        const va = rateAt(ra, key);
        const vb = rateAt(rb, key);
        const win =
          va != null && vb != null ? (va > vb ? "a" : vb > va ? "b" : "") : "";
        return `<tr>
          <td class="muted">${meta.label}</td>
          <td class="num rate-cell ${win === "a" ? "cmp-win" : ""}" style="color:${bankA.color}">${va != null ? formatRate(va) : "—"}</td>
          <td class="num rate-cell ${win === "b" ? "cmp-win" : ""}" style="color:${bankB.color}">${vb != null ? formatRate(vb) : "—"}</td>
        </tr>`;
      })
      .join("");

    card.innerHTML = "";
    const head = el("div", { class: "modal-head" }, [
      el("div", { class: "modal-title" }, ["Compare two banks"]),
    ]);
    const close = el(
      "button",
      { class: "modal-close", "aria-label": "Close" },
      ["✕"],
    );
    close.addEventListener("click", closeModal);
    head.append(close);
    card.append(head);

    const pickers = el("div", { class: "cmp-pickers" }, [
      bankSelect("a"),
      el("span", { class: "cmp-vs" }, ["vs"]),
      bankSelect("b"),
    ]);
    card.append(pickers, el("div", { class: "cmp-prod" }, [prodSeg]));

    const table = el("div", {
      class: "table-wrap",
      html: `<table class="rate-table"><thead><tr>
        <th>Tenure</th>
        <th class="num"><span class="bank-dot" style="background:${bankA.color}"></span> ${escapeHtml(bankA.shortName)}</th>
        <th class="num"><span class="bank-dot" style="background:${bankB.color}"></span> ${escapeHtml(bankB.shortName)}</th>
      </tr></thead><tbody>${body || `<tr><td colspan="3" class="muted" style="text-align:center;padding:24px">No matching rates.</td></tr>`}</tbody></table>`,
    });
    card.append(table);
    card.append(
      el("div", { class: "modal-source" }, [
        el("span", { class: "muted" }, [
          "General public · below ₹3 crore · winning rate highlighted",
        ]),
      ]),
    );
  }

  draw();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Per-bank detail modal -----------------------------------------------

function openBankDetail(bankId: string): void {
  const bank = dataset.banks.find((b) => b.id === bankId);
  if (!bank) return;

  // All of this bank's rates for the current product + customer, any amount/tenure.
  const rows = dataset.rates
    .filter(
      (e) =>
        e.bankId === bankId &&
        e.product === state.product &&
        e.customer === state.customer,
    )
    .sort(
      (a, b) =>
        a.tenure.minDays - b.tenure.minDays || b.ratePercent - a.ratePercent,
    );

  const src = rows[0]?.source;

  const body = el("div", { class: "modal-body" });
  if (rows.length === 0) {
    body.append(
      el("div", { class: "empty" }, [
        `No ${productLabel(state.product)} rates listed for ${bank.name} (${customerLabel(state.customer)}).`,
      ]),
    );
  } else {
    const t = el("table", { class: "rate-table modal-table" });
    t.append(
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["Tenure"]),
          el("th", {}, ["Applies to"]),
          el("th", { class: "num" }, ["Rate"]),
        ]),
      ]),
    );
    const tb = el("tbody");
    for (const e of rows) {
      tb.append(
        el("tr", {}, [
          el("td", {}, [
            el("div", { class: "bank-name" }, [e.tenure.label]),
            e.scheme
              ? el("div", { class: "bank-short muted" }, [e.scheme])
              : "",
          ]),
          el("td", { class: "muted" }, [amountLabel(e.amount)]),
          el("td", { class: "num rate-cell", style: `color:${bank.color}` }, [
            formatRate(e.ratePercent),
          ]),
        ]),
      );
    }
    t.append(tb);
    body.append(el("div", { class: "table-wrap" }, [t]));
  }

  const sourceLine = el("div", { class: "modal-source" }, [
    ...(src
      ? [
          qualityTag(src.quality),
          el("span", { class: "muted" }, [
            ` Effective ${formatDate(src.effectiveDate)} · `,
          ]),
          el(
            "a",
            {
              href: src.url,
              target: "_blank",
              rel: "noopener",
              class: "modal-link",
            },
            ["View source ↗"],
          ),
          el("span", { class: "muted" }, [" · "]),
        ]
      : []),
    el("a", {
      class: "modal-link",
      href: `bank/${bank.id}/`,
      html: `Full profile <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`,
    }),
  ]);

  const modal = el(
    "div",
    { class: "modal-card", style: `--bank:${bank.color}` },
    [
      el("div", { class: "modal-head" }, [
        el("div", { class: "modal-bank" }, [
          el("span", {
            class: "bank-dot",
            style: `--bank:${bank.color};background:${bank.color}`,
          }),
          el("div", {}, [
            el("div", { class: "modal-title" }, [bank.name]),
            el("div", { class: "modal-sub muted" }, [
              `${productLabel(state.product)} rates · ${customerLabel(state.customer)}`,
            ]),
          ]),
        ]),
        (() => {
          const actions = el("div", { class: "modal-actions" });
          const share = el(
            "button",
            {
              class: "modal-share",
              type: "button",
              title: "Copy a link to this bank",
            },
            [el("span", { html: shareIconSvg() })],
          );
          share.addEventListener("click", () =>
            shareCurrentView(share, bankId),
          );
          const x = el(
            "button",
            { class: "modal-close", "aria-label": "Close" },
            ["✕"],
          );
          x.addEventListener("click", closeModal);
          actions.append(share, x);
          return actions;
        })(),
      ]),
      body,
      sourceLine,
    ],
  );

  const overlay = el(
    "div",
    {
      class: "modal-overlay",
      id: "modal-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `${bank.name} deposit rates`,
    },
    [modal],
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  // Remember what had focus so we can restore it on close (a11y).
  modalReturnFocus = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onModalKeydown, true);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  // Move focus into the modal (the close button).
  (modal.querySelector(".modal-close") as HTMLElement | null)?.focus();
}

let modalReturnFocus: HTMLElement | null = null;

/** Esc to close + Tab focus trap within the open modal. */
function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key !== "Tab") return;
  const modal = document.querySelector("#modal-overlay .modal-card");
  if (!modal) return;
  const focusables = Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button, a[href], input, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function closeModal(): void {
  const o = document.getElementById("modal-overlay");
  if (o) o.remove();
  document.removeEventListener("keydown", onModalKeydown, true);
  document.body.style.overflow = "";
  // Restore focus to whatever opened the modal.
  if (modalReturnFocus && document.contains(modalReturnFocus)) {
    modalReturnFocus.focus();
  }
  modalReturnFocus = null;
}

boot().catch((err) => {
  const root = document.getElementById("app");
  if (root)
    root.innerHTML = `<div class="container"><div class="banner banner-warn">Failed to load data: ${String(err)}</div></div>`;
});
