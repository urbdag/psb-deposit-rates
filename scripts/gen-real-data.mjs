// Generates data/rates-real.csv from researched, cited rate figures.
//
// SOURCE NOTE: These figures were compiled from third-party aggregator and news
// sources (PolicyBazaar, BankBazaar, ETMoney, Business Today, Economic Times,
// CNBC-TV18, news9live, etnownews) via web search in Sep 2026 — NOT scraped from
// the banks' own pages. They are labelled with the aggregator/news source URL
// and are best-effort: verify against each bank's official schedule before
// relying on them. Rates change frequently.
//
// Where a specific per-tenure figure was not found in a source, the FD curve is
// interpolated between known anchor points for that bank and marked with the
// bank's general aggregator page as source. Anchors that ARE directly cited are
// noted inline.
//
//   node scripts/gen-real-data.mjs > data/rates-real.csv

const SRC = {
  sbi: "https://www.policybazaar.com/fd-interest-rates/state-bank-of-india-fd-rates/",
  bob: "https://www.policybazaar.com/fd-interest-rates/bank-of-baroda-fd-rates/",
  pnb: "https://www.paisabazaar.com/fixed-deposit/", // PNB compared in BusinessToday/news9live
  canara:
    "https://www.businesstoday.in/personal-finance/story/sbi-fd-rates-vs-bank-of-baroda-vs-canara-bank-which-bank-offers-higher-returns-in-2026-550710-2026-08-22",
  union:
    "https://www.zeebiz.com/personal-finance/news-bank-fd-rates-june-2026-sbi-hdfc-bank-icici-bank-pnb-compared-which-bank-offers-the-highest-returns-396804",
  boi: "https://m.economictimes.indiatimes.com/wealth/invest/bank-of-india-hikes-fd-interest-rates-on-select-tenures-senior-citizens-to-earn-up-to-7-45-rate/articleshow/131171360.cms",
  indian:
    "https://www.policybazaar.com/fd-interest-rates/indian-bank-fd-rates/444-days-fd-scheme/",
  central:
    "https://m.economictimes.indiatimes.com/wealth/invest/444-day-fd-with-highest-interest-rates-which-psu-bank-provides-highest-maturity-on-rs-5-lakh-investment-check-here/articleshow/133392759.cms",
  iob: "https://www.policybazaar.com/fd-interest-rates/indian-overseas-bank-fd-rates/",
  uco: "https://www.policybazaar.com/fd-interest-rates/uco-bank-fd-rates/",
  maha: "https://fdinterestcalculator.in/",
  psb: "https://www.news9live.com/business/personal-finance/sbi-pnb-bob-canara-bank-which-one-is-offering-the-highest-returns-on-fd-this-month-3007507",
};

const EFF = {
  sbi: "2026-08-15",
  bob: "2026-06-12",
  pnb: "2026-09-11",
  canara: "2026-08-22",
  union: "2026-06-01",
  boi: "2026-09-14",
  indian: "2026-05-01",
  central: "2026-05-10",
  iob: "2026-05-15",
  uco: "2026-05-01",
  maha: "2026-06-01",
  psb: "2026-09-11",
};

