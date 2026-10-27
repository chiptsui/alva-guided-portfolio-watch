"use strict";
/**
 * playbook-logic.test.js
 *
 * Regression tests for the JavaScript logic embedded in gpw-playbook.stub.html.
 * Extracts and runs the inline <script> in a Node.js vm context with minimal
 * browser shims so every calculation can be verified against real snapshot data.
 *
 * Usage: node test/playbook-logic.test.js
 * Exit code: 0 = all pass, 1 = any fail.
 */

const fs   = require("fs");
const path = require("path");
const vm   = require("vm");

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    console.log("  PASS  " + name);
    passed++;
  } else {
    console.log("  FAIL  " + name + (detail ? " — " + detail : ""));
    failed++;
    failures.push({ name, detail });
  }
}

function near(a, b, epsilon) {
  epsilon = epsilon || 0.0001;
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < epsilon;
}

// ---------------------------------------------------------------------------
// Extract inline <script> from the HTML template
// ---------------------------------------------------------------------------

const htmlPath = path.join(__dirname, "../templates/gpw-playbook.stub.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Grab everything between the first <script> (not src=) that contains our functions.
// We extract between the marker comments we know exist in the file.
const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
if (!scriptMatch || scriptMatch.length === 0) {
  console.error("FATAL: no <script> blocks found in HTML");
  process.exit(1);
}

// Find the script block that contains our key functions
const targetBlock = scriptMatch.find(function(b) {
  return b.includes("insightCalcYoY") && b.includes("insightSignal");
});
if (!targetBlock) {
  console.error("FATAL: could not find script block with insightCalcYoY/insightSignal");
  process.exit(1);
}

// Strip <script> tags
const scriptContent = targetBlock.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");

// ---------------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------------

// Minimal DOM mock — only what renderInsightsSection uses
function makeDomMock() {
  const elements = {};
  function makeEl(id) {
    return {
      id,
      textContent: "",
      innerHTML: "",
      style: {},
      getAttribute: function() { return null; },
    };
  }
  return {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    },
    _elements: elements,
  };
}

// Minimal URLSearchParams shim
function URLSearchParamsShim(str) {
  const params = {};
  (str || "").replace(/^\?/, "").split("&").forEach(function(pair) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  this.get = function(key) { return params[key] !== undefined ? params[key] : null; };
}

const sandboxDoc = makeDomMock();

// markdownit stub — must live on window because the script calls window.markdownit()
function makeMarkdownitStub() {
  return {
    render: function(s) { return s; },
    renderer: { rules: {} },
  };
}

const sandbox = {
  // Browser globals
  document:        sandboxDoc,
  URLSearchParams: URLSearchParamsShim,
  location:        { search: "" },
  window: {
    location: { search: "" },
    alva:     undefined,
    markdownit: makeMarkdownitStub,
  },
  console:         console,
  // AlvaToolkit stub — just enough to not throw on initialization
  AlvaToolkit: {
    AlvaClient: function() { return {}; },
  },
  // Needed by the script to avoid ReferenceError on top-level code
  fetch: function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } }); },
  setTimeout: function() {},
  clearTimeout: function() {},
};

// Run the script in the sandbox
try {
  vm.runInNewContext(scriptContent, sandbox);
} catch (e) {
  // Script may throw at initialization (e.g. tries to call loadData immediately).
  // That's OK as long as the functions we need were defined before the throw.
  if (!sandbox.insightCalcYoY) {
    console.error("FATAL: script threw before defining insightCalcYoY:", e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Real snapshot data (from payload retrieved 2026-10-24T07:40 UTC)
// ---------------------------------------------------------------------------

const NVDA = {
  symbol: "NVDA", name: "NVIDIA Corporation",
  sector: "Technology", industry: "Semiconductors",
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", revenue: 215938000000, net_income: 120067000000, gross_profit_ratio: 0.7107 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", revenue: 130497000000, net_income:  72880000000, gross_profit_ratio: 0.7480 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-01-28", revenue:  60922000000, net_income:  29760000000, gross_profit_ratio: 0.7252 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", operating_cash_flow: 102718000000, free_cash_flow: 96676000000, capital_expenditure: -6042000000 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", operating_cash_flow:  64089000000, free_cash_flow: 60853000000, capital_expenditure: -3236000000 },
  ],
};

const TSLA = {
  symbol: "TSLA", name: "Tesla, Inc.",
  sector: "Consumer Cyclical", industry: "Auto - Manufacturers",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 94827000000, net_income: 3794000000,  gross_profit_ratio: 0.1803 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 97690000000, net_income: 7130000000,  gross_profit_ratio: 0.1778 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", operating_cash_flow: 14747000000, free_cash_flow:  6220000000, capital_expenditure:  -8527000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", operating_cash_flow: 14923000000, free_cash_flow:  3581000000, capital_expenditure: -11342000000 },
  ],
};

