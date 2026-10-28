"use strict";
/**
 * decision-support.test.js
 *
 * Regression tests for the "Guidance without Prescription" product-safety contract.
 *
 * Covers:
 *   1. Shared boundary instruction present in all three guidance modes.
 *   2. Mode-specific guidance text preserved (regression).
 *   3. Guidance-mode inference regression (G-1 through G-4 from SKILL_CONTRACT.md).
 *   4. MonitoringConfig schema validation for all three modes.
 *   5. Alert template structural check — no prescriptive section labels.
 *   6. preferencesNote static template contains no unintended prescriptive phrases.
 *
 * IMPORTANT LIMITATION: These tests verify that the shared boundary instruction is
 * present in the prompt sent to the LLM and that static template sections contain no
 * prescriptive labels. They do NOT guarantee that LLM output will be free of
 * prescriptive language. Prompt instructions reduce the probability of prescriptive
 * output; they are not a hard enforcement layer.
 *
 * No cloud writes. No automation triggers. No production state touched.
 *
 * Usage: node test/decision-support.test.js
 * Exit code: 0 = all pass, 1 = any fail.
 */

const fs   = require("fs");
const path = require("path");
const { buildPreferencesNote, inferGuidanceMode, parseIntent } = require("../src/intent-to-config");
const { validateConfig } = require("../src/validate-config");

// ---------------------------------------------------------------------------
// Minimal test harness (matches style of existing suites)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    console.log("  PASS  " + name);
    passed++;
  } else {
    console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : ""));
    failed++;
    failures.push({ name, detail });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build a minimal MonitoringConfig for a given guidanceMode.
function makeCfg(guidanceMode) {
  return {
    tickers: ["NVDA", "AAPL"],
    holdings: { NVDA: "watchlist", AAPL: "watchlist" },
    horizon: "long-term",
    guidanceMode,
    weights: undefined,
    sectorFocusAreas: {},
  };
}

const GUIDED_NOTE   = buildPreferencesNote(makeCfg("guided"));
const NEUTRAL_NOTE  = buildPreferencesNote(makeCfg("neutral"));
const STANDARD_NOTE = buildPreferencesNote(makeCfg("standard"));

// ---------------------------------------------------------------------------
// Part 1: Shared boundary instruction present in all three guidance modes
// ---------------------------------------------------------------------------

console.log("\n── Part 1: Shared boundary instruction in all modes ───────────────────────");

assert(
  "guided: contains 'do not recommend'",
  GUIDED_NOTE.includes("do not recommend")
);
assert(
  "neutral: contains 'do not recommend'",
  NEUTRAL_NOTE.includes("do not recommend")
);
assert(
  "standard: contains 'do not recommend'",
  STANDARD_NOTE.includes("do not recommend")
);

assert(
  "guided: contains 'retains full responsibility'",
  GUIDED_NOTE.includes("retains full responsibility")
);
assert(
  "neutral: contains 'retains full responsibility'",
  NEUTRAL_NOTE.includes("retains full responsibility")
);
assert(
  "standard: contains 'retains full responsibility'",
  STANDARD_NOTE.includes("retains full responsibility")
);

assert(
  "guided: contains 'known uncertainties'",
  GUIDED_NOTE.includes("known uncertainties")
);
assert(
  "neutral: contains 'known uncertainties'",
  NEUTRAL_NOTE.includes("known uncertainties")
);
assert(
  "standard: contains 'known uncertainties'",
  STANDARD_NOTE.includes("known uncertainties")
);

// ---------------------------------------------------------------------------
// Part 2: Mode-specific guidance text preserved (regression)
// ---------------------------------------------------------------------------

console.log("\n── Part 2: Mode-specific guidance text preserved ──────────────────────────");

assert(
  "guided: contains jargon-free instruction",
  GUIDED_NOTE.includes("jargon-free English")
);
assert(
  "standard: contains financial literacy instruction",
  STANDARD_NOTE.includes("intermediate financial literacy")
);
assert(
  "neutral: contains accessible language instruction",
  NEUTRAL_NOTE.includes("clear, accessible language")
);

// Boundary note must be present alongside (not replace) mode-specific text.
assert(
  "guided: both mode text AND boundary present",
  GUIDED_NOTE.includes("jargon-free English") && GUIDED_NOTE.includes("do not recommend")
);
assert(
  "standard: both mode text AND boundary present",
  STANDARD_NOTE.includes("intermediate financial literacy") && STANDARD_NOTE.includes("do not recommend")
);

// Alert policy retained in all modes
assert(
  "guided: alert policy present",
  GUIDED_NOTE.includes("Alert policy:")
);
assert(
  "standard: alert policy present",
  STANDARD_NOTE.includes("Alert policy:")
);
assert(
  "neutral: alert policy present",
  NEUTRAL_NOTE.includes("Alert policy:")
);

// ---------------------------------------------------------------------------
// Part 3: Guidance-mode inference regression (G-1 through G-4)
// ---------------------------------------------------------------------------

console.log("\n── Part 3: Guidance-mode inference regression ──────────────────────────────");

