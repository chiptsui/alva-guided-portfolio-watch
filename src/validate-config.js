"use strict";
/**
 * validate-config.js
 *
 * Runtime validator for MonitoringConfig objects.
 * Enforces the same constraints as config/monitoring-config.schema.json.
 * Zero external dependencies — runs with bare `node`.
 *
 * Usage:
 *   const { validateConfig } = require('./validate-config');
 *   const { valid, errors } = validateConfig(cfg);
 */

const TICKER_RE  = /^[A-Z]{1,5}(\.[A-Z])?$/;
const SEMVER_RE  = /^\d+\.\d+\.\d+$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const REQUIRED = [
  "version", "tickers", "holdings", "horizon",
  "guidanceMode", "preferencesNote", "createdAt", "updatedAt",
];

function validateConfig(cfg) {
  const errors = [];

  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return { valid: false, errors: ["Config must be a non-null object"] };
  }

  // Required fields present
  for (const f of REQUIRED) {
    if (!(f in cfg)) errors.push(`Missing required field: "${f}"`);
  }
  // Bail early if required fields missing — further checks would cascade
  if (errors.length > 0) return { valid: false, errors };

  // version: semver
  if (!SEMVER_RE.test(cfg.version)) {
    errors.push(`version: must match x.y.z, got ${JSON.stringify(cfg.version)}`);
  }

  // tickers: array of 1–15 unique valid symbols
  if (!Array.isArray(cfg.tickers)) {
    errors.push("tickers: must be an array");
  } else {
    if (cfg.tickers.length < 1)  errors.push("tickers: must have at least 1 item");
    if (cfg.tickers.length > 15) errors.push(`tickers: max 15 items, got ${cfg.tickers.length}`);
    const seen = new Set();
    for (const t of cfg.tickers) {
      if (typeof t !== "string" || !TICKER_RE.test(t)) {
        errors.push(`tickers: invalid symbol ${JSON.stringify(t)}`);
      } else if (seen.has(t)) {
        errors.push(`tickers: duplicate symbol "${t}"`);
      }
      seen.add(t);
    }
  }

  // holdings: object, values must be "holding"|"watchlist", all tickers covered
  if (typeof cfg.holdings !== "object" || Array.isArray(cfg.holdings)) {
    errors.push("holdings: must be an object");
  } else {
    for (const [k, v] of Object.entries(cfg.holdings)) {
      if (!["holding", "watchlist"].includes(v)) {
        errors.push(`holdings.${k}: must be "holding" or "watchlist", got ${JSON.stringify(v)}`);
      }
    }
    if (Array.isArray(cfg.tickers)) {
      for (const t of cfg.tickers) {
        if (!(t in cfg.holdings)) {
          errors.push(`holdings: missing entry for ticker "${t}"`);
        }
      }
    }
  }

  // horizon
  if (!["long-term", "medium-term"].includes(cfg.horizon)) {
    errors.push(`horizon: must be "long-term" or "medium-term", got ${JSON.stringify(cfg.horizon)}`);
  }

  // guidanceMode
  if (!["guided", "standard", "neutral"].includes(cfg.guidanceMode)) {
    errors.push(`guidanceMode: must be "guided", "standard", or "neutral", got ${JSON.stringify(cfg.guidanceMode)}`);
  }

  // preferencesNote: string, min 50 chars
  if (typeof cfg.preferencesNote !== "string") {
    errors.push("preferencesNote: must be a string");
  } else if (cfg.preferencesNote.length < 50) {
    errors.push(`preferencesNote: must be at least 50 characters (got ${cfg.preferencesNote.length})`);
  }

  // weights (optional): fractions 0–1, sum must equal 1.0 ±0.02
  if ("weights" in cfg && cfg.weights !== undefined) {
    if (typeof cfg.weights !== "object" || Array.isArray(cfg.weights)) {
      errors.push("weights: must be an object");
    } else {
      for (const [k, v] of Object.entries(cfg.weights)) {
        if (typeof v !== "number" || v < 0 || v > 1) {
          errors.push(`weights.${k}: must be a number 0–1, got ${JSON.stringify(v)}`);
        }
      }
      const sum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) > 0.02) {
        errors.push(`weights: must sum to 1.0 ±0.02, got ${sum.toFixed(4)}`);
      }
    }
  }

  // sectorFocusAreas (optional): object with non-empty string values
  if ("sectorFocusAreas" in cfg && cfg.sectorFocusAreas !== undefined) {
    if (typeof cfg.sectorFocusAreas !== "object" || Array.isArray(cfg.sectorFocusAreas)) {
      errors.push("sectorFocusAreas: must be an object");
    } else {
      for (const [k, v] of Object.entries(cfg.sectorFocusAreas)) {
        if (typeof v !== "string" || v.length < 1) {
          errors.push(`sectorFocusAreas.${k}: must be a non-empty string`);
        }
      }
    }
  }

  // rejectedTickers (optional): array of { symbol, reason }
  if ("rejectedTickers" in cfg && cfg.rejectedTickers !== undefined) {
    const validReasons = ["crypto_pattern", "non_us_format", "common_word_blocklist", "too_long", "invalid_chars"];
    if (!Array.isArray(cfg.rejectedTickers)) {
      errors.push("rejectedTickers: must be an array");
    } else {
      for (let i = 0; i < cfg.rejectedTickers.length; i++) {
        const r = cfg.rejectedTickers[i];
        if (!r || typeof r !== "object") {
          errors.push(`rejectedTickers[${i}]: must be an object`);
        } else {
          if (typeof r.symbol !== "string") errors.push(`rejectedTickers[${i}].symbol: must be a string`);
          if (!validReasons.includes(r.reason)) {
            errors.push(`rejectedTickers[${i}].reason: must be one of ${validReasons.join(", ")}, got ${JSON.stringify(r.reason)}`);
          }
        }
      }
    }
  }

  // weightsNormalized (optional): boolean
  if ("weightsNormalized" in cfg && cfg.weightsNormalized !== undefined) {
    if (typeof cfg.weightsNormalized !== "boolean") {
      errors.push("weightsNormalized: must be a boolean");
    }
  }

  // createdAt / updatedAt: ISO 8601
  if (!ISO8601_RE.test(cfg.createdAt)) {
    errors.push(`createdAt: must be an ISO 8601 timestamp, got ${JSON.stringify(cfg.createdAt)}`);
  }
  if (!ISO8601_RE.test(cfg.updatedAt)) {
    errors.push(`updatedAt: must be an ISO 8601 timestamp, got ${JSON.stringify(cfg.updatedAt)}`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateConfig };
