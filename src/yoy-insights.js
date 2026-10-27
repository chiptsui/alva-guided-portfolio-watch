"use strict";
/**
 * yoy-insights.js
 *
 * Pure year-over-year financial insight calculations.
 * No Alva SDK dependencies — runs in Node.js (tests) and is inlined in the browser Playbook.
 *
 * Labeling contract:
 *   metrics.*       — FACTUAL: directly computed from filed financial statements.
 *   signal          — FACTUAL: a classification derived from metrics with defined thresholds.
 *   insightText()   — plain-language rendering; interpretive sentences are explicitly marked.
 *
 * Nothing here fabricates events, news, prices, or forward-looking claims.
 */

// Annual data older than 18 months gets a staleness note.
var STALE_FY_MS = 540 * 86400000;

// Industry-specific watch focus text.
// Keys must be lowercase. Handles common API variants (e.g. "auto - manufacturers").
var INDUSTRY_WATCH = {
  "semiconductors":        "product cycles, data-center demand, export restrictions, and supply constraints",
  "auto manufacturers":    "unit deliveries, pricing power, gross margin trends, and EV adoption pace",
  "auto - manufacturers":  "unit deliveries, pricing power, gross margin trends, and EV adoption pace",
  "consumer electronics":  "device demand, services attach rate, supply chain, and installed base growth",
  "software—infrastructure":"cloud adoption, ARR growth, enterprise spending, and competitive displacement",
  "software infrastructure":"cloud adoption, ARR growth, enterprise spending, and competitive displacement",
  "internet retail":       "GMV growth, margin trends, and logistics cost",
  "biotechnology":         "clinical trial outcomes, regulatory decisions, and commercialization timelines",
  "drug manufacturers—general":"pipeline progress, patent cliffs, FDA approvals, and pricing pressure",
};
var WATCH_FALLBACK = "revenue growth, margin trends, and business-specific developments";

// ---------------------------------------------------------------------------
// Sorting

function byDateDesc(a, b) {
  return (b.calendar_end_date || "").localeCompare(a.calendar_end_date || "");
}

// ---------------------------------------------------------------------------
// Core calculations

/**
 * Calculate year-over-year fractional change.
 * Returns null if inputs are not numbers or previous is zero.
 */
