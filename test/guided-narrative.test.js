"use strict";
/**
 * guided-narrative.test.js — Guided narrative correctness regression.
 *
 * Verifies:
 *   (a) FCF is not confused with operating cash flow in any text field
 *   (b) whatHappened / watchNext / ctx contain accurate metric terminology
 *   (c) All four guided sections render for companies with sufficient data
 *   (d) Neutral mode renders compact layout without section labels
 *   (e) Gap / single-year data renders safely without misleading figures
 *   (f) Accordion CSS uses correct accessible disclosure structure
 *
 * Uses the same script-extraction approach as playbook-logic.test.js.
 * Usage: node test/guided-narrative.test.js
 */

const fs   = require("fs");
const path = require("path");
const vm   = require("vm");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? " — " + detail : "")); failed++; failures.push({ name, detail }); }
}

// ---------------------------------------------------------------------------
// Extract inline script from HTML template
// ---------------------------------------------------------------------------
const htmlPath = path.join(__dirname, "../templates/gpw-playbook.stub.html");
const html = fs.readFileSync(htmlPath, "utf8");

const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
const targetBlock = scriptBlocks.find(function(b) {
  return b.includes("insightCalcYoY") && b.includes("insightObservation");
});
if (!targetBlock) { console.error("FATAL: script block not found"); process.exit(1); }
const scriptContent = targetBlock.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");

// ---------------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------------
const elements = {};
function makeEl(id) { return { id, textContent: "", innerHTML: "" }; }
const sandboxDoc = { getElementById: function(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; } };
function URLSearchParamsShim(s) { this.get = function() { return null; }; }
function makeMarkdownitStub() { return { render: function(s) { return s; }, renderer: { rules: {} } }; }

const sandbox = {
  document: sandboxDoc, URLSearchParams: URLSearchParamsShim, location: { search: "" },
  window: { location: { search: "" }, alva: undefined, markdownit: makeMarkdownitStub },
  console: console, AlvaToolkit: { AlvaClient: function() { return {}; } },
  fetch: function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } }); },
  setTimeout: function() {}, clearTimeout: function() {},
};

try { vm.runInNewContext(scriptContent, sandbox); } catch(e) {
  if (!sandbox.insightObservation) { console.error("FATAL:", e.message); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Real snapshot data (matching playbook-logic.test.js)
// ---------------------------------------------------------------------------
const NVDA = {
  symbol: "NVDA", name: "NVIDIA Corporation",
  sector: "Technology", industry: "Semiconductors",
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", revenue: 215938000000, net_income: 120067000000 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", revenue: 130497000000, net_income:  72880000000 },
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
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 94827000000, net_income: 3794000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 97690000000, net_income: 7130000000 },
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
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", revenue: 416161000000, net_income: 112010000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", revenue: 391035000000, net_income:  93736000000 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", operating_cash_flow: 111482000000, free_cash_flow:  98767000000, capital_expenditure: -12715000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", operating_cash_flow: 118254000000, free_cash_flow: 108807000000, capital_expenditure:  -9447000000 },
  ],
};

// Pre-compute YoY inputs (matching playbook-logic.test.js)
const nvdaRevYoY = sandbox.insightCalcYoY(215938000000, 130497000000);
const nvdaNiYoY  = sandbox.insightCalcYoY(120067000000,  72880000000);
const nvdaFcfYoY = sandbox.insightCalcYoY( 96676000000,  60853000000);

const tslaRevYoY = sandbox.insightCalcYoY( 94827000000,  97690000000);
const tslaNiYoY  = sandbox.insightCalcYoY(  3794000000,   7130000000);
const tslaFcfYoY = sandbox.insightCalcYoY(  6220000000,   3581000000);

const aaplRevYoY = sandbox.insightCalcYoY(416161000000, 391035000000);
const aaplNiYoY  = sandbox.insightCalcYoY(112010000000,  93736000000);
const aaplFcfYoY = sandbox.insightCalcYoY( 98767000000, 108807000000);

const tslaCf0 = TSLA.cashflow[0];
const tslaCf1 = TSLA.cashflow[1];
const aaplCf0 = AAPL.cashflow[0];
const aaplCf1 = AAPL.cashflow[1];

// ---------------------------------------------------------------------------
// Part 1 — FCF vs operating cash flow terminology
// ---------------------------------------------------------------------------
console.log("\n── Part 1: FCF terminology — no confusion with operating cash flow ──");