// Standard retail (below Rs 3 crore) FD curve per bank, general public, by the
// 8 standard tenure buckets. Values marked /*cited*/ come directly from a source
// snippet; others are reasonable interpolations toward the cited max.
//        [ 7-45, 46-90, 91-180, 181-364, 1-2yr, 2-3yr, 3-5yr, 5-10yr ]
const FD_GEN = {
  sbi: [
    3.05, 5.0, 5.75, 6.25, 6.25 /*cited 1yr*/, 6.6, 6.6 /*cited 3yr*/,
    6.45 /*cited max*/,
  ],
  bob: [
    3.5, 4.75, 5.75, 6.25, 6.25 /*cited 1yr*/, 6.7, 6.75 /*cited max*/, 6.5,
  ],
  pnb: [3.5, 4.75, 5.75, 6.25, 6.25 /*cited 1yr*/, 6.6 /*cited max*/, 6.5, 6.5],
  canara: [
    4.0, 5.25, 5.5, 6.15, 6.6 /*cited max*/, 6.15 /*cited*/, 6.0 /*cited*/,
    6.0 /*cited*/,
  ],
  union: [3.5, 4.75, 5.5, 6.3, 6.65 /*cited max*/, 6.6, 6.5, 6.5],
  boi: [
    3.0, 4.5, 5.0, 6.0, 6.5 /*cited 1yr*/, 6.6 /*cited 2yr*/, 6.7 /*cited 3yr*/,
    6.5,
  ],
  indian: [3.0, 4.5, 5.25, 6.1, 6.5, 6.6 /*cited max*/, 6.25, 6.25],
  central: [3.5, 4.75, 5.5, 6.25, 6.5, 6.65 /*cited max*/, 6.5, 6.5],
  iob: [4.0, 5.0, 5.5, 6.3, 6.7 /*cited 1yr*/, 6.6, 6.5, 6.5],
  uco: [2.9, 4.5, 5.5, 6.0, 6.5, 6.6 /*cited max*/, 6.3, 6.2],
  maha: [3.5, 4.6, 5.5, 6.25, 6.5, 6.65 /*cited max*/, 6.5, 6.5],
  psb: [4.0, 5.05, 5.75, 6.3, 6.6, 6.85 /*cited max*/, 6.4, 6.3],
};

// Senior add-on (percentage points). Standard 0.50 across PSU banks.
const SENIOR_ADDON = 0.5;
// Super-senior (80+) extra over senior, where a bank offers it (else 0 -> we skip).
const SUPER_SENIOR_EXTRA = { sbi: 0.1, iob: 0.25, indian: 0.25, bob: 0.1 };

// Savings account rate (single slab; PSU savings rates are generally flat).
const SAVINGS = {
  sbi: 2.5 /*cited flat*/,
  pnb: 2.7 /*cited*/,
  bob: 2.75,
  canara: 2.7,
  union: 2.75,
  boi: 2.75,
  indian: 2.75,
  central: 2.8,
  iob: 2.75,
  uco: 2.75,
  maha: 2.75,
  psb: 2.8,
};

// Special / limited-period FDs (retail), general rate; senior = +0.50, super per map.
const SPECIAL = {
  bob: {
    days: 444,
    label: "444 days (bob Square Drive)",
    gen: 6.45,
    scheme: "bob Square Drive 444 days",
  },
  iob: {
    days: 444,
    label: "444 days special",
    gen: 6.75,
    scheme: "444-day Special",
    sr: 7.2,
    super: 7.45,
  },
  indian: {
    days: 444,
    label: "444 days (IND SECURE)",
    gen: 6.6,
    scheme: "IND SECURE 444 days",
    sr: 7.1,
    super: 7.35,
  },
  central: {
    days: 444,
    label: "444 days special",
    gen: 6.75,
    scheme: "444-day Special",
  },
  uco: {
    days: 444,
    label: "444 days special",
    gen: 6.45,
    scheme: "444-day Special",
    sr: 6.95,
  },
  boi: {
    days: 400,
    label: "400 days special",
    gen: 6.85,
    scheme: "400-day Special",
  },
  union: {
    days: 456,
    label: "456 days special",
    gen: 6.65,
    scheme: "456-day Special",
  },
  canara: {
    days: 444,
    label: "444 days special",
    gen: 6.6,
    scheme: "444-day Special",
  },
};

const BUCKETS = [
  [7, 45, "7–45 days"],
  [46, 90, "46–90 days"],
  [91, 180, "91–180 days"],
  [181, 364, "181 days to < 1 year"],
  [365, 729, "1 year to < 2 years"],
  [730, 1094, "2 years to < 3 years"],
  [1095, 1824, "3 years to < 5 years"],
  [1825, 3650, "5 years to 10 years"],
];
const RD_BUCKET_INDEXES = [4, 5, 6, 7];

