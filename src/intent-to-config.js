"use strict";
/**
 * intent-to-config.js
 *
 * Parses free-text user input into a MonitoringConfig object.
 * Zero Alva dependencies — runs with bare `node`.
 *
 * Usage:
 *   const { parseIntent } = require('./intent-to-config');
 *   const result = parseIntent("I own AAPL and MSFT, I'm new to investing");
 *   // result.ok === true  → result.config is a MonitoringConfig
 *   // result.ok === false → result.error + result.message
 *
 * CLI:
 *   echo "Monitor NVDA and AMD" | node src/intent-to-config.js
 *   node src/intent-to-config.js "Monitor NVDA and AMD"
 */

// ---------------------------------------------------------------------------
// Sector → focus area lookup table
// Covers the most common S&P 500 sectors/industries.
// Keys are lowercase for case-insensitive matching.
// ---------------------------------------------------------------------------
const SECTOR_FOCUS = {
  // Technology
  "semiconductors":              "Watch: product cycles, data-center demand, export restrictions, and supply constraints.",
  "semiconductor":               "Watch: product cycles, data-center demand, export restrictions, and supply constraints.",
  "software—infrastructure":     "Watch: cloud adoption, ARR growth, enterprise spending, and competitive displacement.",
  "software infrastructure":     "Watch: cloud adoption, ARR growth, enterprise spending, and competitive displacement.",
  "software—application":        "Watch: subscription retention, platform expansion, and regulatory risk.",
  "software application":        "Watch: subscription retention, platform expansion, and regulatory risk.",
  "consumer electronics":        "Watch: device demand, services attach rate, supply chain, and installed base.",
  "information technology":      "Watch: revenue growth, margins, and technology-cycle positioning.",
  "technology":                  "Watch: revenue growth, margins, and technology-cycle positioning.",

  // Financial Services
  "banks—regional":              "Watch: net interest margin, credit quality, deposit stability, and regulatory capital.",
  "banks regional":              "Watch: net interest margin, credit quality, deposit stability, and regulatory capital.",
  "banks—diversified":           "Watch: net interest margin, credit quality, deposit stability, and regulatory capital.",
  "banks diversified":           "Watch: net interest margin, credit quality, deposit stability, and regulatory capital.",
  "capital markets":             "Watch: trading volume, deal flow, and market cycle sensitivity.",
  "insurance":                   "Watch: underwriting performance, investment income, and catastrophe exposure.",
  "financial services":          "Watch: net interest income, credit quality, and regulatory environment.",

  // Healthcare
  "drug manufacturers—general":  "Watch: pipeline progress, patent cliffs, FDA approvals, and pricing pressure.",
  "drug manufacturers general":  "Watch: pipeline progress, patent cliffs, FDA approvals, and pricing pressure.",
  "biotechnology":               "Watch: clinical trial outcomes, regulatory decisions, and commercialization timelines.",
  "medical devices":             "Watch: regulatory approvals, procedure volumes, and competitive dynamics.",
  "healthcare":                  "Watch: revenue from key products, pipeline, and regulatory environment.",

  // Consumer Cyclical
  "auto manufacturers":          "Watch: unit deliveries, pricing power, margin trends, and technology transition.",
  "specialty retail":            "Watch: same-store sales, inventory management, and consumer spending trends.",
  "internet retail":             "Watch: GMV growth, margin trends, and logistics cost.",
  "consumer cyclical":           "Watch: consumer demand, pricing, and margin trends.",

  // Consumer Defensive
  "beverages—non-alcoholic":     "Watch: volume trends, pricing power, and distribution strength.",
  "food distribution":           "Watch: volume, pricing, and supply chain cost.",
  "consumer defensive":          "Watch: volume trends, pricing power, and distribution.",

  // Energy
  "oil & gas—integrated":        "Watch: commodity prices, capital discipline, production volumes, and energy transition.",
  "oil gas integrated":          "Watch: commodity prices, capital discipline, production volumes, and energy transition.",
  "oil & gas—e&p":               "Watch: commodity prices, reserve replacement, and cost of production.",
  "energy":                      "Watch: commodity prices, production, and capital allocation.",

  // Communication Services
  "telecom services":            "Watch: subscriber growth, ARPU, infrastructure investment, and competitive pricing.",
  "internet content & information": "Watch: advertising revenue, user engagement, regulatory scrutiny, and AI disruption.",
  "internet content information":   "Watch: advertising revenue, user engagement, regulatory scrutiny, and AI disruption.",
  "communication services":     "Watch: revenue, subscriber metrics, and regulatory environment.",

  // Industrials
  "aerospace & defense":         "Watch: defense budget, order backlog, program execution, and geopolitical risk.",
  "aerospace defense":           "Watch: defense budget, order backlog, program execution, and geopolitical risk.",
  "industrials":                 "Watch: order backlog, pricing, and end-market demand cycles.",

  // Real Estate
  "reit":                        "Watch: occupancy rates, lease renewals, interest rate sensitivity, and asset quality.",
  "real estate":                 "Watch: occupancy rates, lease renewals, interest rate sensitivity, and asset quality.",

  // Utilities
  "utilities":                   "Watch: rate case outcomes, regulatory environment, and capital plan execution.",

  // Basic Materials
  "basic materials":             "Watch: commodity prices, production costs, and demand from key end markets.",
};