const aaplGuided = sandbox.insightObservation("mixed", aaplRevYoY, aaplNiYoY, aaplFcfYoY, aaplCf0, aaplCf1, true);
const tslaGuided = sandbox.insightObservation("declining", tslaRevYoY, tslaNiYoY, tslaFcfYoY, tslaCf0, tslaCf1, true);
const nvdaGuided = sandbox.insightObservation("improving", nvdaRevYoY, nvdaNiYoY, nvdaFcfYoY, null, null, true);

assert("AAPL whatHappened says 'free cash flow'",
  aaplGuided.whatHappened.toLowerCase().includes("free cash flow"),
  "Should say 'free cash flow', got: " + aaplGuided.whatHappened);

assert("AAPL whatHappened does NOT say 'from operations'",
  !aaplGuided.whatHappened.toLowerCase().includes("from operations"),
  "Must not claim operating cash flow declined. Got: " + aaplGuided.whatHappened);

assert("AAPL whatHappened does NOT say 'operating cash'",
  !aaplGuided.whatHappened.toLowerCase().includes("operating cash"),
  "Got: " + aaplGuided.whatHappened);

assert("TSLA whatHappened says 'free cash flow'",
  tslaGuided.whatHappened.toLowerCase().includes("free cash flow"),
  "Should say 'free cash flow', got: " + tslaGuided.whatHappened);

assert("TSLA whatHappened does NOT imply operating cash flow increased",
  !tslaGuided.whatHappened.toLowerCase().includes("actual cash the business generated"),
  "Ambiguous OCF implication must be removed. Got: " + tslaGuided.whatHappened);

assert("TSLA watchNext says 'free cash flow'",
  tslaGuided.watchNext.toLowerCase().includes("free cash flow"),
  "Got: " + tslaGuided.watchNext);

assert("AAPL watchNext says 'free cash flow'",
  aaplGuided.watchNext.toLowerCase().includes("free cash flow"),
  "Got: " + aaplGuided.watchNext);

assert("NVDA whatHappened says 'free cash flow' for FCF increase",
  nvdaGuided.whatHappened.toLowerCase().includes("free cash flow"),
  "Improving + FCF up should say 'free cash flow'. Got: " + nvdaGuided.whatHappened);

// ctx must still carry the required prefix (test contract from playbook-logic.test.js)
assert("AAPL ctx still has 'Context (interpretation):' prefix",
  aaplGuided.ctx.includes("Context (interpretation):"),
  "Test contract: ctx prefix must be preserved. Got: " + aaplGuided.ctx);

assert("AAPL ctx uses 'free cash flow' not 'cash generation'",
  aaplGuided.ctx.toLowerCase().includes("free cash flow"),
  "ctx should say 'free cash flow'. Got: " + aaplGuided.ctx);

// ---------------------------------------------------------------------------
// Part 2 — whatHappened factual accuracy
// ---------------------------------------------------------------------------
console.log("\n── Part 2: whatHappened factual accuracy ───────────────────────────");

assert("NVDA whatHappened: mentions profit",
  nvdaGuided.whatHappened.toLowerCase().includes("profit"),
  "Got: " + nvdaGuided.whatHappened);

assert("NVDA whatHappened: mentions customers or sales",
  nvdaGuided.whatHappened.toLowerCase().includes("customers") || nvdaGuided.whatHappened.toLowerCase().includes("sales"),
  "Got: " + nvdaGuided.whatHappened);

assert("TSLA whatHappened: mentions less profit or less customers (declining)",
  tslaGuided.whatHappened.toLowerCase().includes("less profit") || tslaGuided.whatHappened.toLowerCase().includes("less from customers"),
  "Got: " + tslaGuided.whatHappened);

assert("TSLA whatHappened: FCF improvement mentions capex figures (factual decomposition)",
  tslaGuided.whatHappened.includes("$11.3B") || tslaGuided.whatHappened.includes("$8.5B"),
  "Capex numbers should appear for factual grounding. Got: " + tslaGuided.whatHappened);

assert("AAPL whatHappened: mentions both sales/profit increased",
  aaplGuided.whatHappened.toLowerCase().includes("profit") &&
  (aaplGuided.whatHappened.toLowerCase().includes("sales") || aaplGuided.whatHappened.toLowerCase().includes("increased")),
  "Got: " + aaplGuided.whatHappened);

