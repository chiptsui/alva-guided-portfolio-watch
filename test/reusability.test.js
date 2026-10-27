"use strict";
/**
 * reusability.test.js — AC-6 Skill reusability proof.
 *
 * Verifies that the Skill's intent parser, YoY calculation engine, and
 * Playbook rendering logic all work with a completely different ticker set
 * (MSFT, JPM, XOM) without any source-code changes.
 *
 * All financial figures here are SYNTHETIC TEST DATA.
 * They are structurally realistic but do not represent filed statements.
 *
 * Strict rules: no Cloud writes, no config changes, no new Alva resources.
 * The existing NVDA/TSLA/AAPL demo is re-verified at the end to confirm
 * it is unaffected.
 *
 * Usage: node test/reusability.test.js
 */

const fs   = require("fs");
const path = require("path");
const vm   = require("vm");
const { parseIntent }         = require("../src/intent-to-config");
const { validateConfig }      = require("../src/validate-config");
const { computeCompanyInsight } = require("../src/yoy-insights");

// ---------------------------------------------------------------------------
// Minimal harness
// ---------------------------------------------------------------------------

let passed = 0, failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? " — " + detail : "")); failed++; failures.push({ name, detail }); }
}
function near(a, b, eps) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < (eps || 0.001); }

// ---------------------------------------------------------------------------
// Part 1 — Intent parsing: MSFT/JPM/XOM watchlist, guided, long-term
// ---------------------------------------------------------------------------
console.log("\n── Part 1: Intent parsing ──────────────────────────────────────");

const PROMPT = [
  "I am new to investing and want to monitor MSFT, JPM and XOM over the next 3–5 years.",
  "I want plain-English explanations about changes in the underlying businesses,",
  "without daily price noise or buy/sell recommendations.",
  "These are companies I am watching, not confirmed holdings.",
].join(" ");

const parsed = parseIntent(PROMPT);

assert("parseIntent ok",            parsed.ok === true);
assert("tickers: MSFT, JPM, XOM",  JSON.stringify(parsed.config.tickers) === JSON.stringify(["MSFT","JPM","XOM"]));
assert("guidanceMode: guided",      parsed.config.guidanceMode === "guided");
assert("horizon: long-term",        parsed.config.horizon === "long-term");
assert("MSFT = watchlist (not holding)",  parsed.config.holdings["MSFT"] === "watchlist");
assert("JPM  = watchlist (not holding)",  parsed.config.holdings["JPM"]  === "watchlist");
assert("XOM  = watchlist (not holding)",  parsed.config.holdings["XOM"]  === "watchlist");
assert("preferencesNote says tracking",
  parsed.config.preferencesNote.includes("tracking") || parsed.config.preferencesNote.includes("watching"),
  "Should reflect watchlist ownership in LLM note");

// ---------------------------------------------------------------------------
// Part 2 — MonitoringConfig schema validation
// ---------------------------------------------------------------------------
console.log("\n── Part 2: Schema validation ───────────────────────────────────");

const { valid, errors } = validateConfig(parsed.config);
assert("MonitoringConfig schema valid", valid === true, errors ? errors.join("; ") : "");

// ---------------------------------------------------------------------------
// Part 3 — YoY engine: synthetic MSFT/JPM/XOM data
// NOTE: All figures below are SYNTHETIC TEST DATA, not filed statements.
// ---------------------------------------------------------------------------
console.log("\n── Part 3: YoY engine with synthetic data ──────────────────────");
console.log("   (All financial figures are synthetic test data — not real filings)");

// Synthetic MSFT — strong growth, improving
const MSFT_SYN = {
  symbol: "MSFT", name: "Microsoft Corporation",
  sector: "Technology", industry: "Software—Infrastructure",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-06-30", revenue: 279_000_000_000, net_income: 88_000_000_000, gross_profit_ratio: 0.69 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-06-30", revenue: 245_000_000_000, net_income: 72_000_000_000, gross_profit_ratio: 0.69 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-06-30", operating_cash_flow: 120_000_000_000, free_cash_flow: 100_000_000_000, capital_expenditure: -20_000_000_000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-06-30", operating_cash_flow:  95_000_000_000, free_cash_flow:  80_000_000_000, capital_expenditure: -15_000_000_000 },
  ],
  balance: [], incomeQ: [],
};

