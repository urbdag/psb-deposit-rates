import { AMOUNT_PRESETS, TENURE_PRESETS, bestByTenure, headlineRate, rankBanks, } from "./query.js";
import { amountLabel, formatDate, formatINR, formatRate, productLabel, } from "./format.js";
const state = {
    product: "FD",
    customer: "GENERAL",
    amount: 500000,
    tenureDays: 365,
};
let dataset;
async function boot() {
    const res = await fetch("data/dataset.json");
    dataset = (await res.json());
    renderShell();
    renderAll();
}
function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class")
            node.className = v;
        else if (k === "html")
            node.innerHTML = v;
        else
            node.setAttribute(k, v);
    }
    for (const c of children)
        node.append(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
}
function renderShell() {
    const root = document.getElementById("app");
    root.innerHTML = "";
    // Header
    const header = el("header", { class: "site-header" }, [
        el("div", { class: "container header-inner" }, [
            el("div", { class: "brand" }, [
                el("span", { class: "brand-mark", html: "₹" }),
                el("div", {}, [
                    el("h1", { class: "brand-title" }, ["PSB Deposit Rates"]),
                    el("p", { class: "brand-sub" }, [
                        "Best FD, Savings & RD rates across India's 12 public sector banks",
                    ]),
                ]),
            ]),
        ]),
    ]);
    root.append(header);
    if (dataset.containsSampleData) {
        root.append(el("div", { class: "container" }, [
            el("div", { class: "banner banner-warn", id: "sample-banner" }, [
                el("strong", {}, ["Sample data. "]),
                "Rates shown are representative placeholders for demonstration and are not sourced from the banks. Do not use for financial decisions — see the README to load official rates.",
            ]),
        ]));
    }
    // Controls
    const controls = el("section", { class: "container" }, [
        el("div", { class: "controls", id: "controls" }),
    ]);
    root.append(controls);
    // Content regions
    root.append(el("section", { class: "container", id: "headline-region" }));
    root.append(el("section", { class: "container", id: "leaderboard-region" }));
    root.append(el("section", { class: "container", id: "table-region" }));
    // Footer
    root.append(el("footer", { class: "site-footer" }, [
        el("div", { class: "container" }, [
            el("p", {}, [
                `Dataset generated ${formatDate(dataset.generatedAt)} · ${dataset.banks.length} banks · ${dataset.rates.length} rate entries`,
            ]),
            el("p", { class: "muted" }, [
                "Scope: State Bank of India + the 11 nationalised banks. Verify all rates on the bank's official website before investing.",
            ]),
        ]),
    ]));
    renderControls();
}
function renderControls() {
    const host = document.getElementById("controls");
    host.innerHTML = "";
    // Product segmented control
    const products = ["FD", "RD", "SAVINGS"];
    const productGroup = el("div", { class: "control" }, [
        el("label", {}, ["Product"]),
    ]);
    const seg = el("div", { class: "segment" });
    for (const p of products) {
        const b = el("button", {
            class: `seg-btn${state.product === p ? " active" : ""}`,
            type: "button",
        }, [productLabel(p)]);
        b.addEventListener("click", () => {
            state.product = p;
            renderControls();
            renderAll();
        });
        seg.append(b);
    }
    productGroup.append(seg);
    host.append(productGroup);
    // Customer segmented control
    const customers = [
        { c: "GENERAL", label: "General" },
        { c: "SENIOR", label: "Senior (60+)" },
        { c: "SUPER_SENIOR", label: "Super senior (80+)" },
    ];
    const custGroup = el("div", { class: "control" }, [
        el("label", {}, ["Customer"]),
    ]);
    const custSeg = el("div", { class: "segment" });
    for (const { c, label } of customers) {
        const b = el("button", {
            class: `seg-btn${state.customer === c ? " active" : ""}`,
            type: "button",
        }, [label]);
        b.addEventListener("click", () => {
            state.customer = c;
            renderControls();
            renderAll();
        });
        custSeg.append(b);
    }
    custGroup.append(custSeg);
    host.append(custGroup);
    // Amount
    const amtGroup = el("div", { class: "control" }, [
        el("label", {}, ["Deposit amount"]),
    ]);
    const amtChips = el("div", { class: "chips" });
    for (const preset of AMOUNT_PRESETS) {
        const b = el("button", {
            class: `chip${state.amount === preset.amount ? " active" : ""}`,
            type: "button",
        }, [preset.label]);
        b.addEventListener("click", () => {
            state.amount = preset.amount;
            renderControls();
            renderAll();
        });
        amtChips.append(b);
    }
    amtGroup.append(amtChips);
    host.append(amtGroup);
    // Tenure (hidden for savings)
    if (state.product !== "SAVINGS") {
        const tenGroup = el("div", { class: "control" }, [
            el("label", {}, ["Tenure"]),
        ]);
        const tenChips = el("div", { class: "chips" });
        for (const preset of TENURE_PRESETS) {
            const b = el("button", {
                class: `chip${state.tenureDays === preset.days ? " active" : ""}`,
                type: "button",
            }, [preset.label]);
            b.addEventListener("click", () => {
                state.tenureDays = preset.days;
                renderControls();
                renderAll();
            });
            tenChips.append(b);
        }
        tenGroup.append(tenChips);
        host.append(tenGroup);
    }
}
function query() {
    return {
        product: state.product,
        customer: state.customer,
        amount: state.amount,
        tenureDays: state.product === "SAVINGS" ? undefined : state.tenureDays,
    };
}
function renderAll() {
    renderHeadline();
    renderLeaderboard();
    renderTable();
}
function renderHeadline() {
    const host = document.getElementById("headline-region");
    host.innerHTML = "";
    const top = rankBanks(dataset, query())[0];
    const overall = headlineRate(dataset, state.product, state.customer);
    const cards = el("div", { class: "headline-grid" });
    if (top) {
        cards.append(statCard("Top rate for your selection", formatRate(top.entry.ratePercent), `${top.bank.name}${top.entry.scheme ? ` · ${top.entry.scheme}` : ""}`, top.bank.color));
    }
    else {
        cards.append(statCard("Top rate for your selection", "—", "No matching product", "#888"));
    }
    cards.append(statCard(`Overall best ${productLabel(state.product)}`, overall ? formatRate(overall.entry.ratePercent) : "—", overall ? `${overall.bank.name} · ${overall.entry.tenure.label}` : "—", overall ? overall.bank.color : "#888"));
    cards.append(statCard("Banks compared", String(dataset.banks.length), "State Bank of India + nationalised banks", "#334155"));
    host.append(el("h2", { class: "section-title" }, ["Overview"]), cards);
}
function statCard(label, value, sub, color) {
    return el("div", { class: "stat-card", style: `--accent:${color}` }, [
        el("div", { class: "stat-label" }, [label]),
        el("div", { class: "stat-value" }, [value]),
        el("div", { class: "stat-sub" }, [sub]),
    ]);
}
function renderLeaderboard() {
    const host = document.getElementById("leaderboard-region");
    host.innerHTML = "";
    if (state.product === "SAVINGS")
        return; // tenure leaderboard not meaningful for savings
    host.append(el("h2", { class: "section-title" }, ["Best rate by tenure"]));
    host.append(el("p", { class: "section-note" }, [
        `${productLabel(state.product)} · ${customerLabel(state.customer)} · ${formatINR(state.amount)}`,
    ]));
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
            card.append(el("div", { class: "tenure-rate", style: `color:${row.top.bank.color}` }, [formatRate(row.top.entry.ratePercent)]), el("div", { class: "tenure-bank" }, [row.top.bank.shortName]));
        }
        else {
            card.append(el("div", { class: "tenure-rate muted" }, ["—"]));
        }
        grid.append(card);
    }
    host.append(grid);
}
function customerLabel(c) {
    return c === "GENERAL"
        ? "General public"
        : c === "SENIOR"
            ? "Senior citizen"
            : "Super senior";
}
function renderTable() {
    const host = document.getElementById("table-region");
    host.innerHTML = "";
    const ranked = rankBanks(dataset, query());
    host.append(el("h2", { class: "section-title" }, ["Bank comparison"]));
    host.append(el("p", { class: "section-note" }, [
        state.product === "SAVINGS"
            ? `${productLabel(state.product)} · ${customerLabel(state.customer)} · balance ${formatINR(state.amount)}`
            : `${productLabel(state.product)} · ${customerLabel(state.customer)} · ${formatINR(state.amount)} · ${TENURE_PRESETS.find((t) => t.days === state.tenureDays)?.label ?? ""}`,
    ]));
    if (ranked.length === 0) {
        host.append(el("div", { class: "empty" }, [
            "No banks offer a matching product for this selection.",
        ]));
        return;
    }
    const table = el("table", { class: "rate-table" });
    const thead = el("thead", {}, [
        el("tr", {}, [
            el("th", {}, ["#"]),
            el("th", {}, ["Bank"]),
            el("th", { class: "num" }, ["Rate"]),
            el("th", {}, ["Applies to"]),
            el("th", {}, ["Effective"]),
        ]),
    ]);
    table.append(thead);
    const tbody = el("tbody");
    for (const r of ranked) {
        const detail = r.entry.scheme
            ? `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)} · ${r.entry.scheme}`
            : `${r.entry.tenure.label} · ${amountLabel(r.entry.amount)}`;
        const badge = r.rank <= 3
            ? el("span", { class: `medal medal-${r.rank}` }, [String(r.rank)])
            : el("span", { class: "rank" }, [String(r.rank)]);
        tbody.append(el("tr", { class: r.rank === 1 ? "top-row" : "" }, [
            el("td", {}, [badge]),
            el("td", {}, [
                el("div", { class: "bank-cell" }, [
                    el("span", {
                        class: "bank-dot",
                        style: `background:${r.bank.color}`,
                    }),
                    el("div", {}, [
                        el("div", { class: "bank-name" }, [r.bank.name]),
                        el("div", { class: "bank-short muted" }, [r.bank.shortName]),
                    ]),
                ]),
            ]),
            el("td", { class: "num rate-cell" }, [formatRate(r.entry.ratePercent)]),
            el("td", { class: "muted" }, [detail]),
            el("td", { class: "muted" }, [
                formatDate(r.entry.source.effectiveDate),
                r.entry.source.quality === "SAMPLE"
                    ? el("span", { class: "tag" }, ["sample"])
                    : "",
            ]),
        ]));
    }
    table.append(tbody);
    host.append(el("div", { class: "table-wrap" }, [table]));
}
boot().catch((err) => {
    const root = document.getElementById("app");
    if (root)
        root.innerHTML = `<div class="container"><div class="banner banner-warn">Failed to load data: ${String(err)}</div></div>`;
});