assert("AAPL whatHappened: mentions 'decreased' for FCF",
  aaplGuided.whatHappened.toLowerCase().includes("decreased"),
  "Got: " + aaplGuided.whatHappened);

assert("No whatHappened contains 'primarily because'",
  !nvdaGuided.whatHappened.includes("primarily because") &&
  !tslaGuided.whatHappened.includes("primarily because") &&
  !aaplGuided.whatHappened.includes("primarily because"),
  "Unsupported causal language must not appear");

assert("No whatHappened contains 'This suggests'",
  !nvdaGuided.whatHappened.includes("This suggests") &&
  !tslaGuided.whatHappened.includes("This suggests") &&
  !aaplGuided.whatHappened.includes("This suggests"),
  "Unlabeled interpretation must not appear");

// ---------------------------------------------------------------------------
// Part 3 — Guided rendering: all four sections present
// ---------------------------------------------------------------------------
console.log("\n── Part 3: Guided mode renders all four sections ───────────────────");

["insights-meta", "insights-data"].forEach(function(id) { elements[id] = makeEl(id); });
sandbox.renderInsightsSection({ companies: [NVDA, TSLA, AAPL] }, { guidanceMode: "guided" });
const guidedHtml = elements["insights-data"].innerHTML;

assert("Guided: 'What happened?' section label present",
  guidedHtml.includes("What happened?"),
  "Should render 'What happened?' label");

assert("Guided: 'Why does it matter?' section label present",
  guidedHtml.includes("Why does it matter?"),
  "Should render 'Why does it matter?' label");

assert("Guided: 'Supporting numbers' section label present",
  guidedHtml.includes("Supporting numbers"),
  "Should render 'Supporting numbers' label");

assert("Guided: 'What should I watch next?' section label present",
  guidedHtml.includes("What should I watch next?"),
  "Should render 'What should I watch next?' label");

// Verify all three companies get all four sections
["NVDA", "TSLA", "AAPL"].forEach(function(sym) {
  assert("Guided: " + sym + " card rendered with whatHappened text",
    guidedHtml.includes(sym) && guidedHtml.includes("What happened?"),
    sym + " guided card must be present");
});

assert("Guided: FCF described correctly in rendered AAPL card",
  !guidedHtml.includes("from operations") && guidedHtml.toLowerCase().includes("free cash flow"),
  "Rendered HTML must say 'free cash flow', not 'from operations'");

assert("Guided: metric labels use plain language",
  guidedHtml.includes("Total sales") && guidedHtml.includes("Profit after costs") && guidedHtml.includes("Cash generated"),
  "Guided mode should use beginner-friendly metric labels");

// ---------------------------------------------------------------------------
// Part 4 — Neutral mode: compact layout, no section labels
// ---------------------------------------------------------------------------
console.log("\n── Part 4: Neutral mode compact layout ─────────────────────────────");

["insights-meta", "insights-data"].forEach(function(id) { elements[id] = makeEl(id); });
sandbox.renderInsightsSection({ companies: [NVDA, TSLA, AAPL] }, { guidanceMode: "neutral" });
const neutralHtml = elements["insights-data"].innerHTML;

assert("Neutral: all three companies present",
  neutralHtml.includes("NVDA") && neutralHtml.includes("TSLA") && neutralHtml.includes("AAPL"),
  "All tickers must appear in neutral mode");

assert("Neutral: 'What happened?' label absent (compact layout)",
  !neutralHtml.includes("What happened?"),
  "Section labels must not appear in neutral mode");

assert("Neutral: 'Why does it matter?' label absent",
  !neutralHtml.includes("Why does it matter?"),
  "Section labels must not appear in neutral mode");

assert("Neutral: 'Supporting numbers' label absent",
  !neutralHtml.includes("Supporting numbers"),
  "Section labels must not appear in neutral mode");

assert("Neutral: signals still rendered",
  neutralHtml.includes("Improving") && neutralHtml.includes("Declining") && neutralHtml.includes("Mixed"),
  "Signal tags must still appear in neutral mode");

assert("Neutral: factual obs text present (Revenue and net income)",
  neutralHtml.includes("Revenue and net income"),
  "Factual obs text should appear in neutral mode");

