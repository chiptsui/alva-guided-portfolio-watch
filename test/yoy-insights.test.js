"use strict";
/**
 * yoy-insights.test.js — focused tests for YoY calculations and edge cases.
 *
 * Usage: node test/yoy-insights.test.js
 * Exit code: 0 = all pass, 1 = any fail.
 */

const {
  calcYoY,
  matchCashflow,
  areConsecutiveFiscalYears,
  deriveSignal,
  computeCompanyInsight,
  fmtYoY,
  fmtBn,
  fmtMarginDelta,
} = require("../src/yoy-insights");

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
// calcYoY
// ---------------------------------------------------------------------------
console.log("\ncalcYoY");

assert("positive growth", near(calcYoY(130, 100), 0.30), "130 vs 100 = +30%");
assert("decline",         near(calcYoY(70,  100), -0.30), "70 vs 100 = -30%");
assert("flat year",       near(calcYoY(100, 100),  0.00), "100 vs 100 = 0%");
assert("returns null when current is null",  calcYoY(null, 100) === null);
assert("returns null when prior is null",    calcYoY(100, null) === null);
assert("returns null when prior is zero",    calcYoY(100, 0)    === null, "division by zero guard");
assert("returns null when current is non-number", calcYoY("x", 100) === null);
assert("negative prior (loss recovery)",
  near(calcYoY(10, -100), 1.10),   // (10 - (-100)) / |-100| = 110/100 = 1.10
  "(10-(-100))/|-100| = +1.10 (swing from loss to profit)");
assert("negative to deeper negative",
  near(calcYoY(-150, -100), -0.50),
  "(-150-(-100))/100 = -0.50");

// ---------------------------------------------------------------------------
// matchCashflow
// ---------------------------------------------------------------------------
console.log("\nmatchCashflow");

const cfArr = [
  { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", free_cash_flow: 96676000000 },
  { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", free_cash_flow: 60853000000 },
  { period: "Q1", fiscal_year: "2026", calendar_end_date: "2025-04-27", free_cash_flow: 12000000000 },
];

assert("exact match (FY2026)",
  matchCashflow(cfArr, { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25" })
    .free_cash_flow === 96676000000);

assert("exact match (FY2025)",
  matchCashflow(cfArr, { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26" })
    .free_cash_flow === 60853000000);

assert("fallback match (period+fy only, different date)",
  matchCashflow(cfArr, { period: "FY", fiscal_year: "2026", calendar_end_date: "1900-01-01" })
    .free_cash_flow === 96676000000,
  "falls back to fy+period when date differs");

assert("no match returns null",
  matchCashflow(cfArr, { period: "FY", fiscal_year: "2019", calendar_end_date: "2019-01-27" }) === null);

assert("empty cashflow array returns null",
  matchCashflow([], { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25" }) === null);

assert("null cashflow array returns null",
  matchCashflow(null, { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25" }) === null);

// ---------------------------------------------------------------------------
// deriveSignal
// ---------------------------------------------------------------------------
console.log("\nderiveSignal");

assert("both positive → improving",    deriveSignal(0.30, 0.20) === "improving");
assert("both negative → declining",    deriveSignal(-0.10, -0.30) === "declining");
assert("rev up NI down → mixed",       deriveSignal(0.10, -0.20) === "mixed");
assert("rev down NI up → mixed",       deriveSignal(-0.05, 0.15) === "mixed");
assert("both null → insufficient",     deriveSignal(null, null)  === "insufficient");
assert("one null, one positive → improving",
  deriveSignal(0.20, null) === "improving",
  "single metric positive counts as improving");
assert("one null, one negative → declining",
  deriveSignal(null, -0.10) === "declining");
assert("within deadband → mixed (not improving)",
  deriveSignal(0.005, 0.003) === "mixed",
  "< 1% threshold does not count as positive");

// FCF qualifier (3rd argument)
assert("both P&L positive, FCF null → improving (no qualifier)",
  deriveSignal(0.30, 0.20, null) === "improving");
assert("both P&L positive, FCF +20% → improving (FCF not negative)",
  deriveSignal(0.30, 0.20, 0.20) === "improving");
assert("both P&L positive, FCF -3% → improving (below 5% threshold)",
  deriveSignal(0.064, 0.195, -0.03) === "improving",
  "FCF -3% is within noise threshold");
assert("both P&L positive, FCF -9.2% → mixed (AAPL case)",
  deriveSignal(0.064, 0.195, -0.092) === "mixed",
  "FCF -9.2% downgrade: P&L improving but FCF drag signals mixed");
assert("both P&L positive, FCF -6% → mixed (just over 5% threshold)",
  deriveSignal(0.20, 0.30, -0.06) === "mixed");
assert("both P&L negative, FCF +74% → declining (FCF does NOT upgrade declining P&L)",
  deriveSignal(-0.029, -0.468, 0.737) === "declining",
  "TSLA case: FCF improvement should not change declining signal");

// ---------------------------------------------------------------------------
// computeCompanyInsight — with realistic snapshot data
// ---------------------------------------------------------------------------
console.log("\ncomputeCompanyInsight");

// Mock data matching real NVDA snapshot structure
const nvdaCompany = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", revenue: 215938000000, net_income: 120067000000, gross_profit_ratio: 0.7107 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", revenue: 130497000000, net_income:  72880000000, gross_profit_ratio: 0.7480 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-01-28", revenue:  60922000000, net_income:  29760000000, gross_profit_ratio: 0.7252 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-01-25", operating_cash_flow: 102718000000, free_cash_flow: 96676000000, capital_expenditure: -6042000000 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-01-26", operating_cash_flow:  64089000000, free_cash_flow: 60853000000, capital_expenditure: -3236000000 },
  ],
  balance: [],
  incomeQ: [],
};

const nvda = computeCompanyInsight(nvdaCompany);

assert("NVDA status is ok",           nvda.status === "ok");
assert("NVDA signal is improving",    nvda.signal === "improving");
assert("NVDA revYoY near +65.5%",     near(nvda.metrics.revenue.yoy,   0.6553, 0.001));
assert("NVDA niYoY near +64.7%",      near(nvda.metrics.netIncome.yoy, 0.6475, 0.001));
assert("NVDA fcfYoY near +58.9%",     near(nvda.metrics.freeCashFlow.yoy, 0.5889, 0.001));
assert("NVDA period.current.fy",      nvda.period.current.fy === "2026");
assert("NVDA period.prior.fy",        nvda.period.prior.fy   === "2025");
assert("NVDA not stale",              nvda.fyIsStale === false);
assert("NVDA watchText contains 'semiconductor'",
  nvda.watchText.toLowerCase().includes("data-center"));

// TSLA — declining signal
const tslaCompany = {
  symbol: "TSLA",
  name: "Tesla, Inc.",
  sector: "Consumer Cyclical",
  industry: "Auto - Manufacturers",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 94827000000, net_income: 3794000000,  gross_profit_ratio: 0.1803 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 97690000000, net_income: 7130000000,  gross_profit_ratio: 0.1778 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", operating_cash_flow: 14747000000, free_cash_flow:  6220000000, capital_expenditure: -8527000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", operating_cash_flow: 14923000000, free_cash_flow:  3581000000, capital_expenditure: -11342000000 },
  ],
  balance: [],
  incomeQ: [],
};

const tsla = computeCompanyInsight(tslaCompany);

assert("TSLA status is ok",          tsla.status  === "ok");
assert("TSLA signal is declining",   tsla.signal  === "declining");
assert("TSLA revYoY near −2.9%",     near(tsla.metrics.revenue.yoy,   -0.0293, 0.001));
assert("TSLA niYoY near −46.8%",     near(tsla.metrics.netIncome.yoy, -0.4677, 0.001));
assert("TSLA fcfYoY is positive",    tsla.metrics.freeCashFlow.yoy > 0,
  "FCF improved despite declining revenue+NI due to lower capex");

// AAPL — improving revenue+NI, declining FCF
const aaplCompany = {
  symbol: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  industry: "Consumer Electronics",
  income: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", revenue: 416161000000, net_income: 112010000000, gross_profit_ratio: 0.4691 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", revenue: 391035000000, net_income:  93736000000, gross_profit_ratio: 0.4621 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-09-27", operating_cash_flow: 111482000000, free_cash_flow:  98767000000, capital_expenditure: -12715000000 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-09-28", operating_cash_flow: 118254000000, free_cash_flow: 108807000000, capital_expenditure:  -9447000000 },
  ],
  balance: [],
  incomeQ: [],
};

const aapl = computeCompanyInsight(aaplCompany);

assert("AAPL status is ok",          aapl.status === "ok");
assert("AAPL signal is mixed",       aapl.signal === "mixed",
  "rev+NI both positive but FCF -9.2% → mixed (FCF qualifier)");
assert("AAPL revYoY near +6.4%",     near(aapl.metrics.revenue.yoy,   0.0643, 0.001));
assert("AAPL niYoY near +19.5%",     near(aapl.metrics.netIncome.yoy, 0.1950, 0.001));
assert("AAPL fcfYoY is negative",    aapl.metrics.freeCashFlow.yoy < 0,
  "FCF declined due to higher capex");
assert("AAPL watchText contains 'device'", aapl.watchText.includes("device"));

// Edge cases
console.log("\ncomputeCompanyInsight — edge cases");

assert("no income data returns no_data",
  computeCompanyInsight({ symbol: "X", name: "X Inc.", income: [], cashflow: [] }).status === "no_data");

assert("single income year returns single_year",
  computeCompanyInsight({
    symbol: "X", name: "X Inc.",
    income: [{ period:"FY", fiscal_year:"2025", calendar_end_date:"2025-12-31", revenue:1e9, net_income:1e8 }],
    cashflow: [],
  }).status === "single_year");

assert("single_year has null yoy values",
  computeCompanyInsight({
    symbol: "X", name: "X Inc.",
    income: [{ period:"FY", fiscal_year:"2025", calendar_end_date:"2025-12-31", revenue:1e9, net_income:1e8 }],
    cashflow: [],
  }).metrics.revenue.yoy === null);

assert("missing cashflow rows produce null fcfYoY",
  computeCompanyInsight({
    symbol: "Y", name: "Y Inc.",
    income: [
      { period:"FY", fiscal_year:"2025", calendar_end_date:"2025-12-31", revenue:2e9, net_income:1e8 },
      { period:"FY", fiscal_year:"2024", calendar_end_date:"2024-12-31", revenue:1e9, net_income:5e7 },
    ],
    cashflow: [],
  }).metrics.freeCashFlow.yoy === null);

// Stale data: FY end date more than 540 days ago
const staleCompany = {
  symbol: "Z",
  name: "Z Corp",
  sector: null,
  industry: null,
  income: [
    // Date far in the past so it is always stale
    { period: "FY", fiscal_year: "2019", calendar_end_date: "2019-12-31", revenue: 1e9, net_income: 1e8 },
    { period: "FY", fiscal_year: "2018", calendar_end_date: "2018-12-31", revenue: 9e8, net_income: 9e7 },
  ],
  cashflow: [],
};

assert("stale data flagged correctly",
  computeCompanyInsight(staleCompany).fyIsStale === true);

assert("stale data still computes signal",
  computeCompanyInsight(staleCompany).signal === "improving");

// ---------------------------------------------------------------------------
// areConsecutiveFiscalYears
// ---------------------------------------------------------------------------
console.log("\nareConsecutiveFiscalYears");

assert("2025→2026 consecutive",
  areConsecutiveFiscalYears({ fiscal_year: "2026" }, { fiscal_year: "2025" }) === true);
assert("2024→2026 non-consecutive (gap)",
  areConsecutiveFiscalYears({ fiscal_year: "2026" }, { fiscal_year: "2024" }) === false);
assert("same year not consecutive",
  areConsecutiveFiscalYears({ fiscal_year: "2025" }, { fiscal_year: "2025" }) === false);
assert("non-numeric fiscal year returns false",
  areConsecutiveFiscalYears({ fiscal_year: "TTM" }, { fiscal_year: "2025" }) === false);

// computeCompanyInsight exposes consecutiveYears
assert("NVDA consecutiveYears true (FY2025→FY2026)",
  computeCompanyInsight(nvdaCompany).consecutiveYears === true);
assert("non-consecutive years: consecutiveYears false",
  computeCompanyInsight({
    symbol: "G", name: "G Inc.",
    income: [
      { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 2e9, net_income: 1e8 },
      { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 1e9, net_income: 5e7 },
    ],
    cashflow: [],
  }).consecutiveYears === false);

// ---------------------------------------------------------------------------
// Consecutive-year gap enforcement (regression: FY2026 + FY2024, FY2025 missing)
// ---------------------------------------------------------------------------
console.log("\nConsecutive-year gap enforcement");

const gapCompany = {
  symbol: "GAP", name: "Gap Corp",
  sector: null, industry: null,
  income: [
    // FY2025 is intentionally absent — simulates missing data
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 150e9, net_income: 15e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 100e9, net_income: 10e9 },
  ],
  cashflow: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", free_cash_flow: 12e9, operating_cash_flow: 15e9, capital_expenditure: -3e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", free_cash_flow:  8e9, operating_cash_flow: 10e9, capital_expenditure: -2e9 },
  ],
};

const gapInsight = computeCompanyInsight(gapCompany);

assert("gap: status is no_consecutive_pair",
  gapInsight.status === "no_consecutive_pair",
  "Must not claim 'ok' when FY2025 is missing");

assert("gap: revYoY is null (no YoY percentage displayed)",
  gapInsight.metrics.revenue.yoy === null,
  "Must NOT show +50% (a two-year change, not YoY)");

assert("gap: niYoY is null",
  gapInsight.metrics.netIncome.yoy === null);

assert("gap: fcfYoY is null",
  gapInsight.metrics.freeCashFlow.yoy === null);

assert("gap: signal is insufficient",
  gapInsight.signal === "insufficient",
  "Signal must be insufficient when no consecutive pair exists");

assert("gap: consecutiveYears is false",
  gapInsight.consecutiveYears === false);

// Regression: ensure that with FY2025 present, YoY is computed normally
const gapCompanyFixed = {
  symbol: "GAP", name: "Gap Corp",
  sector: null, industry: null,
  income: [
    { period: "FY", fiscal_year: "2026", calendar_end_date: "2026-12-31", revenue: 150e9, net_income: 15e9 },
    { period: "FY", fiscal_year: "2025", calendar_end_date: "2025-12-31", revenue: 120e9, net_income: 12e9 },
    { period: "FY", fiscal_year: "2024", calendar_end_date: "2024-12-31", revenue: 100e9, net_income: 10e9 },
  ],
  cashflow: [],
};
const gapFixed = computeCompanyInsight(gapCompanyFixed);
assert("gap-fixed: selects FY2026 vs FY2025 (not FY2024)",
  gapFixed.period.prior.fy === "2025" && gapFixed.consecutiveYears === true);
assert("gap-fixed: revYoY is +25% (FY2026 vs FY2025, not FY2024)",
  Math.abs(gapFixed.metrics.revenue.yoy - 0.25) < 0.001,
  "Should compare FY2026 $150B vs FY2025 $120B = +25%, not FY2024 $100B = +50%");

// ---------------------------------------------------------------------------
// fmtYoY / fmtBn / fmtMarginDelta
// ---------------------------------------------------------------------------
console.log("\nFormatting helpers");

assert("fmtYoY positive",           fmtYoY(0.655)  === "+65.5%");
assert("fmtYoY negative uses minus sign", fmtYoY(-0.029).startsWith("\u2212"),
  "uses Unicode minus, not hyphen");
assert("fmtYoY zero",               fmtYoY(0.0)    === "+0.0%");
assert("fmtYoY null returns null",  fmtYoY(null)   === null);
assert("fmtBn billions",            fmtBn(215938000000) === "$215.9B");
assert("fmtBn null returns null",   fmtBn(null)    === null);
assert("fmtBn non-number returns null", fmtBn("x") === null);
assert("fmtMarginDelta positive",   fmtMarginDelta(0.021) === "+2.1pp");
assert("fmtMarginDelta negative uses minus", fmtMarginDelta(-0.037).startsWith("\u2212"));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n" + passed + " passed, " + failed + " failed");
if (failures.length > 0) {
  console.log("\nFailed tests:");
  failures.forEach(function(f) { console.log("  " + f.name + (f.detail ? ": " + f.detail : "")); });
}
process.exit(failed > 0 ? 1 : 0);