const FOCUS_FALLBACK = "Watch: revenue, earnings, and business-specific developments.";

// ---------------------------------------------------------------------------
// Common-word blocklist — reject these even if uppercase in user text.
// Includes common financial acronyms that are not US equity tickers.
// ---------------------------------------------------------------------------
const COMMON_WORDS = new Set([
  // Articles, prepositions, pronouns
  "I", "A", "AN", "AT", "BE", "BY", "DO", "GO", "HE", "IF", "IN", "IS",
  "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR", "SO", "TO", "UP", "US",
  "WE", "AND", "ARE", "BUT", "CAN", "FOR", "GET", "HAD", "HAS", "HOW",
  "ITS", "NOT", "NOW", "OUT", "OWN", "SET", "THE", "TOO", "WAS", "WHO",
  "WHY", "YET", "YOU",
  // Market / financial acronyms (not equity tickers)
  "ETF", "USD", "GDP", "CPI", "PPI", "PMI", "IPO", "CEO", "CFO", "COO",
  "SEC", "FED", "IMF", "NYSE", "NASDAQ", "FCF", "EPS", "ROE", "ROA", "YOY",
  "QOQ", "YTD", "MOM", "GEX", "NAV", "VC", "PE", "YE", "NIM", "ARR",
  "MRR", "CAGR", "EBITDA", "EBITA", "EBIT",
  // Commonly confused abbreviations
  "AI", "ML", "UI", "UX", "API", "SaaS",
]);

// Well-known company name → ticker mapping (subset; used for name resolution)
const COMPANY_NAMES = {
  "apple":        "AAPL",
  "microsoft":    "MSFT",
  "nvidia":       "NVDA",
  "tesla":        "TSLA",
  "amazon":       "AMZN",
  "google":       "GOOGL",
  "alphabet":     "GOOGL",
  "meta":         "META",
  "facebook":     "META",
  "netflix":      "NFLX",
  "jpmorgan":     "JPM",
  "jp morgan":    "JPM",
  "exxon":        "XOM",
  "exxonmobil":   "XOM",
  "exxon mobil":  "XOM",
  "berkshire":    "BRK.B",
  "visa":         "V",
  "mcdonald":     "MCD",
  "mcdonalds":    "MCD",
  "walmart":      "WMT",
  "disney":       "DIS",
  "johnson":      "JNJ",
  "procter":      "PG",
  "coca cola":    "KO",
  "pepsi":        "PEP",
  "chevron":      "CVX",
  "salesforce":   "CRM",
  "adobe":        "ADBE",
  "intel":        "INTC",
  "amd":          "AMD",
  "qualcomm":     "QCOM",
  "broadcom":     "AVGO",
  "palantir":     "PLTR",
  "uber":         "UBER",
  "airbnb":       "ABNB",
  "spotify":      "SPOT",
  "shopify":      "SHOP",
};

// Crypto patterns that look like tickers but are not US equities
const CRYPTO_PATTERNS = new Set([
  "BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "MATIC", "AVAX", "DOT",
  "LINK", "UNI", "AAVE", "SHIB", "LTC", "BCH", "ATOM", "NEAR", "FTM",
  "ALGO", "XLM", "VET", "THETA", "XTZ", "EOS",
]);

