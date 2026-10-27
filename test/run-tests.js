"use strict";
/**
 * run-tests.js — zero-dependency test runner for intent-to-config.js
 *
 * Usage: node test/run-tests.js
 *
 * For each *.txt in test/fixtures/inputs/, finds the matching *.expected.json,
 * calls parseIntent(), and deep-checks only the keys present in expected
 * (partial match). Extra keys in actual output do not cause failures.
 *
 * Keys beginning with "_" in expected files are treated as documentation
 * comments and are never checked against actual output.
 *
 * For every result with ok:true (and no needsTickers flag), the produced
 * MonitoringConfig is also validated against the JSON Schema via validate-config.js.
 *
 * Exit code: 0 if all pass, 1 if any fail.
 */

const fs   = require("fs");
const path = require("path");
const { parseIntent }    = require("../src/intent-to-config");
const { validateConfig } = require("../src/validate-config");

const INPUTS_DIR   = path.join(__dirname, "fixtures/inputs");
const EXPECTED_DIR = path.join(__dirname, "fixtures/expected");

// ---------------------------------------------------------------------------
// Deep partial-match: every non-"_" key in `expected` must match in `actual`.
// Extra keys in `actual` are ignored.
// Returns an array of failure descriptions (empty = pass).
// ---------------------------------------------------------------------------
function partialMatch(expected, actual, path) {
  const failures = [];
  path = path || "root";

  if (expected === null || typeof expected !== "object") {
    if (!deepEqual(expected, actual)) {
      failures.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return failures;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`${path}: expected array, got ${typeof actual}`);
      return failures;
    }
    if (expected.length !== actual.length) {
      failures.push(`${path}: expected array length ${expected.length}, got ${actual.length} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      return failures;
    }
    for (let i = 0; i < expected.length; i++) {
      failures.push(...partialMatch(expected[i], actual[i], `${path}[${i}]`));
    }
    return failures;
  }

  if (typeof actual !== "object" || actual === null) {
    failures.push(`${path}: expected object, got ${JSON.stringify(actual)}`);
    return failures;
  }

  for (const key of Object.keys(expected)) {
    // Keys beginning with "_" are documentation annotations — skip them.
    if (key.startsWith("_")) continue;

    if (!(key in actual)) {
      failures.push(`${path}.${key}: missing in actual output`);
    } else {
      failures.push(...partialMatch(expected[key], actual[key], `${path}.${key}`));
    }
  }
  return failures;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

// ---------------------------------------------------------------------------
// Run all fixture tests
// ---------------------------------------------------------------------------
const inputFiles = fs.readdirSync(INPUTS_DIR)
  .filter(f => f.endsWith(".txt"))
  .sort();

let passed = 0;
let failed = 0;
const failures = [];

for (const inputFile of inputFiles) {
  const name = inputFile.replace(/\.txt$/, "");
  const expectedFile = path.join(EXPECTED_DIR, `${name}.expected.json`);

  if (!fs.existsSync(expectedFile)) {
    console.log(`  SKIP  ${name} — no expected file`);
    continue;
  }

  const userText = fs.readFileSync(path.join(INPUTS_DIR, inputFile), "utf8").trim();
  const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8"));

  let actual;
  try {
    actual = parseIntent(userText, { now: new Date("2026-10-23T12:00:00Z") });
  } catch (err) {
    console.log(`  FAIL  ${name} — threw: ${err.message}`);
    failed++;
    failures.push({ name, issues: [`threw: ${err.message}`] });
    continue;
  }

  const issues = partialMatch(expected, actual, "");

  // Schema validation: every ok:true, non-needsTickers result must produce a
  // schema-valid MonitoringConfig. This catches structural regressions early.
  if (actual.ok === true && !actual.needsTickers && actual.config) {
    const { valid, errors } = validateConfig(actual.config);
    if (!valid) {
      issues.push(...errors.map(e => `[schema] ${e}`));
    }
  }

  if (issues.length === 0) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    issues.forEach(i => console.log(`        ${i}`));
    failed++;
    failures.push({ name, issues });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