assert("Neutral: industry watch text present",
  neutralHtml.includes("Watch for"),
  "Industry watch text should appear in neutral mode");

// ---------------------------------------------------------------------------
// Part 5 — Gap / single-year data: no misleading output
// ---------------------------------------------------------------------------
console.log("\n── Part 5: Gap and single-year data safety ─────────────────────────");

const GAP_CO = {
  symbol: "GAP", name: "Gap Corp", sector: null, industry: null,
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 150e9, net_income: 15e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 100e9, net_income: 10e9 },
  ],
  cashflow: [],
};
const SINGLE_CO = {
  symbol: "SNGL", name: "Single Year Corp", sector: null, industry: null,
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 50e9, net_income: 5e9 },
  ],
  cashflow: [],
};

["insights-meta", "insights-data"].forEach(function(id) { elements[id] = makeEl(id); });
sandbox.renderInsightsSection({ companies: [GAP_CO] }, { guidanceMode: "guided" });
const gapHtml = elements["insights-data"].innerHTML;

assert("Gap: does not show +50% YoY (multi-year comparison suppressed)",
  !gapHtml.includes("+50.0%") && !gapHtml.includes("+50%"),
  "Two-year change must not appear as annual YoY. html=" + gapHtml.slice(0, 200));

assert("Gap: shows gap or unavailable message",
  gapHtml.includes("gap") || gapHtml.includes("unavailable") || gapHtml.includes("FY2025"),
  "Must explain the missing year. html=" + gapHtml.slice(0, 200));

assert("Gap: does not show 'Improving' signal",
  !gapHtml.includes("Improving"),
  "Must not claim Improving when data has a gap");

["insights-meta", "insights-data"].forEach(function(id) { elements[id] = makeEl(id); });
sandbox.renderInsightsSection({ companies: [SINGLE_CO] }, { guidanceMode: "guided" });
const singleHtml = elements["insights-data"].innerHTML;

assert("Single-year: does not show any YoY percentage",
  !singleHtml.includes("%") || singleHtml.includes("unavailable") || singleHtml.includes("one year"),
  "Single year must not show a percentage change");

assert("Single-year: does not show 'Improving' signal",
  !singleHtml.includes("Improving"),
  "Single year must not claim Improving");

// ---------------------------------------------------------------------------
// Part 6 — Accordion CSS: accessible details/summary structure
// ---------------------------------------------------------------------------
console.log("\n── Part 6: Accordion CSS structure ─────────────────────────────────");

assert("Accordion: details>summary uses display:flex",
  html.includes("display:flex") && html.includes("details>summary"),
  "summary must use flex for space-between chevron layout");

assert("Accordion: min-height 44px (mobile touch target)",
  html.includes("min-height:44px"),
  "Touch target must be at least 44px");

assert("Accordion: ::after chevron used (not ::before only)",
  html.includes("details>summary::after") && html.includes("details[open]>summary::after"),
  "Right-side chevron requires ::after with open/closed states");

assert("Accordion: ::before disabled (chevron moved to right)",
  html.includes("details>summary::before{display:none}"),
  "Old left-side chevron ::before must be suppressed");

assert("Accordion: hover state defined",
  html.includes("details>summary:hover"),
  "Interactive hover state must be defined");

assert("Accordion: native details/summary used (accessible)",
  html.includes("<details") && html.includes("<summary>"),
  "Must use native HTML details/summary for keyboard and screen-reader access");

// ---------------------------------------------------------------------------
// Part 7 — insight-section-label typography
// ---------------------------------------------------------------------------
console.log("\n── Part 7: Section label typography ────────────────────────────────");

assert("insight-section-label: 11px (not 10px — too small for beginners)",
  html.includes("insight-section-label{font-size:11px") ||
  html.includes("insight-section-label{font-size: 11px"),
  "Section labels must be at least 11px for readability");

assert("insight-section-label: uppercase with letter-spacing",
  html.includes("text-transform:uppercase") && html.includes("letter-spacing"),
  "Section labels should use uppercase + spacing convention");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n" + passed + " passed, " + failed + " failed");
if (failures.length) {
  console.log("\nFailed:");
  failures.forEach(function(f) { console.log("  " + f.name + (f.detail ? ": " + f.detail : "")); });
}
process.exit(failed > 0 ? 1 : 0);