assert(
  "G-1: explicit beginner → guided",
  inferGuidanceMode("I'm new to investing and just bought some Apple and Microsoft stock.") === "guided"
);
assert(
  "G-2: tickers only → neutral",
  inferGuidanceMode("Set up monitoring for NVDA and AMD.") === "neutral"
);
assert(
  "G-3: financial jargon (FCF) → standard",
  inferGuidanceMode("Monitor my NVDA and AMD positions. What's the FCF outlook?") === "standard"
);
assert(
  "G-4: wants plain-English explanation → guided",
  inferGuidanceMode("I want to understand when something big happens. Explain it to me.") === "guided"
);

// ---------------------------------------------------------------------------
// Part 4: MonitoringConfig schema validation across all three modes
// ---------------------------------------------------------------------------

console.log("\n── Part 4: MonitoringConfig schema validation ──────────────────────────────");

const GUIDED_PARSE   = parseIntent("Monitor NVDA. Explain everything in plain English — I'm new to investing.");
const NEUTRAL_PARSE  = parseIntent("Monitor NVDA.");
const STANDARD_PARSE = parseIntent("Monitor NVDA. I track FCF trends and operating leverage.");

assert("guided parseIntent ok",   GUIDED_PARSE.ok,   GUIDED_PARSE.error);
assert("neutral parseIntent ok",  NEUTRAL_PARSE.ok,  NEUTRAL_PARSE.error);
assert("standard parseIntent ok", STANDARD_PARSE.ok, STANDARD_PARSE.error);

if (GUIDED_PARSE.ok) {
  const v = validateConfig(GUIDED_PARSE.config);
  assert("guided MonitoringConfig valid",   v.valid, v.errors && v.errors[0]);
}
if (NEUTRAL_PARSE.ok) {
  const v = validateConfig(NEUTRAL_PARSE.config);
  assert("neutral MonitoringConfig valid",  v.valid, v.errors && v.errors[0]);
}
if (STANDARD_PARSE.ok) {
  const v = validateConfig(STANDARD_PARSE.config);
  assert("standard MonitoringConfig valid", v.valid, v.errors && v.errors[0]);
}

// Boundary note appears in all three generated configs
if (GUIDED_PARSE.ok) {
  assert(
    "guided config.preferencesNote contains boundary",
    GUIDED_PARSE.config.preferencesNote.includes("do not recommend")
  );
}
if (NEUTRAL_PARSE.ok) {
  assert(
    "neutral config.preferencesNote contains boundary",
    NEUTRAL_PARSE.config.preferencesNote.includes("do not recommend")
  );
}
if (STANDARD_PARSE.ok) {
  assert(
    "standard config.preferencesNote contains boundary",
    STANDARD_PARSE.config.preferencesNote.includes("do not recommend")
  );
}

// ---------------------------------------------------------------------------
// Part 5: Alert template structural safety
// ---------------------------------------------------------------------------
// Reads the deployed monitor stub and checks that alert body section labels
// do not include prescriptive headings. This is a static text check.
// It does not assess the content produced by @alva/portfolio-watch at runtime.
// ---------------------------------------------------------------------------

console.log("\n── Part 5: Alert template structural safety ────────────────────────────────");

const STUB_PATH = path.join(__dirname, "../templates/gpw-monitor.stub.js");
const stubSrc = fs.readFileSync(STUB_PATH, "utf8");

assert(
  "stub: no 'What you should do' section label",
  !/\*\*What you should do\*\*/i.test(stubSrc)
);
assert(
  "stub: no 'Action to take' section label",
  !/\*\*Action(s)? to take\*\*/i.test(stubSrc)
);
assert(
  "stub: no 'My recommendation' section label",
  !/\*\*My recommendation\*\*/i.test(stubSrc)
);
assert(
  "stub: contains 'What happened' section label (expected structure present)",
  /\*\*What happened\*\*/.test(stubSrc)
);
assert(
  "stub: contains 'What to watch next' section label (non-prescriptive)",
  /\*\*What to watch next\*\*/.test(stubSrc)
);

// ---------------------------------------------------------------------------
// Part 6: No unintended prescriptive phrases in preferencesNote static text
// ---------------------------------------------------------------------------
// Checks that the static template sections do not accidentally include
// phrases that would themselves instruct the user to buy, sell, or hold.
// The boundary instruction intentionally uses words like "buying"/"selling"
// in the "do not recommend" context; we check for specifically prescriptive
// phrase patterns, not bare words.
// ---------------------------------------------------------------------------

console.log("\n── Part 6: No prescriptive phrases in static preferencesNote ───────────────");

const PRESCRIPTIVE = [
  /you should (buy|sell|hold|add to|reduce|exit)/i,
  /(?<!not )recommend (buying|selling|holding)/i,
  /consider (buying|selling|exiting)/i,
  /take profit/i,
  /cut your loss/i,
  /add to your position/i,
  /reduce your position/i,
];

for (const mode of ["guided", "neutral", "standard"]) {
  const note = { guided: GUIDED_NOTE, neutral: NEUTRAL_NOTE, standard: STANDARD_NOTE }[mode];
  for (const pattern of PRESCRIPTIVE) {
    assert(
      `${mode}: no '${pattern.source}' in preferencesNote`,
      !pattern.test(note)
    );
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n───────────────────────────────────────────────────────────────────────────");
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log("───────────────────────────────────────────────────────────────────────────");

if (failures.length > 0) {
  console.log("\nFailed tests:");
  failures.forEach(f => console.log("  " + f.name + (f.detail ? " — " + f.detail : "")));
}

process.exit(failed > 0 ? 1 : 0);