// ---------------------------------------------------------------------------
// Stage 1: Extract tickers
// ---------------------------------------------------------------------------
function extractTickers(text) {
  const rejected = [];
  const seen = new Set();
  // Collect as { symbol, textIndex } then sort by position so output order
  // matches the order in which the user mentioned them.
  const candidates = [];

  const lc = text.toLowerCase();

  // Pass 1: resolve well-known company names.
  // Sort by descending name length so "jp morgan" matches before "morgan".
  const nameEntries = Object.entries(COMPANY_NAMES).sort((a, b) => b[0].length - a[0].length);
  for (const [name, ticker] of nameEntries) {
    const idx = lc.indexOf(name);
    if (idx !== -1 && !seen.has(ticker)) {
      seen.add(ticker);
      candidates.push({ symbol: ticker, textIndex: idx });
    }
  }

  // Pass 2: extract explicit uppercase ticker symbols.
  const pattern = /\b([A-Z]{1,5}(?:\.[A-Z])?)\b/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const sym = m[1];
    if (seen.has(sym)) continue;
    seen.add(sym);

    // Skip symbols that are components of a financial ratio (e.g. "P/E", "EV/EBITDA").
    // If the character immediately before or after the match is "/", it is a ratio element.
    const prevChar = text[m.index - 1] || "";
    const nextChar = text[m.index + sym.length] || "";
    if (prevChar === "/" || nextChar === "/") continue;

    if (COMMON_WORDS.has(sym)) continue; // silently skip common words and acronyms

    if (CRYPTO_PATTERNS.has(sym)) {
      rejected.push({ symbol: sym, reason: "crypto_pattern" });
    } else {
      candidates.push({ symbol: sym, textIndex: m.index });
    }
  }

  // Sort by text position so tickers appear in the order the user mentioned them.
  candidates.sort((a, b) => a.textIndex - b.textIndex);
  const valid = candidates.map(c => c.symbol);

  return { valid, rejected };
}

// ---------------------------------------------------------------------------
// Stage 2: Infer ownership classification
// ---------------------------------------------------------------------------
function inferHoldings(text, tickers) {
  const lc = text.toLowerCase();

  // Determine global default from ownership language
  const hasHoldingSignal = /\b(i own|i have|i('ve| have) bought|my position|my shares|i('m| am) holding|i hold)\b/.test(lc);
  const hasWatchlistSignal = /\b(watching|i('m| am) watching|track|tracking|keep an eye|monitor but (don'?t|do not) own)\b/.test(lc);

  const defaultClassification = hasWatchlistSignal && !hasHoldingSignal ? "watchlist" : "holding";

  const holdings = {};
  for (const ticker of tickers) {
    holdings[ticker] = defaultClassification;
  }
  return holdings;
}

// ---------------------------------------------------------------------------
// Stage 3: Infer horizon
// ---------------------------------------------------------------------------
function inferHorizon(text) {
  const lc = text.toLowerCase();

  // Unsupported horizons — caller must handle
  if (/\b(day.?trade|day.?trading|swing.?trade|swing.?trading|short.?term|scalp|intraday|< ?1 year|under a year)\b/.test(lc)) {
    return { horizon: null, unsupported: true };
  }

  // Medium-term
  if (/\b(medium.?term|1.?3 years?|couple (of )?years?|next (few|couple) years?)\b/.test(lc)) {
    return { horizon: "medium-term", unsupported: false };
  }

  // Long-term explicit
  if (/\b(long.?term|3.?5 years?|five years?|decade|retirement|hold forever|long hold)\b/.test(lc)) {
    return { horizon: "long-term", unsupported: false };
  }

  // Default
  return { horizon: "long-term", unsupported: false };
}