const AAPL = {
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
};

// ---------------------------------------------------------------------------
// insightCalcYoY
// ---------------------------------------------------------------------------
console.log("\nPlaybook insightCalcYoY");

assert("positive growth",       near(sandbox.insightCalcYoY(130, 100), 0.30));
assert("decline",               near(sandbox.insightCalcYoY(70, 100), -0.30));
assert("null current → null",   sandbox.insightCalcYoY(null, 100) === null);
assert("null prior → null",     sandbox.insightCalcYoY(100, null) === null);
assert("zero prior → null",     sandbox.insightCalcYoY(100, 0) === null);

// ---------------------------------------------------------------------------
// insightSignal (3-arg version)
// ---------------------------------------------------------------------------
console.log("\nPlaybook insightSignal");

// Compute YoY values for each company
const nvdaRevYoY = sandbox.insightCalcYoY(215938000000, 130497000000); // ~+0.655
const nvdaNiYoY  = sandbox.insightCalcYoY(120067000000,  72880000000); // ~+0.648
const nvdaFcfYoY = sandbox.insightCalcYoY( 96676000000,  60853000000); // ~+0.589

const tslaRevYoY = sandbox.insightCalcYoY( 94827000000,  97690000000); // ~-0.029
const tslaNiYoY  = sandbox.insightCalcYoY(  3794000000,   7130000000); // ~-0.468
const tslaFcfYoY = sandbox.insightCalcYoY(  6220000000,   3581000000); // ~+0.737

const aaplRevYoY = sandbox.insightCalcYoY(416161000000, 391035000000); // ~+0.064
const aaplNiYoY  = sandbox.insightCalcYoY(112010000000,  93736000000); // ~+0.195
const aaplFcfYoY = sandbox.insightCalcYoY( 98767000000, 108807000000); // ~-0.092

assert("NVDA signal: improving",
  sandbox.insightSignal(nvdaRevYoY, nvdaNiYoY, nvdaFcfYoY) === "improving");
assert("TSLA signal: declining",
  sandbox.insightSignal(tslaRevYoY, tslaNiYoY, tslaFcfYoY) === "declining",
  "FCF +73.7% must NOT upgrade declining P&L");
assert("AAPL signal: mixed",
  sandbox.insightSignal(aaplRevYoY, aaplNiYoY, aaplFcfYoY) === "mixed",
  "P&L improving but FCF -9.2% → downgrade to mixed");
assert("FCF null does not affect signal",
  sandbox.insightSignal(nvdaRevYoY, nvdaNiYoY, null) === "improving");

// ---------------------------------------------------------------------------
// insightObservation accuracy
// ---------------------------------------------------------------------------
console.log("\nPlaybook insightObservation");

// Need cf rows for TSLA
const tslaCf0 = TSLA.cashflow[0]; // FY2025
const tslaCf1 = TSLA.cashflow[1]; // FY2024
const aaplCf0 = AAPL.cashflow[0];
const aaplCf1 = AAPL.cashflow[1];

const nvdaObs = sandbox.insightObservation("improving", nvdaRevYoY, nvdaNiYoY, nvdaFcfYoY, null, null, false);
assert("NVDA obs: mentions revenue and net income grew",
  nvdaObs.obs.includes("Revenue and net income both grew"), nvdaObs.obs);
assert("NVDA obs: no ctx in non-guided mode",
  nvdaObs.ctx === "");

const tslaObs = sandbox.insightObservation("declining", tslaRevYoY, tslaNiYoY, tslaFcfYoY, tslaCf0, tslaCf1, false);
assert("TSLA obs: mentions both declined",
  tslaObs.obs.includes("Both revenue and net income declined"), tslaObs.obs);
assert("TSLA obs: FCF improvement quantified with capex numbers (not causal claim)",
  tslaObs.obs.includes("$11.3B") || tslaObs.obs.includes("11.342") || tslaObs.obs.includes("$8.5B"),
  "TSLA obs should show factual capex numbers: " + tslaObs.obs);
