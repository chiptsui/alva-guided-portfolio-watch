"use strict";
/**
 * check-placeholders.js
 *
 * Pre-deployment check: scans filled-in template files for unresolved [GPW-*]
 * markers. Exit 0 if all clear; exit 1 if any unresolved markers are found.
 *
 * This script must be run against the FILLED copy of each template before
 * publishing to Alva — not against the stub templates themselves.
 *
 * Usage:
 *   node src/check-placeholders.js path/to/filled-script.js path/to/playbook.html
 */

const fs   = require("fs");
const path = require("path");

const PLACEHOLDER_RE = /\[GPW-[A-Z0-9_-]+\]/g;

/**
 * Returns a deduplicated array of unresolved [GPW-*] markers found in `content`.
 * @param {string} content
 * @returns {string[]}
 */
function checkPlaceholders(content) {
  const matches = content.match(PLACEHOLDER_RE);
  if (!matches) return [];
  return [...new Set(matches)];
}

if (require.main === module) {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.error("Usage: node src/check-placeholders.js <filled-file> [file2 ...]");
    console.error("");
    console.error("Run against FILLED templates (not stubs). Exits 1 if any");
    console.error("[GPW-*] markers remain unresolved.");
    process.exit(1);
  }

  let anyFailed = false;

  for (const f of files) {
    const abs = path.resolve(f);
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (e) {
      console.error(`  ERROR  ${f}: ${e.message}`);
      anyFailed = true;
      continue;
    }

    const found = checkPlaceholders(content);
    if (found.length > 0) {
      console.error(`  FAIL   ${f}`);
      for (const m of found) console.error(`           unresolved: ${m}`);
      anyFailed = true;
    } else {
      console.log(`  OK     ${f}`);
    }
  }

  if (anyFailed) {
    console.error("\nReplace all [GPW-*] markers before deploying.");
  }
  process.exit(anyFailed ? 1 : 0);
}

module.exports = { checkPlaceholders };