// ---------------------------------------------------------------------------
// Stage 4: Infer guidance mode
// Three strict priority levels — explicit preference beats contextual signals.
// ---------------------------------------------------------------------------
function inferGuidanceMode(text) {
  const lc = text.toLowerCase();

  // Priority 1: Explicit guided preference
  if (/\b(new to investing|new investor|just started investing|don'?t (really |fully )?understand|in plain english|plain english|explain (it |this )?to me|help me understand|i'?m (a )?beginner|beginner investor|not (very |too )?(financial|finance|market|invest)|rarely (follow|check)|never (follow|check|look at) (the )?market)\b/.test(lc)) {
    return "guided";
  }

  // Priority 1: Explicit standard preference
  if (/\b(assume i know|skip the basics|technical (details|analysis)|advanced (user|mode)|i('?m| am) (familiar|experienced|advanced|a (professional|quant|analyst))|financial (background|expertise))\b/.test(lc)) {
    return "standard";
  }

  // Priority 2: Contextual jargon signals → standard
  // Must use terms correctly in context, not just mention them
  const jargonPattern = /\b(ebitda|fcf|free cash flow|p\/e ratio|price.to.earnings|net interest margin|nim\b|basis points|bps\b|operating leverage|cagr|return on equity|roe\b|return on assets|roa\b|ev\/ebitda|price.to.sales|p\/s\b|earnings per share\b)\b/;
  if (jargonPattern.test(lc)) {
    return "standard";
  }

  // Priority 2: Contextual worry/confusion signals → guided
  if (/\b(should i (be )?(worried|concerned)|what does this mean( for me)?|is this (bad|good|dangerous)|what (should|do) i do|i don'?t know (what|how)|confused)\b/.test(lc)) {
    return "guided";
  }

  // Priority 3: Default
  return "neutral";
}

// ---------------------------------------------------------------------------
// Stage 5: Parse weights
// ---------------------------------------------------------------------------
function extractWeights(text, tickers) {
  // Look for patterns like "50% NVDA" or "NVDA 50%" or "NVDA: 50%"
  const weightMap = {};

  for (const ticker of tickers) {
    // "50% NVDA" or "NVDA 50%" or "NVDA: 50%" or "50 percent NVDA"
    const patterns = [
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*${ticker}\\b`, "i"),
      new RegExp(`\\b${ticker}[:\\s]+([\\d]+(?:\\.\\d+)?)\\s*%`, "i"),
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*percent\\s*${ticker}\\b`, "i"),
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        weightMap[ticker] = parseFloat(m[1]) / 100;
        break;
      }
    }
  }

  if (Object.keys(weightMap).length === 0) return null;

  // Normalize if weights don't sum to 1.0 ± 0.02
  const sum = Object.values(weightMap).reduce((a, b) => a + b, 0);
  let normalized = false;
  if (Math.abs(sum - 1.0) > 0.02) {
    for (const k of Object.keys(weightMap)) {
      weightMap[k] = Math.round((weightMap[k] / sum) * 1000) / 1000;
    }
    normalized = true;
  }

  return { weights: weightMap, normalized };
}

// ---------------------------------------------------------------------------
// Stage 6: Build preferencesNote
// Assembled deterministically — never LLM-generated.
// ---------------------------------------------------------------------------
function buildPreferencesNote(cfg) {
  const { tickers, holdings, horizon, guidanceMode, weights, sectorFocusAreas } = cfg;

  // Ownership sentence
  const owned = tickers.filter(t => (holdings[t] || "holding") === "holding");
  const watched = tickers.filter(t => holdings[t] === "watchlist");
  let ownershipSentence;
  if (owned.length > 0 && watched.length === 0) {
    ownershipSentence = `The user owns ${owned.join(", ")}.`;
  } else if (watched.length > 0 && owned.length === 0) {
    ownershipSentence = `The user is tracking (not necessarily owning) ${watched.join(", ")}.`;
  } else {
    const ownedStr = owned.length > 0 ? `owns ${owned.join(", ")}` : "";
    const watchedStr = watched.length > 0 ? `is tracking ${watched.join(", ")}` : "";
    ownershipSentence = `The user ${[ownedStr, watchedStr].filter(Boolean).join(" and ")}.`;
  }

  // Horizon
  const horizonDesc = horizon === "long-term" ? "3–5+ years" : "1–3 years";

  // Guidance instructions
  let guidanceInstructions;
  if (guidanceMode === "guided") {
    guidanceInstructions =
      "Use plain, jargon-free English. Define any financial term when it first appears. " +
      "Frame findings around what the user should pay attention to and why, not around financial mechanics.";
  } else if (guidanceMode === "standard") {
    guidanceInstructions =
      "Assume intermediate financial literacy. Use standard financial terminology without defining common terms.";
  } else {
    guidanceInstructions =
      "Use clear, accessible language. Avoid unexplained jargon but do not over-explain basic concepts.";
  }

  // Alert policy
  const alertPolicy =
    "Alert policy: focus on material long-term business developments only. " +
    "Exclude pure price movements, technical analysis, and unsubstantiated rumors. " +
    "Include: earnings/guidance changes, regulatory or legal events, strategic announcements " +
    "(M&A, partnerships), and supply-chain or product changes with multi-year business impact.";

  // Decision-support boundaries — shared across all guidance modes.
  // Present in every portfolioWatchPreferencesNote regardless of mode.
  const decisionSupportNote =
    "Guidance boundaries: do not recommend buying, selling, holding, or sizing any position. " +
    "Do not give personalized allocation guidance. " +
    "Highlight relevant evidence, known uncertainties, missing context, and questions worth investigating. " +
    "The user retains full responsibility for investment decisions.";

  // Weights note
  let weightsNote = "";
  if (weights && Object.keys(weights).length > 0) {
    const wStr = Object.entries(weights)
      .map(([t, v]) => `${t} ${Math.round(v * 100)}%`)
      .join(", ");
    weightsNote =
      `\nIllustrative allocation: ${wStr}. ` +
      "Treat as user-supplied scenario context only; do not treat as verified current weights.";
  }

  // Per-ticker focus areas
  let focusLines = "";
  if (sectorFocusAreas && Object.keys(sectorFocusAreas).length > 0) {
    focusLines =
      "\nPer-company focus:\n" +
      tickers
        .filter(t => sectorFocusAreas[t])
        .map(t => `${t}: ${sectorFocusAreas[t]}`)
        .join("\n");
  }

  // Unknown inputs note
  const unknownsNote =
    "\nQuantities, cost bases, and total portfolio value are not known. " +
    "Do not compute or imply portfolio-level performance figures or percentage gains/losses.";

  const parts = [
    ownershipSentence,
    `Investment horizon: ${horizonDesc}.`,
    "",
    guidanceInstructions,
    "",
    alertPolicy,
    "",
    decisionSupportNote,
    weightsNote,
    focusLines,
    unknownsNote,
  ];

  return parts.filter(p => p !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Stage 7: Produce sector focus area from a sector+industry string
// (Used at setup time; in local testing, sectorFocusAreas is empty.)
// ---------------------------------------------------------------------------
function sectorToFocusArea(sector, industry) {
  const key = (industry || "").toLowerCase();
  const sectorKey = (sector || "").toLowerCase();
  return SECTOR_FOCUS[key] || SECTOR_FOCUS[sectorKey] || FOCUS_FALLBACK;
}

// ---------------------------------------------------------------------------
// Main: parseIntent
// ---------------------------------------------------------------------------
function parseIntent(userText, options) {
  const opts = options || {};
  const now = opts.now || new Date();

  if (!userText || typeof userText !== "string" || userText.trim().length === 0) {
    return { ok: false, error: "empty_input", message: "No user text provided." };
  }

  // Stage 1: Tickers
  const { valid: tickers, rejected } = extractTickers(userText);

  if (tickers.length === 0 && rejected.length > 0) {
    // Only crypto or invalid symbols provided — hard stop
    return {
      ok: false,
      error: "no_valid_tickers",
      message:
        "No US-listed equity or ETF symbols were found. " +
        `Rejected: ${rejected.map(r => r.symbol).join(", ")} (${rejected[0].reason}). ` +
        "This skill monitors US-listed equities and ETFs only.",
      rejectedTickers: rejected,
    };
  }
  // tickers.length === 0 but no crypto rejections: partial config is still valid.
  // The agent will ask for tickers. Guidance mode and horizon are already determined.
  const needsTickers = tickers.length === 0;

  // Stage 3: Horizon (check before building config — unsupported horizon is a hard stop)
  const horizonResult = inferHorizon(userText);
  if (horizonResult.unsupported) {
    return {
      ok: false,
      error: "unsupported_horizon",
      message:
        "This skill focuses on long-term (3–5 year) fundamental monitoring. " +
        "Day trading and short-term strategies are outside its scope. " +
        "Would you like to set up long-term monitoring for these tickers instead?",
      tickers,
    };
  }

  // Stage 2: Holdings
  const holdings = inferHoldings(userText, tickers);

  // Stage 4: Guidance mode
  const guidanceMode = inferGuidanceMode(userText);

  // Stage 5: Weights
  const weightResult = extractWeights(userText, tickers);
  const weights = weightResult ? weightResult.weights : undefined;
  const weightsNormalized = weightResult ? weightResult.normalized : undefined;

  // Sector focus areas are populated at cloud setup time via API.
  // Locally they are left empty — a valid config state.
  const sectorFocusAreas = {};

  // Stage 6: preferencesNote
  const cfg = { tickers, holdings, horizon: horizonResult.horizon, guidanceMode, weights, sectorFocusAreas };
  const preferencesNote = buildPreferencesNote(cfg);

  const ts = now.toISOString();
  const config = {
    version: "1.0.0",
    tickers,
    holdings,
    horizon: horizonResult.horizon,
    guidanceMode,
    preferencesNote,
    sectorFocusAreas,
    createdAt: ts,
    updatedAt: ts,
  };

  if (weights) config.weights = weights;
  if (weightsNormalized) config.weightsNormalized = weightsNormalized;
  if (rejected.length > 0) config.rejectedTickers = rejected;

  const result = { ok: true, config };
  if (needsTickers) result.needsTickers = true;
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  parseIntent,
  // Expose internals for targeted unit testing
  extractTickers,
  inferHoldings,
  inferHorizon,
  inferGuidanceMode,
  extractWeights,
  buildPreferencesNote,
  sectorToFocusArea,
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const input = process.argv[2] ||
    (process.stdin.isTTY ? null : require("fs").readFileSync("/dev/stdin", "utf8"));

  if (!input) {
    console.error("Usage: node src/intent-to-config.js \"<user text>\"");
    process.exit(1);
  }

  const result = parseIntent(input.trim());
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