assert("TSLA obs: no unquantified causal language",
  !tslaObs.obs.includes("primarily because"),
  "Unsupported causal claim must be removed. obs=" + tslaObs.obs);

const aaplObs = sandbox.insightObservation("mixed", aaplRevYoY, aaplNiYoY, aaplFcfYoY, aaplCf0, aaplCf1, false);
assert("AAPL obs: mentions both P&L grew",
  aaplObs.obs.includes("Revenue and net income both grew"), aaplObs.obs);
assert("AAPL obs: mentions FCF declined with percentage",
  aaplObs.obs.includes("Free cash flow declined"), aaplObs.obs);
assert("AAPL obs: no 'This suggests' unlabeled interpretation",
  !aaplObs.obs.includes("This suggests"),
  "Unlabeled interpretation must be removed. obs=" + aaplObs.obs);

const aaplObsGuided = sandbox.insightObservation("mixed", aaplRevYoY, aaplNiYoY, aaplFcfYoY, aaplCf0, aaplCf1, true);
assert("AAPL guided obs: ctx block present",
  aaplObsGuided.ctx.includes("Context (interpretation)"), aaplObsGuided.ctx);

// ---------------------------------------------------------------------------
// Playbook HTML structural checks
// ---------------------------------------------------------------------------
console.log("\nPlaybook HTML structure");

assert("demo badge present in HTML",
  html.includes("demo-badge") || html.includes("Demonstration") || html.includes("demonstration"),
  "Demo scenario label must be visible");

assert("payload.asOf used for freshness (not snap.asOf exclusively)",
  html.includes("payload.asOf"),
  "Freshness label must use original retrieval time");

assert("holding label disclaimer present",
  html.includes("user-configured") || html.includes("not been verified"),
  "Holding disclaimer must be present");

assert("insightSignal takes 3 arguments in HTML",
  html.includes("insightSignal(revYoY, niYoY, fcfYoY)") ||
  html.includes("function insightSignal(revYoY, niYoY, fcfYoY)"),
  "insightSignal must accept fcfYoY as 3rd arg");

assert("insightSignal call site passes fcfYoY",
  html.includes("insightSignal(revYoY, niYoY, fcfYoY)"),
  "Call site must pass fcfYoY");

// ---------------------------------------------------------------------------
// renderInsightsSection with mock payload
// ---------------------------------------------------------------------------
console.log("\nrenderInsightsSection (mock DOM)");

// Reset DOM elements
sandboxDoc._elements["insights-meta"] = { textContent: "", innerHTML: "" };
sandboxDoc._elements["insights-data"] = { textContent: "", innerHTML: "" };

const mockPayload = { companies: [NVDA, TSLA, AAPL] };
const mockCfg     = { guidanceMode: "neutral" };

sandbox.renderInsightsSection(mockPayload, mockCfg);

const metaText = sandboxDoc._elements["insights-meta"].textContent
  || sandboxDoc._elements["insights-meta"].innerHTML || "";
const dataHtml = sandboxDoc._elements["insights-data"].innerHTML;

assert("meta element populated",
  metaText.length > 0, "meta text: " + metaText);
assert("data element contains NVDA card",
  dataHtml.includes("NVDA"), "innerHTML does not include NVDA");
assert("data element contains TSLA card",
  dataHtml.includes("TSLA"), "innerHTML does not include TSLA");
assert("data element contains AAPL card",
  dataHtml.includes("AAPL"), "innerHTML does not include AAPL");
assert("NVDA shows Improving signal",
  dataHtml.includes("Improving"), "NVDA should show Improving");
assert("TSLA shows Declining signal",
  dataHtml.includes("Declining"), "TSLA should show Declining");
assert("AAPL shows Mixed signal",
  dataHtml.includes("Mixed"), "AAPL should show Mixed");
assert("no 'primarily because' causal claim in rendered output",
  !dataHtml.includes("primarily because"),
  "Unsupported causal language must not appear in rendered cards");
assert("no 'This suggests' in rendered output",
  !dataHtml.includes("This suggests"),
  "Unlabeled interpretation must not appear in rendered cards");

// Empty companies array
sandboxDoc._elements["insights-meta"] = { textContent: "", innerHTML: "" };
sandboxDoc._elements["insights-data"] = { textContent: "", innerHTML: "" };
sandbox.renderInsightsSection({ companies: [] }, mockCfg);
assert("empty companies shows no-data message",
  sandboxDoc._elements["insights-meta"].textContent.includes("No company data"),
  "Should show 'No company data available.'");