// Synthetic JPM — mixed: NI up, Rev flat
const JPM_SYN = {
  symbol: "JPM", name: "JPMorgan Chase",
  sector: "Financial Services", industry: "Banks—Diversified",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 180_000_000_000, net_income: 56_000_000_000, gross_profit_ratio: null },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 177_000_000_000, net_income: 43_000_000_000, gross_profit_ratio: null },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", operating_cash_flow: 60_000_000_000, free_cash_flow: 52_000_000_000, capital_expenditure: -8_000_000_000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", operating_cash_flow: 58_000_000_000, free_cash_flow: 51_000_000_000, capital_expenditure: -7_000_000_000 },
  ],
  balance: [], incomeQ: [],
};

// Synthetic XOM — declining (lower oil prices)
const XOM_SYN = {
  symbol: "XOM", name: "Exxon Mobil",
  sector: "Energy", industry: "Oil & Gas—Integrated",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 380_000_000_000, net_income: 28_000_000_000, gross_profit_ratio: 0.12 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 400_000_000_000, net_income: 36_000_000_000, gross_profit_ratio: 0.14 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", operating_cash_flow: 45_000_000_000, free_cash_flow: 30_000_000_000, capital_expenditure: -15_000_000_000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", operating_cash_flow: 55_000_000_000, free_cash_flow: 40_000_000_000, capital_expenditure: -15_000_000_000 },
  ],
  balance: [], incomeQ: [],
};

const msft = computeCompanyInsight(MSFT_SYN);
const jpm  = computeCompanyInsight(JPM_SYN);
const xom  = computeCompanyInsight(XOM_SYN);

// MSFT: Rev +13.9%, NI +22.2%, FCF +25% → improving
assert("MSFT status ok",          msft.status  === "ok");
assert("MSFT signal improving",   msft.signal  === "improving");
assert("MSFT revYoY ~+13.9%",     near(msft.metrics.revenue.yoy,   0.1388));
assert("MSFT niYoY ~+22.2%",      near(msft.metrics.netIncome.yoy, 0.2222));
assert("MSFT consecutiveYears",   msft.consecutiveYears === true);

// JPM: Rev +1.7% (within deadband → 0), NI +30.2% → improving (NI strongly up)
assert("JPM status ok",           jpm.status   === "ok");
assert("JPM signal improving",    jpm.signal   === "improving", "NI +30% dominates flat revenue");
assert("JPM niYoY ~+30.2%",       near(jpm.metrics.netIncome.yoy, 0.3023));

// XOM: Rev −5%, NI −22.2% → declining
assert("XOM status ok",           xom.status   === "ok");
assert("XOM signal declining",    xom.signal   === "declining");
assert("XOM revYoY ~−5%",         near(xom.metrics.revenue.yoy,   -0.05));
assert("XOM niYoY ~−22.2%",       near(xom.metrics.netIncome.yoy, -0.2222));
assert("XOM consecutiveYears",    xom.consecutiveYears === true);

// ---------------------------------------------------------------------------
// Part 4 — Playbook rendering: MSFT/JPM/XOM payload through inline JS
// ---------------------------------------------------------------------------
console.log("\n── Part 4: Playbook rendering (no source changes) ──────────────");

const html = fs.readFileSync(path.join(__dirname, "../templates/gpw-playbook.stub.html"), "utf8");
const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
const target = scriptBlocks.find(b => b.includes("insightCalcYoY") && b.includes("renderInsightsSection"));
if (!target) { console.error("FATAL: script block not found"); process.exit(1); }
const scriptContent = target.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");

const elements = {};
function makeEl(id) { return { id, textContent: "", innerHTML: "" }; }
function URLSearchParamsShim(s) { this.get = () => null; }
function makeMarkdownitStub() { return { render: s => s, renderer: { rules: {} } }; }

