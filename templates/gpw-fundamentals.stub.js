"use strict";
/**
 * gpw-fundamentals.stub.js
 * Fetches income, balance sheet, and cashflow for each ticker in the shared
 * MonitoringConfig.
 *
 * SINGLE SOURCE OF TRUTH: Both gpw-monitor and gpw-fundamentals read from
 * ~/feeds/gpw-monitor/v1/config.json. Never create a separate config here.
 *
 * CLOUD RESOURCE SAFETY: This feed's cronjob is ID 40870. Do NOT reuse or
 * overwrite baseline cronjobs 40804 or 40805.
 *
 * API PATTERN: Uses net/http + secret-manager for Arrays REST, matching the
 * proven long-term-fundamentals baseline. @arrays/* module imports do not exist.
 *
 * NOTE: The cloud runtime does not support top-level await. All async logic
 * is inside the (async () => {})() IIFE.
 */

const { Feed, feedPath, makeDoc, str } = require("@alva/feed");
const alfs = require("alfs");

const feed = new Feed({ path: feedPath("gpw-fundamentals") });
feed.def("fundamentals", {
  snapshot: makeDoc("Fundamentals Snapshot", "Income, balance, cashflow per ticker", [
    str("payloadJson"),
    str("asOf"),
    str("monitoringConfigVersion"),
  ]),
});

(async () => {
  // ── Config ──────────────────────────────────────────────────────────────────
  // Single source of truth: read shared MonitoringConfig from gpw-monitor path.
  const configPath = feedPath("gpw-monitor") + "/config.json";
  const cfg = JSON.parse(String(await alfs.readFile(configPath)));

  // Runtime validation — fail fast before making any API calls.
  if (!cfg || !Array.isArray(cfg.tickers) || cfg.tickers.length === 0)
    throw new Error("gpw-fundamentals: config.json missing or has no tickers.");
  if (cfg.tickers.length > 15)
    throw new Error(`gpw-fundamentals: too many tickers (${cfg.tickers.length}/15).`);
  const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
  for (const t of cfg.tickers) {
    if (!TICKER_RE.test(t))
      throw new Error(`gpw-fundamentals: invalid symbol "${t}" in config.`);
  }

  const TICKERS = cfg.tickers;

  // ── Arrays REST API — proven pattern from long-term-fundamentals baseline ──
  const h   = require("net/http");
  const jwt = require("secret-manager").loadPlaintext("ARRAYS_JWT");
  const now = Date.now();

  // Five-year window for time-series endpoints (unix seconds).
  const startTime = Math.floor(now / 1000 - 5 * 366 * 86400);
  const endTime   = Math.floor(now / 1000);

  /**
   * Fetch one Arrays company endpoint for a symbol.
   * @param {string} symbol  - e.g. "NVDA"
   * @param {string} endpoint - "detail" | "income-statements" | "balance-sheets" | "cashflow-statements"
   */
  async function fetchEndpoint(symbol, endpoint) {
    const timeQuery = endpoint === "detail"
      ? ""
      : `&start_time=${startTime}&end_time=${endTime}&time_type=CALENDAR_END_DATE`;
    const url = `https://data-tools.prd.arrays.org/api/v1/stocks/company/${endpoint}?symbol=${symbol}${timeQuery}`;
    const r = await h.fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) throw new Error(`gpw-fundamentals: ${symbol} ${endpoint} HTTP ${r.status}`);
    const body = r.json();
    if (!Array.isArray(body.data) || !body.data.length)
      throw new Error(`gpw-fundamentals: ${symbol} ${endpoint} returned empty data`);
    return body.data;
  }

  // ── Fetch all companies in parallel ─────────────────────────────────────────
  const companies = await Promise.all(TICKERS.map(async (symbol) => {
    const [profiles, allIncome, balance, cashflow] = await Promise.all([
      fetchEndpoint(symbol, "detail"),
      fetchEndpoint(symbol, "income-statements"),
      fetchEndpoint(symbol, "balance-sheets"),
      fetchEndpoint(symbol, "cashflow-statements"),
    ]);

    // Identify the primary listed equity for this symbol.
    const profile = profiles.find(p => p.symbol === symbol && p.is_listed && !p.is_etf);
    if (!profile) throw new Error(`gpw-fundamentals: no listed equity found for ${symbol}`);

    // Sort by calendar_end_date descending — never assume API order.
    const byDateDesc = (a, b) => (b.calendar_end_date || "").localeCompare(a.calendar_end_date || "");

    // Income-statements returns both annual (period=FY) and quarterly in one call.
    const income  = allIncome.filter(r => r.period === "FY").sort(byDateDesc);
    const incomeQ = allIncome.filter(r => r.period !== "FY").sort(byDateDesc).slice(0, 8);

    return {
      symbol,
      name:     profile.name,
      exchange: profile.exchange,
      // Sector and industry are included if the API provides them; null otherwise.
      // The Playbook displays "—" for null values.
      sector:   profile.sector   || null,
      industry: profile.industry || null,
      income,
      incomeQ,
      balance:  [...balance].sort(byDateDesc),
      cashflow: [...cashflow].sort(byDateDesc),
    };
  }));

  // ── Write snapshot ───────────────────────────────────────────────────────────
  const asOf = Date.now();
  await feed.run(async (ctx) => {
    await ctx.self.ts("fundamentals", "snapshot").append([{
      date:                    asOf,
      asOf:                    new Date(asOf).toISOString(),
      monitoringConfigVersion: cfg.version || "1.0.0",
      payloadJson:             JSON.stringify({
        asOf,
        monitoringContext: {
          horizon:      cfg.horizon,
          tickers:      TICKERS,
          weights:      cfg.weights      || null,
          // Non-sensitive display fields — derived from canonical MonitoringConfig.
          // Exposed to Playbook viewers; includes holding status labels only (no quantities/values).
          // guidanceMode left null if not set — Playbook must not assume a default.
          guidanceMode: cfg.guidanceMode || null,
          holdings:     cfg.holdings     || {},
        },
        companies,
      }),
    }]);
  });
})();