// ---------------------------------------------------------------------------
// Consecutive-year gap enforcement (Playbook inline JS regression)
// ---------------------------------------------------------------------------
console.log("\nPlaybook gap enforcement (FY2026 + FY2024, FY2025 missing)");

const GAP_CO = {
  symbol: "GAP", name: "Gap Corp",
  sector: null, industry: null,
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 150e9, net_income: 15e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 100e9, net_income: 10e9 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", free_cash_flow: 12e9, operating_cash_flow: 15e9, capital_expenditure: -3e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", free_cash_flow:  8e9, operating_cash_flow: 10e9, capital_expenditure: -2e9 },
  ],
};

sandboxDoc._elements["insights-meta"] = { textContent: "", innerHTML: "" };
sandboxDoc._elements["insights-data"] = { textContent: "", innerHTML: "" };
sandbox.renderInsightsSection({ companies: [GAP_CO] }, mockCfg);

const gapHtml = sandboxDoc._elements["insights-data"].innerHTML;

assert("gap: no '+50%' shown (would be two-year change, not YoY)",
  !gapHtml.includes("+50.0%") && !gapHtml.includes("+50%"),
  "A two-year revenue change (+50%) must NOT appear as a YoY figure. html=" + gapHtml.slice(0, 300));

assert("gap: no '+50.0%' for net income either",
  !gapHtml.includes("+50.0%"),
  "Two-year NI change must not appear");

assert("gap: shows gap-detected message",
  gapHtml.includes("gap detected") || gapHtml.includes("FY2025") || gapHtml.includes("unavailable"),
  "Should show a message about the missing fiscal year. html=" + gapHtml.slice(0, 300));

assert("gap: shows Insufficient signal (not Improving)",
  (gapHtml.includes("Insufficient") || !gapHtml.includes("Improving")),
  "Must not claim Improving when data has a gap");

// With FY2025 present: verify correct YoY (+25%, not +50%)
const GAP_CO_FIXED = {
  symbol: "GAP", name: "Gap Corp", sector: null, industry: null,
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 150e9, net_income: 15e9 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 120e9, net_income: 12e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 100e9, net_income: 10e9 },
  ],
  cashflow: [],
};
sandboxDoc._elements["insights-meta"] = { textContent: "", innerHTML: "" };
sandboxDoc._elements["insights-data"] = { textContent: "", innerHTML: "" };
sandbox.renderInsightsSection({ companies: [GAP_CO_FIXED] }, mockCfg);
const gapFixedHtml = sandboxDoc._elements["insights-data"].innerHTML;

assert("gap-fixed: shows +25.0% (FY2026 vs FY2025)",
  gapFixedHtml.includes("+25.0%"),
  "Should show +25% (FY2026 $150B vs FY2025 $120B). html=" + gapFixedHtml.slice(0, 300));

assert("gap-fixed: does NOT show +50.0%",
  !gapFixedHtml.includes("+50.0%"),
  "Should not compare FY2026 vs FY2024 when FY2025 is present");

// ---------------------------------------------------------------------------
// Watchlist / Holding status label regression
// ---------------------------------------------------------------------------
console.log("\nWatchlist vs Holding rendering");

// renderPortfolioOverview — ticker tag line with status chip
const watchlistCfg = {
  guidanceMode: "guided",
  tickers: ["NVDA", "TSLA", "AAPL"],
  holdings: { NVDA: "watchlist", TSLA: "watchlist", AAPL: "watchlist" },
  horizon: "long-term",
};
const holdingCfg = {
  guidanceMode: "neutral",
  tickers: ["NVDA", "TSLA", "AAPL"],
  holdings: { NVDA: "holding", TSLA: "holding", AAPL: "holding" },
  horizon: "long-term",
};
const mixedCfg = {
  guidanceMode: "neutral",
  tickers: ["NVDA", "TSLA", "AAPL"],
  holdings: { NVDA: "holding", TSLA: "watchlist", AAPL: "watchlist" },
  horizon: "long-term",
};

// Reset DOM overview element
function resetOverview() {
  sandboxDoc._elements["portfolio-header"] = { textContent: "", innerHTML: "" };
}