function calcYoY(current, prior) {
  if (typeof current !== "number" || current === null) return null;
  if (typeof prior   !== "number" || prior   === null) return null;
  if (prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}

/**
 * Match a cashflow row to an income row.
 * Primary match: fiscal_year + period + calendar_end_date.
 * Fallback:      fiscal_year + period.
 */
function matchCashflow(cashflowArr, incomeRow) {
  if (!cashflowArr || !incomeRow) return null;
  return (
    cashflowArr.find(function(c) {
      return c.period            === incomeRow.period
          && c.fiscal_year       === incomeRow.fiscal_year
          && c.calendar_end_date === incomeRow.calendar_end_date;
    }) ||
    cashflowArr.find(function(c) {
      return c.period      === incomeRow.period
          && c.fiscal_year === incomeRow.fiscal_year;
    }) ||
    null
  );
}

/**
 * Returns true if fy0 and fy1 are consecutive fiscal years (fy0 is exactly one year after fy1).
 */
function areConsecutiveFiscalYears(fy0, fy1) {
  var a = parseInt(fy0.fiscal_year, 10);
  var b = parseInt(fy1.fiscal_year, 10);
  return !isNaN(a) && !isNaN(b) && (a - b === 1);
}

/**
 * Derive a directional signal from revenue, net income, and free cash flow YoY changes.
 * Uses a 1% deadband to avoid noise on flat years.
 * FCF qualifier: if P&L is "improving" but FCF declined more than 5%, signal is downgraded to "mixed".
 * Returns: "improving" | "mixed" | "declining" | "insufficient"
 *
 * This is a FACTUAL classification based on defined thresholds — not editorial.
 */
function deriveSignal(revYoY, niYoY, fcfYoY) {
  var scores = [];
  if (revYoY !== null) scores.push(revYoY >  0.01 ?  1 : revYoY < -0.01 ? -1 : 0);
  if (niYoY  !== null) scores.push(niYoY  >  0.01 ?  1 : niYoY  < -0.01 ? -1 : 0);
  if (scores.length === 0) return "insufficient";
  var total = scores.reduce(function(a, b) { return a + b; }, 0);
  var plSignal = total ===  scores.length ? "improving"
               : total === -scores.length ? "declining"
               : "mixed";
  // FCF qualifier: a meaningful FCF decline (>5%) alongside improving P&L signals mixed results.
  if (plSignal === "improving" && typeof fcfYoY === "number" && fcfYoY < -0.05) {
    return "mixed";
  }
  return plSignal;
}

// ---------------------------------------------------------------------------
// Main computation

/**
 * Compute YoY insights for one company from the fundamentals snapshot payload.
 *
 * @param {object} company - A companies[] entry from payload.companies.
 * @returns {object} Structured insight; always returns an object, never throws.
 */
function computeCompanyInsight(company) {
  var income   = (company.income   || []).slice().sort(byDateDesc);
  var cashflow = (company.cashflow || []).slice().sort(byDateDesc);

  var fy0 = income.length > 0 ? income[0] : null;

  if (!fy0) {
    return { symbol: company.symbol, name: company.name, status: "no_data" };
  }

  // Prior year: must be exactly one fiscal year before fy0 (consecutive-year enforcement).
  // Using income[1] would silently compare FY2026 vs FY2024 when FY2025 is absent.
  var fy0Year = parseInt(fy0.fiscal_year, 10);
  var fy1 = null;
  if (!isNaN(fy0Year)) {
    for (var i = 1; i < income.length; i++) {
      if (parseInt(income[i].fiscal_year, 10) === fy0Year - 1) {
        fy1 = income[i];
        break;
      }
    }
  }

  var hasMultipleYears = income.length > 1;

  var cf0 = matchCashflow(cashflow, fy0);
  var cf1 = fy1 ? matchCashflow(cashflow, fy1) : null;

  var fyAgeMs   = Date.now() - Date.parse(fy0.calendar_end_date || "");
  var fyIsStale = fyAgeMs > STALE_FY_MS;

  var revYoY = fy1 ? calcYoY(fy0.revenue,   fy1.revenue)   : null;
  var niYoY  = fy1 ? calcYoY(fy0.net_income, fy1.net_income) : null;

  var fcfCur = cf0 ? cf0.free_cash_flow : null;
  var fcfPri = cf1 ? cf1.free_cash_flow : null;
  var fcfYoY = (fcfCur !== null && fcfPri !== null) ? calcYoY(fcfCur, fcfPri) : null;

  var grossMarginDelta = (fy1
    && typeof fy0.gross_profit_ratio === "number"
    && typeof fy1.gross_profit_ratio === "number")
    ? fy0.gross_profit_ratio - fy1.gross_profit_ratio : null;

  var watchKey  = (company.industry || "").toLowerCase();
  var watchText = INDUSTRY_WATCH[watchKey] || WATCH_FALLBACK;

  return {
    symbol:   company.symbol,
    name:     company.name,
    sector:   company.sector   || null,
    industry: company.industry || null,
    // "ok" = consecutive pair found; "no_consecutive_pair" = data exists but prior FY absent;
    // "single_year" = only one income row in the dataset.
    status: fy1 ? "ok" : (hasMultipleYears ? "no_consecutive_pair" : "single_year"),
    fyIsStale: fyIsStale,
    period: {
      current: { fy: fy0.fiscal_year, date: fy0.calendar_end_date, currency: fy0.reported_currency },
      prior:   fy1 ? { fy: fy1.fiscal_year, date: fy1.calendar_end_date } : null,
    },
    // FACTUAL: values and fractions directly from filed statements
    metrics: {
      revenue:     { current: fy0.revenue,    prior: fy1 ? fy1.revenue    : null, yoy: revYoY },
      netIncome:   { current: fy0.net_income,  prior: fy1 ? fy1.net_income  : null, yoy: niYoY  },
      freeCashFlow:{ current: fcfCur,           prior: fcfPri,              yoy: fcfYoY },
      grossMarginCurrent: fy0.gross_profit_ratio,
      grossMarginDelta:   grossMarginDelta,
      capexCurrent: cf0 ? cf0.capital_expenditure : null,
      capexPrior:   cf1 ? cf1.capital_expenditure : null,
    },
    // FACTUAL: true = fy1 is the immediate prior FY; false = gap exists; null = only one year.
    consecutiveYears: fy1 ? true : (hasMultipleYears ? false : null),
    // FACTUAL: classification derived from defined thresholds
    signal: fy1 ? deriveSignal(revYoY, niYoY, fcfYoY) : "insufficient",
    watchText:  watchText,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (browser-safe, no locale required for polyfill environments)

/** Format a YoY fraction as "+65.5%" or "−2.9%", or null if not available. */
function fmtYoY(yoy) {
  if (yoy === null || yoy === undefined) return null;
  var pct  = yoy * 100;
  var sign = pct >= 0 ? "+" : "\u2212"; // Unicode minus sign
  return sign + Math.abs(pct).toFixed(1) + "%";
}

/** Format a dollar amount in billions, e.g. "$215.9B". Returns null if not a number. */
function fmtBn(x) {
  if (typeof x !== "number" || x === null) return null;
  return "$" + (x / 1e9).toFixed(1) + "B";
}

/** Format a gross-margin delta in percentage points, e.g. "+2.1pp". */
function fmtMarginDelta(delta) {
  if (delta === null || delta === undefined) return null;
  var pp   = delta * 100;
  var sign = pp >= 0 ? "+" : "\u2212";
  return sign + Math.abs(pp).toFixed(1) + "pp";
}

// ---------------------------------------------------------------------------
// Exports

module.exports = {
  computeCompanyInsight,
  calcYoY,
  matchCashflow,
  byDateDesc,
  areConsecutiveFiscalYears,
  deriveSignal,
  fmtYoY,
  fmtBn,
  fmtMarginDelta,
  INDUSTRY_WATCH,
  WATCH_FALLBACK,
};