const sandboxDoc = { getElementById: id => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; } };
const sandbox = {
  document: sandboxDoc, URLSearchParams: URLSearchParamsShim, location: { search: "" },
  window: { location: { search: "" }, alva: undefined, markdownit: makeMarkdownitStub },
  console, AlvaToolkit: { AlvaClient: function() { return {}; } },
  fetch: function() { return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
  setTimeout: function() {}, clearTimeout: function() {},
};

try { vm.runInNewContext(scriptContent, sandbox); } catch (e) { if (!sandbox.renderInsightsSection) { console.error("FATAL:", e.message); process.exit(1); } }

// Reset DOM
["insights-meta","insights-data"].forEach(id => { elements[id] = makeEl(id); });

const syntheticPayload = { companies: [MSFT_SYN, JPM_SYN, XOM_SYN] };
const guidedCfg        = { guidanceMode: "guided" };

sandbox.renderInsightsSection(syntheticPayload, guidedCfg);

const dataHtml = elements["insights-data"].innerHTML;

assert("MSFT card rendered",        dataHtml.includes("MSFT"));
assert("JPM card rendered",         dataHtml.includes("JPM"));
assert("XOM card rendered",         dataHtml.includes("XOM"));
assert("MSFT shows Improving",      dataHtml.includes("Improving"));
assert("XOM shows Declining",       dataHtml.includes("Declining"));
assert("Guided narrative sections present", dataHtml.includes("What happened?"),
  "Guided mode must render plain-English narrative sections");
assert("No 'primarily because'",    !dataHtml.includes("primarily because"));
assert("No 'This suggests'",        !dataHtml.includes("This suggests"));

// ---------------------------------------------------------------------------
// Part 5 — Original NVDA/TSLA/AAPL demo unaffected
// ---------------------------------------------------------------------------
console.log("\n── Part 5: Original demo unaffected ───────────────────────────");

// Real data identical to snapshot (from test/yoy-insights.test.js)
const NVDA_REAL = {
  symbol: "NVDA", name: "NVIDIA Corporation",
  sector: "Technology", industry: "Semiconductors",
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", revenue: 215938000000, net_income: 120067000000, gross_profit_ratio: 0.7107 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", revenue: 130497000000, net_income:  72880000000, gross_profit_ratio: 0.7480 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", operating_cash_flow: 102718000000, free_cash_flow: 96676000000, capital_expenditure: -6042000000 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", operating_cash_flow:  64089000000, free_cash_flow: 60853000000, capital_expenditure: -3236000000 },
  ],
  balance: [], incomeQ: [],
};
const AAPL_REAL = {
  symbol: "AAPL", name: "Apple Inc.",
  sector: "Technology", industry: "Consumer Electronics",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", revenue: 416161000000, net_income: 112010000000, gross_profit_ratio: 0.4691 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", revenue: 391035000000, net_income:  93736000000, gross_profit_ratio: 0.4621 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", operating_cash_flow: 111482000000, free_cash_flow:  98767000000, capital_expenditure: -12715000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", operating_cash_flow: 118254000000, free_cash_flow: 108807000000, capital_expenditure:  -9447000000 },
  ],
  balance: [], incomeQ: [],
};

const nvda = computeCompanyInsight(NVDA_REAL);
const aapl = computeCompanyInsight(AAPL_REAL);

assert("NVDA signal still improving",  nvda.signal === "improving");
assert("NVDA revYoY still +65.5%",     near(nvda.metrics.revenue.yoy, 0.6553, 0.002));
assert("AAPL signal still mixed",      aapl.signal === "mixed",  "FCF -9.2% still downgrades to mixed");
assert("AAPL niYoY still +19.5%",      near(aapl.metrics.netIncome.yoy, 0.195, 0.002));

// Render original demo
["insights-meta","insights-data"].forEach(id => { elements[id] = makeEl(id); });
sandbox.renderInsightsSection({ companies: [NVDA_REAL, AAPL_REAL] }, { guidanceMode: "guided" });
const origHtml = elements["insights-data"].innerHTML;
assert("Original NVDA renders",        origHtml.includes("NVDA"));
assert("Original AAPL renders",        origHtml.includes("AAPL"));
assert("NVDA still Improving in HTML", origHtml.includes("Improving"));
assert("AAPL still Mixed in HTML",     origHtml.includes("Mixed"));
assert("Original demo no causal bugs", !origHtml.includes("primarily because"));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n" + passed + " passed, " + failed + " failed");
if (failures.length) { console.log("\nFailed:"); failures.forEach(f => console.log("  " + f.name + (f.detail ? ": " + f.detail : ""))); }
process.exit(failed > 0 ? 1 : 0);