resetOverview();
sandbox.renderPortfolioOverview(watchlistCfg);
var watchlistOverviewHtml = sandboxDoc._elements["portfolio-header"].innerHTML;
assert("watchlist cfg: overview renders Watching chips (not Holding)",
  watchlistOverviewHtml.includes("status-tag watchlist") && !watchlistOverviewHtml.includes("status-tag holding"),
  "All three should be 'watchlist' chips. html=" + watchlistOverviewHtml.slice(0, 300));

assert("watchlist cfg: no 'Holding' label text in overview",
  !watchlistOverviewHtml.includes(">Holding<"),
  "Watchlist config must not show Holding label");

resetOverview();
sandbox.renderPortfolioOverview(holdingCfg);
var holdingOverviewHtml = sandboxDoc._elements["portfolio-header"].innerHTML;
assert("holding cfg: overview renders Holding chips (not Watching)",
  holdingOverviewHtml.includes("status-tag holding") && !holdingOverviewHtml.includes("status-tag watchlist"),
  "All three should be 'holding' chips. html=" + holdingOverviewHtml.slice(0, 300));

assert("holding cfg: no 'Watching' label text in overview",
  !holdingOverviewHtml.includes(">Watching<"),
  "Holding config must not show Watching label");

// renderCompanies — company cards with status chips
function resetCompanies() {
  sandboxDoc._elements["companies-meta"] = { textContent: "", innerHTML: "" };
  sandboxDoc._elements["companies-data"] = { textContent: "", innerHTML: "" };
}

const mockSnap = { asOf: "2026-10-24T22:00:14.907Z" };
const mockPayloadFull = { asOf: 1792827649202, companies: [NVDA, TSLA, AAPL] };

resetCompanies();
sandbox.renderCompanies(mockSnap, mockPayloadFull, watchlistCfg);
var watchlistCardsHtml = sandboxDoc._elements["companies-data"].innerHTML;

assert("watchlist cfg: company cards show Watching chips",
  watchlistCardsHtml.includes("status-tag watchlist"),
  "Company cards should use watchlist chip class. html=" + watchlistCardsHtml.slice(0, 200));

assert("watchlist cfg: company cards do NOT show Holding chips",
  !watchlistCardsHtml.includes("status-tag holding"),
  "No holding chip should appear for watchlist config");

assert("watchlist cfg: label text is Watching not Holding",
  watchlistCardsHtml.includes(">Watching<") && !watchlistCardsHtml.includes(">Holding<"),
  "Label must read 'Watching' for watchlist. html=" + watchlistCardsHtml.slice(0, 200));

resetCompanies();
sandbox.renderCompanies(mockSnap, mockPayloadFull, holdingCfg);
var holdingCardsHtml = sandboxDoc._elements["companies-data"].innerHTML;

assert("holding cfg: company cards show Holding chips",
  holdingCardsHtml.includes("status-tag holding"),
  "Company cards should use holding chip class");

assert("holding cfg: company cards do NOT show Watching chips",
  !holdingCardsHtml.includes("status-tag watchlist"),
  "No watchlist chip should appear for holding config");

assert("holding cfg: label text is Holding not Watching",
  holdingCardsHtml.includes(">Holding<") && !holdingCardsHtml.includes(">Watching<"),
  "Label must read 'Holding' for holding config");

// Mixed: NVDA holding, TSLA + AAPL watchlist
resetCompanies();
sandbox.renderCompanies(mockSnap, mockPayloadFull, mixedCfg);
var mixedCardsHtml = sandboxDoc._elements["companies-data"].innerHTML;

assert("mixed cfg: both chip classes present",
  mixedCardsHtml.includes("status-tag holding") && mixedCardsHtml.includes("status-tag watchlist"),
  "Mixed config must render both holding and watchlist chips");

assert("mixed cfg: both label texts present",
  mixedCardsHtml.includes(">Holding<") && mixedCardsHtml.includes(">Watching<"),
  "Mixed config must render both Holding and Watching labels");

// Financial calculations must be unaffected by holding status
resetCompanies();
sandbox.renderCompanies(mockSnap, mockPayloadFull, watchlistCfg);
var watchlistCalcHtml = sandboxDoc._elements["companies-data"].innerHTML;

assert("watchlist cfg: financial figures still rendered (NVDA revenue)",
  watchlistCalcHtml.includes("215") || watchlistCalcHtml.includes("215.9") || watchlistCalcHtml.includes("216"),
  "Revenue figures must still render regardless of holding status");

// portfolioLabel() logic
assert("portfolioLabel: all watchlist → 'watchlist'",
  sandbox.portfolioLabel({ NVDA: "watchlist", TSLA: "watchlist" }) === "watchlist");