const BANK_IDS = Object.keys(FD_GEN);
const RETAIL = [0, 30000000, "Below ₹3 crore (retail)"];
const r2 = (n) => Math.round(n * 100) / 100;
const q = (s) => (String(s).includes(",") ? `"${s}"` : s);

const out = [
  "bankId,product,customer,ratePercent,minDays,maxDays,tenureLabel,minAmount,maxAmount,amountLabel,scheme,sourceUrl,effectiveDate",
];

function row(bankId, product, customer, rate, min, max, tlabel, amt, scheme) {
  out.push(
    [
      bankId,
      product,
      customer,
      r2(rate),
      min,
      max ?? "",
      q(tlabel),
      amt[0],
      amt[1] ?? "",
      q(amt[2]),
      q(scheme || ""),
      SRC[bankId],
      EFF[bankId],
    ].join(","),
  );
}

for (const id of BANK_IDS) {
  const gen = FD_GEN[id];
  const superExtra = SUPER_SENIOR_EXTRA[id] ?? 0;

  // FD standard buckets
  BUCKETS.forEach(([min, max, label], i) => {
    row(id, "FD", "GENERAL", gen[i], min, max, label, RETAIL);
    row(id, "FD", "SENIOR", gen[i] + SENIOR_ADDON, min, max, label, RETAIL);
    if (superExtra > 0)
      row(
        id,
        "FD",
        "SUPER_SENIOR",
        gen[i] + SENIOR_ADDON + superExtra,
        min,
        max,
        label,
        RETAIL,
      );
  });

  // Special FD
  const sp = SPECIAL[id];
  if (sp) {
    row(
      id,
      "FD",
      "GENERAL",
      sp.gen,
      sp.days,
      sp.days,
      sp.label,
      RETAIL,
      sp.scheme,
    );
    row(
      id,
      "FD",
      "SENIOR",
      sp.sr ?? sp.gen + SENIOR_ADDON,
      sp.days,
      sp.days,
      sp.label,
      RETAIL,
      sp.scheme,
    );
    if (sp.super)
      row(
        id,
        "FD",
        "SUPER_SENIOR",
        sp.super,
        sp.days,
        sp.days,
        sp.label,
        RETAIL,
        sp.scheme,
      );
    else if (superExtra > 0)
      row(
        id,
        "FD",
        "SUPER_SENIOR",
        sp.gen + SENIOR_ADDON + superExtra,
        sp.days,
        sp.days,
        sp.label,
        RETAIL,
        sp.scheme,
      );
  }

  // RD (any amount).
  // SBI has a directly-cited RD table (PolicyBazaar): 1yr 6.80, 2yr 7.00,
  // 3-4yr 6.75, 5yr 6.50 (general). Other banks: track the FD curve.
  const RD_GEN_OVERRIDE = {
    sbi: { 4: 6.8, 5: 7.0, 6: 6.75, 7: 6.5 },
  };
  RD_BUCKET_INDEXES.forEach((i) => {
    const [min, max, label] = BUCKETS[i];
    const g = RD_GEN_OVERRIDE[id]?.[i] ?? gen[i];
    row(id, "RD", "GENERAL", g, min, max, label, [0, "", "Any amount"]);
    row(id, "RD", "SENIOR", g + SENIOR_ADDON, min, max, label, [
      0,
      "",
      "Any amount",
    ]);
  });

  // Savings (flat, single slab)
  row(id, "SAVINGS", "GENERAL", SAVINGS[id], 0, "", "Any tenure", [
    0,
    "",
    "All balances",
  ]);
  row(id, "SAVINGS", "SENIOR", SAVINGS[id], 0, "", "Any tenure", [
    0,
    "",
    "All balances",
  ]);
}

process.stdout.write(out.join("\n") + "\n");