assert("portfolioLabel: all holding → 'holdings'",
  sandbox.portfolioLabel({ NVDA: "holding", TSLA: "holding" }) === "holdings");
assert("portfolioLabel: mixed → 'portfolio'",
  sandbox.portfolioLabel({ NVDA: "holding", TSLA: "watchlist" }) === "portfolio");
assert("portfolioLabel: empty map → 'watchlist'",
  sandbox.portfolioLabel({}) === "watchlist");
assert("portfolioLabel: null → 'watchlist'",
  sandbox.portfolioLabel(null) === "watchlist");

// renderSectionHeadings updates DOM elements correctly
function resetHeadings() {
  ["insights-heading","companies-heading","guide-heading","guide-desc","guide-disclaimer"].forEach(function(id) {
    sandboxDoc._elements[id] = { textContent: "", innerHTML: "" };
  });
}

resetHeadings();
sandbox.renderSectionHeadings(watchlistCfg);
assert("headings/watchlist: insights heading",
  sandboxDoc._elements["insights-heading"].textContent === "Your watchlist, explained");
assert("headings/watchlist: companies heading",
  sandboxDoc._elements["companies-heading"].textContent === "Companies on your watchlist");
assert("headings/watchlist: guide heading",
  sandboxDoc._elements["guide-heading"].textContent === "Understanding your watchlist");
assert("headings/watchlist: guide-desc mentions watchlist",
  sandboxDoc._elements["guide-desc"].textContent.includes("on your watchlist"));
assert("headings/watchlist: disclaimer mentions watchlist symbols",
  sandboxDoc._elements["guide-disclaimer"].textContent.includes("watchlist symbols only"));

resetHeadings();
sandbox.renderSectionHeadings(holdingCfg);
assert("headings/holdings: insights heading",
  sandboxDoc._elements["insights-heading"].textContent === "Your holdings, explained");
assert("headings/holdings: companies heading",
  sandboxDoc._elements["companies-heading"].textContent === "Companies in your portfolio");
assert("headings/holdings: guide heading",
  sandboxDoc._elements["guide-heading"].textContent === "Understanding your portfolio");
assert("headings/holdings: guide-desc mentions portfolio",
  sandboxDoc._elements["guide-desc"].textContent.includes("in your portfolio"));
assert("headings/holdings: disclaimer mentions holding status",
  sandboxDoc._elements["guide-disclaimer"].textContent.includes("Holding status labels"));

resetHeadings();
sandbox.renderSectionHeadings(mixedCfg);
assert("headings/portfolio: insights heading avoids 'portfolio' (implies ownership)",
  sandboxDoc._elements["insights-heading"].textContent === "Your tracked companies, explained");
assert("headings/portfolio: companies heading",
  sandboxDoc._elements["companies-heading"].textContent === "Companies you're tracking");
assert("headings/portfolio: guide heading",
  sandboxDoc._elements["guide-heading"].textContent === "Understanding your tracked companies");
assert("headings/portfolio: guide-desc mentions tracking",
  sandboxDoc._elements["guide-desc"].textContent.includes("you're tracking"));
assert("headings/portfolio: disclaimer mentions both labels",
  sandboxDoc._elements["guide-disclaimer"].textContent.includes("Watching / Holding"));

// HTML section headings use watchlist language
assert("HTML: heading says 'watchlist, explained' not 'portfolio'",
  html.includes("Your watchlist, explained"),
  "Section heading must say watchlist");

assert("HTML: companies heading says 'on your watchlist' not 'in your portfolio'",
  html.includes("Companies on your watchlist"),
  "Companies heading must say watchlist");

assert("HTML: guide heading says 'Understanding your watchlist'",
  html.includes("Understanding your watchlist"),
  "Guide heading must say watchlist");

assert("HTML: footer disclaimer mentions watchlist symbols",
  html.includes("watchlist symbols only"),
  "Footer disclaimer must clarify watchlist nature");

assert("HTML: overview disclaimer says 'Status labels' not 'Holding labels'",
  html.includes("Status labels (Watching / Holding)"),
  "Overview disclaimer must reference both label types");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n" + passed + " passed, " + failed + " failed");
if (failures.length > 0) {
  console.log("\nFailed tests:");
  failures.forEach(function(f) { console.log("  " + f.name + (f.detail ? ": " + f.detail : "")); });
}
process.exit(failed > 0 ? 1 : 0);
