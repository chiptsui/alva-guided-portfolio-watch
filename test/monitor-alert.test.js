"use strict";
/**
 * monitor-alert.test.js
 *
 * Offline regression tests for the alert transformation logic in gpw-monitor.stub.js.
 *
 * Tests the three components and their provenance policy:
 *   1. eligible() — structural/semantic gate (type, ticker, content, suppression)
 *   2. sourceVerified filter — evidence gate (at least one https:// in supportingEvents)
 *   3. buildAlert() — push gate, body construction, alertOutput schema
 *
 * Provenance policy: external delivery requires at least one verifiable HTTPS source
 * per eligible finding. d.notificationMessage is NOT treated as a source citation —
 * it is LLM-generated narrative. Internal eventRefs are not external source URLs.
 *
 * ALL TEST DATA IS SYNTHETIC OR SANITIZED FROM PRODUCTION.
 * No Cloud writes. No production notifications. No automation triggers.
 *
 * Usage: node test/monitor-alert.test.js
 * Exit code: 0 = all pass, 1 = any fail.
 */

const fs   = require("fs");
const path = require("path");

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
    console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : ""));
    failed++;
    failures.push({ name, detail });
  }
}

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, "fixtures/inputs/monitor-decision.json");
const FIXTURES = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

// ---------------------------------------------------------------------------
// Inline exact copies of the corrected production functions from gpw-monitor.stub.js.
// ---------------------------------------------------------------------------

const TEST_CFG = {
  tickers: ["NVDA", "TSLA", "AAPL"],
  guidanceMode: "guided",
  horizon: "long-term",
};

const PLAYBOOK_URL = "https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch";

// stableEventId — prefers upstream findingId; falls back to djb2 hash.
function stableEventId(finding) {
  if (finding.findingId) return finding.findingId;
  const key = [
    (finding.primaryAsset || "").toUpperCase(),
    String(finding.date || "").slice(0, 10),
    (finding.summary || "").slice(0, 40).replace(/\s+/g, " ").toLowerCase(),
  ].join("|");
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

// eligible — structural/semantic gate on a selectedEventsJson finding.
function eligible(cfg, f) {
  if (f.suppressionReason) return false;
  if (f.selected !== true) return false;
  if (f.findingType !== "event_impact") return false;
  if (!cfg.tickers.includes(f.primaryAsset)) return false;
  const pl = (f.payload !== null && typeof f.payload === "object") ? f.payload : {};
  const text = [
    f.summary || "",
    JSON.stringify(pl.affected_buckets || []),
    (pl.decision_lens && pl.decision_lens.thesis_impact && pl.decision_lens.thesis_impact.rationale) || "",
  ].join(" ").toLowerCase();
  if (!/earnings|revenue|profit|cash.flow|guidance|regulat|legal|lawsuit|court|antitrust|export|acquisition|merger|strategic|supply|product|demand|business|debt/.test(text)) return false;
  if (/rumor.only|unsubstantiated/.test(text)) return false;
  return true;
}

// hasVerifiableSource — evidence gate: at least one parseable HTTPS URL with a valid hostname.
// Requires a non-null entry with a string url field that parses to protocol=https: and
// a non-empty hostname. Malformed URLs, HTTP, empty strings, non-strings, null entries,
// and missing url fields are all rejected. Source links indicate associated external
// reporting; they are not independent factual verification of financial outcomes.
function hasVerifiableSource(f) {
  return (f.supportingEvents || []).some(function(s) {
    if (s == null || typeof s.url !== "string") return false;
    try { var p = new URL(s.url); return p.protocol === "https:" && p.hostname.length > 0; } catch (_) { return false; }
  });
}

// buildAlert — simulates the full alert construction logic from steps 4-6 in the stub.
// Returns the alert record when all gates pass; returns null for any suppressed run.
function buildAlert(cfg, d, playbookUrl) {
  var rawFindings = (function() {
    try { return JSON.parse(d.selectedEventsJson || "[]"); } catch (_) { return []; }
  })();
  var accepted = rawFindings.filter(function(f) { return eligible(cfg, f); });

  // Evidence gate: findings without a verifiable HTTPS source are excluded from delivery
  var sourceVerified = accepted.filter(hasVerifiableSource);

  var push = sourceVerified.length > 0
    && d.alertDecision  === "push"
    && d.analysisStatus === "valid"
    && d.healthStatus   === "valid";

  if (!push) return null;

  var eventIds = sourceVerified.map(stableEventId);
  var alertUrl = playbookUrl + "?event=" + eventIds[0];
  var tickersAffected = [];
  sourceVerified.forEach(function(f) {
    if (tickersAffected.indexOf(f.primaryAsset) === -1) tickersAffected.push(f.primaryAsset);
  });

  var body = sourceVerified.map(function(f) {
    var pl = (f.payload !== null && typeof f.payload === "object") ? f.payload : {};
    var sources = (f.supportingEvents || [])
      .filter(function(s) {
        if (s == null || typeof s.url !== "string") return false;
        try { var p = new URL(s.url); return p.protocol === "https:" && p.hostname.length > 0; } catch (_) { return false; }
      })
      .map(function(s) { return "[" + (s.title || s.url) + "](" + s.url + ")"; });

    var freshness = f.date
      ? "*Data as of " + new Date(f.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + "*"
      : null;

    var dataQualityNote = Array.isArray(pl.data_quality_notes)
      ? pl.data_quality_notes[0]
      : (pl.data_quality_notes || "Unknown.");

    return [
      "## " + f.primaryAsset,
      "**What happened** " + (f.summary || ""),
      "**Why it matters** " + ((pl.decision_lens && pl.decision_lens.thesis_impact && pl.decision_lens.thesis_impact.rationale) || "See source."),
      "**What remains uncertain** " + dataQualityNote,
      "**What to watch next**\n" + ((pl.decision_lens && pl.decision_lens.watch_next) || []).map(function(w) { return "- " + w; }).join("\n"),
      "**Sources** " + sources.join(" · "),
      freshness,
    ].filter(Boolean).join("\n\n");
  }).join("\n\n---\n\n");

  return {
    date:            d.runAtMs,
    title:           "Portfolio Watch \u2014 " + tickersAffected.join(", ") + " " + (tickersAffected.length > 1 ? "need" : "needs") + " attention",
    body:            body,
    eventIds:        eventIds.join(","),
    alertUrl:        alertUrl,
    tickersAffected: tickersAffected,
    accepted:        accepted,        // exposed for test assertions only
    sourceVerified:  sourceVerified,  // exposed for test assertions only
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides) {
  var base = {
    findingId: "event-impact-test",
    findingType: "event_impact",
    primaryAsset: "NVDA",
    selected: true,
    suppressionReason: "",
    summary: "NVDA revenue guidance raised significantly.",
    supportingEvents: [{ url: "https://example.com/nvda-news", title: "NVDA Guidance" }],
    eventRefs: [],
    payload: {
      affected_buckets: ["revenue", "earnings"],
      decision_lens: {
        thesis_impact: { direction: "positive", rationale: "Revenue guidance supports demand thesis." },
        watch_next: ["Monitor next earnings call"],
      },
      data_quality_notes: ["Guidance only, actual results not yet filed."],
    },
  };
  return Object.assign({}, base, overrides);
}

function makeDecision(overrides) {
  var base = {
    analysisStatus: "valid",
    healthStatus: "valid",
    alertDecision: "push",
    urgency: "medium",
    reason: "Material event detected.",
    skipReason: "",
    notificationMessage: "Something happened.",
    runAtMs: 1793000000000,
    selectedEventsJson: JSON.stringify([makeFinding({})]),
    selectedFindingIdsJson: '["event-impact-test"]',
  };
  return Object.assign({}, base, overrides);
}

// ---------------------------------------------------------------------------
// TEST SUITE
// ---------------------------------------------------------------------------

console.log("\n=== SUITE: stableEventId ===");

(function() {
  var f1 = { findingId: "event-impact-spacex-gpu-financing-nvda", primaryAsset: "NVDA" };
  assert("uses findingId when present", stableEventId(f1) === "event-impact-spacex-gpu-financing-nvda");

  var f2 = { primaryAsset: "NVDA", date: "2026-10-26", summary: "SpaceX raised $40B for GPUs" };
  var id = stableEventId(f2);
  assert("fallback is a non-empty string", typeof id === "string" && id.length > 0);
  assert("fallback is deterministic", stableEventId(f2) === id);

  assert("handles empty finding", typeof stableEventId({}) === "string");
})();

console.log("\n=== SUITE: eligible() ===");

(function() {
  // Boolean selected=true is required
  assert("selected=true (boolean) passes", eligible(TEST_CFG, makeFinding({ selected: true })));
  assert("selected='true' (string, old schema) rejected", !eligible(TEST_CFG, makeFinding({ selected: "true" })));
  assert("selected=false rejected", !eligible(TEST_CFG, makeFinding({ selected: false })));

  // Suppression
  assert("non-empty suppressionReason rejected", !eligible(TEST_CFG, makeFinding({ suppressionReason: "duplicate_of_prior_run" })));
  assert("empty suppressionReason passes", eligible(TEST_CFG, makeFinding({ suppressionReason: "" })));

  // findingType
  assert("event_impact passes", eligible(TEST_CFG, makeFinding({ findingType: "event_impact" })));
  assert("anomaly_attribution rejected", !eligible(TEST_CFG, makeFinding({ findingType: "anomaly_attribution" })));

  // Ticker
  assert("NVDA passes", eligible(TEST_CFG, makeFinding({ primaryAsset: "NVDA" })));
  assert("TSLA passes", eligible(TEST_CFG, makeFinding({ primaryAsset: "TSLA" })));
  assert("MSFT rejected", !eligible(TEST_CFG, makeFinding({ primaryAsset: "MSFT" })));

  // Content keyword
  assert("debt keyword passes", eligible(TEST_CFG, makeFinding({ summary: "SpaceX raised $40B in debt for GPUs." })));
  assert("irrelevant content rejected",
    !eligible(TEST_CFG, makeFinding({ summary: "NVDA changed website color.", payload: { affected_buckets: [], decision_lens: { thesis_impact: { rationale: "Design only." }, watch_next: [] }, data_quality_notes: [] } })));
  assert("rumor.only rejected",
    !eligible(TEST_CFG, makeFinding({ summary: "rumor.only: NVDA acquisition unsubstantiated.", payload: { affected_buckets: ["acquisition"], decision_lens: { thesis_impact: { rationale: "Acquisition rumor, unsubstantiated." }, watch_next: [] }, data_quality_notes: [] } })));

  // payload as direct object (not JSON string)
  assert("null payload with keyword in summary passes",
    eligible(TEST_CFG, makeFinding({ summary: "NVDA antitrust lawsuit filed.", payload: null })));
})();

console.log("\n=== SUITE: Evidence gate (sourceVerified) ===");

(function() {
  var withSources = makeFinding({ supportingEvents: [{ url: "https://reuters.com/nvda-story", title: "Reuters" }] });
  assert("finding with https:// URL passes evidence gate", hasVerifiableSource(withSources));

  var noSources = makeFinding({ supportingEvents: [] });
  assert("finding with empty supportingEvents fails evidence gate", !hasVerifiableSource(noSources));

  var internalRef = makeFinding({ supportingEvents: [{ url: "", title: "Internal reference" }] });
  assert("finding with empty URL fails evidence gate", !hasVerifiableSource(internalRef));

  var httpOnly = makeFinding({ supportingEvents: [{ url: "http://example.com/story", title: "HTTP" }] });
  assert("http:// URL rejected (HTTPS required)", !hasVerifiableSource(httpOnly));

  var noField = makeFinding({ supportingEvents: [{ title: "No URL field" }] });
  assert("supportingEvent without url field fails evidence gate", !hasVerifiableSource(noField));

  var numericUrl = makeFinding({ supportingEvents: [{ url: 12345, title: "numeric" }] });
  assert("non-string url rejected", !hasVerifiableSource(numericUrl));

  var nullEntry = makeFinding({ supportingEvents: [null, { url: "https://reuters.com/valid", title: "Reuters" }] });
  assert("null entry in supportingEvents skipped; valid entry still found",
    (function() {
      try { return hasVerifiableSource(nullEntry); }
      catch(e) { return false; }
    })());

  var mixedUrls = makeFinding({ supportingEvents: [
    { url: "http://insecure.example.com/", title: "HTTP" },
    { url: "", title: "Empty" },
    { url: "https://valid.example.com/story", title: "HTTPS" },
  ]});
  assert("mixed URLs: https:// entry passes, http+empty rejected", hasVerifiableSource(mixedUrls));

  var malformedUrl = makeFinding({ supportingEvents: [{ url: "not-a-url", title: "Malformed" }] });
  assert("malformed URL (no protocol) rejected", !hasVerifiableSource(malformedUrl));

  var noHostname = makeFinding({ supportingEvents: [{ url: "https://", title: "No hostname" }] });
  assert("malformed URL (https:// with no hostname) rejected", !hasVerifiableSource(noHostname));

  var jsUrl = makeFinding({ supportingEvents: [{ url: "javascript:alert(1)", title: "XSS attempt" }] });
  assert("non-HTTPS protocol (javascript:) rejected", !hasVerifiableSource(jsUrl));
})();

console.log("\n=== SUITE: notificationMessage bypass — provenance policy ===");

(function() {
  // Core policy: notificationMessage is NOT a substitute for verifiable source URLs.
  // A push decision with notificationMessage but no supportingEvents must be suppressed.
  var d = FIXTURES.real_push_decision;
  var findings = JSON.parse(d.selectedEventsJson);
  assert("real SpaceX fixture: notificationMessage is non-empty", d.notificationMessage.length > 0);
  assert("real SpaceX fixture: supportingEvents is empty", findings[0].supportingEvents.length === 0);

  var alert = buildAlert(TEST_CFG, d, PLAYBOOK_URL);
  assert("real SpaceX fixture: returns null — notificationMessage does NOT bypass evidence gate",
    alert === null,
    "alertDecision=push + notificationMessage must not produce delivery when supportingEvents is empty");

  // Explicitly confirm the notificationMessage is not in the null result
  assert("real SpaceX fixture: no LLM narrative fabricated as alert body", alert === null);

  // A generic decision with notificationMessage but no sources must also be suppressed
  var noSourceDecision = makeDecision({
    notificationMessage: "NVDA had a material event this week.",
    selectedEventsJson: JSON.stringify([makeFinding({ supportingEvents: [] })]),
  });
  assert("nonempty notificationMessage with no sources returns null",
    buildAlert(TEST_CFG, noSourceDecision, PLAYBOOK_URL) === null);

  // Confirm the eligible finding IS accepted (structural gate passes) — only evidence gate blocks
  var rawFindings = JSON.parse(noSourceDecision.selectedEventsJson);
  var acceptedCount = rawFindings.filter(function(f) { return eligible(TEST_CFG, f); }).length;
  assert("finding is structurally eligible — evidence gate is the blocker, not eligible()",
    acceptedCount === 1);
})();

console.log("\n=== SUITE: buildAlert() — valid push with verified sources ===");

(function() {
  var d = FIXTURES.push_with_sources;
  var alert = buildAlert(TEST_CFG, d, PLAYBOOK_URL);

  assert("push_with_sources produces alert", alert !== null);
  if (!alert) return;

  assert("title references AAPL", alert.title.indexOf("AAPL") !== -1);
  assert("title ends with 'needs attention'", /needs attention$/.test(alert.title));
  assert("body is non-empty", alert.body.trim().length > 0);
  assert("body contains ## AAPL heading", alert.body.indexOf("## AAPL") !== -1);
  assert("body contains real Reuters URL", alert.body.indexOf("https://www.reuters.com") !== -1);
  assert("body contains real FT URL", alert.body.indexOf("https://www.ft.com") !== -1);
  assert("body contains What happened section", alert.body.indexOf("**What happened**") !== -1);
  assert("body contains Why it matters section", alert.body.indexOf("**Why it matters**") !== -1);
  assert("body contains What to watch next section", alert.body.indexOf("**What to watch next**") !== -1);
  assert("body contains Sources section", alert.body.indexOf("**Sources**") !== -1);
  assert("body does NOT contain notificationMessage (empty string bypass avoided)",
    alert.body !== d.notificationMessage || d.notificationMessage === "");
  assert("eventIds is 'event-impact-aapl-regulatory-fine'",
    alert.eventIds === "event-impact-aapl-regulatory-fine");
  assert("alertUrl starts with PLAYBOOK_URL", alert.alertUrl.indexOf(PLAYBOOK_URL) === 0);
  assert("alertUrl contains ?event=", alert.alertUrl.indexOf("?event=") !== -1);
})();

console.log("\n=== SUITE: buildAlert() — mixed eligible/ineligible findings ===");

(function() {
  // NVDA has a valid source; TSLA is eligible but has no source.
  // TSLA must not appear in the alert body or tickersAffected.
  var mixed = makeDecision({
    notificationMessage: "NVDA and TSLA both have material events.",
    selectedEventsJson: JSON.stringify([
      makeFinding({
        findingId: "event-impact-nvda-with-source",
        primaryAsset: "NVDA",
        summary: "NVDA revenue guidance raised significantly.",
        supportingEvents: [{ url: "https://reuters.com/nvda", title: "Reuters NVDA" }],
      }),
      makeFinding({
        findingId: "event-impact-tsla-no-source",
        primaryAsset: "TSLA",
        summary: "Tesla demand guidance raised significantly.",
        supportingEvents: [],  // no source — must be excluded from delivery
      }),
    ]),
  });

  var alert = buildAlert(TEST_CFG, mixed, PLAYBOOK_URL);
  assert("mixed findings: alert is produced (NVDA has source)", alert !== null);
  if (!alert) return;

  assert("mixed findings: accepted set contains both (2 eligible)", alert.accepted.length === 2);
  assert("mixed findings: sourceVerified contains only NVDA (1)", alert.sourceVerified.length === 1);
  assert("mixed findings: title mentions only NVDA", alert.title.indexOf("NVDA") !== -1);
  assert("mixed findings: title does NOT mention TSLA", alert.title.indexOf("TSLA") === -1);
  assert("mixed findings: body mentions NVDA", alert.body.indexOf("NVDA") !== -1);
  assert("mixed findings: body does NOT contain TSLA details",
    alert.body.indexOf("TSLA") === -1,
    "excluded findings must not leak into alert body");
  assert("mixed findings: notificationMessage (covering TSLA) is NOT used as body",
    alert.body.indexOf("TSLA both have material events") === -1);
  assert("mixed findings: eventIds contains only NVDA finding ID",
    alert.eventIds === "event-impact-nvda-with-source");
})();

console.log("\n=== SUITE: buildAlert() — quiet and invalid scenarios ===");

(function() {
  assert("alertDecision=no_push returns null",
    buildAlert(TEST_CFG, FIXTURES.quiet_decision, PLAYBOOK_URL) === null);

  assert("analysisStatus=error returns null",
    buildAlert(TEST_CFG, FIXTURES.invalid_analysis, PLAYBOOK_URL) === null);

  assert("healthStatus=error returns null",
    buildAlert(TEST_CFG, FIXTURES.invalid_health, PLAYBOOK_URL) === null);

  assert("empty selectedEventsJson returns null",
    buildAlert(TEST_CFG, FIXTURES.empty_selected_events, PLAYBOOK_URL) === null);
})();

console.log("\n=== SUITE: buildAlert() — eligibility filter gates ===");

(function() {
  assert("suppressed event returns null",
    buildAlert(TEST_CFG, FIXTURES.suppressed_event, PLAYBOOK_URL) === null);

  assert("unrelated ticker (MSFT) returns null",
    buildAlert(TEST_CFG, FIXTURES.unrelated_ticker, PLAYBOOK_URL) === null);

  assert("anomaly_attribution findingType returns null",
    buildAlert(TEST_CFG, FIXTURES.wrong_finding_type, PLAYBOOK_URL) === null);

  assert("string selected='true' (old schema) returns null",
    buildAlert(TEST_CFG, FIXTURES.string_selected_old_schema, PLAYBOOK_URL) === null);
})();

console.log("\n=== SUITE: alertOutput schema validation ===");

(function() {
  var d = FIXTURES.push_with_sources;
  var alert = buildAlert(TEST_CFG, d, PLAYBOOK_URL);
  if (!alert) {
    assert("alertOutput schema: push_with_sources produced an alert", false);
    return;
  }

  assert("schema: title is a non-empty string", typeof alert.title === "string" && alert.title.length > 0);
  assert("schema: title is ≤ 200 chars", alert.title.length <= 200);
  assert("schema: body is a non-empty string", typeof alert.body === "string" && alert.body.trim().length > 0);
  assert("schema: eventIds is a non-empty string", typeof alert.eventIds === "string" && alert.eventIds.length > 0);
  assert("schema: eventIds has no whitespace", !/\s/.test(alert.eventIds));
  assert("schema: alertUrl starts with https://", /^https:\/\//.test(alert.alertUrl));
  assert("schema: alertUrl contains ?event=", alert.alertUrl.indexOf("?event=") !== -1);
  assert("schema: tickersAffected is a non-empty array",
    Array.isArray(alert.tickersAffected) && alert.tickersAffected.length > 0);
  assert("schema: tickersAffected[0] is a valid ticker symbol",
    /^[A-Z]{1,5}$/.test(alert.tickersAffected[0]));

  // Multi-ticker schema
  var multiDecision = makeDecision({
    notificationMessage: "",
    selectedEventsJson: JSON.stringify([
      makeFinding({ findingId: "event-nvda-x", primaryAsset: "NVDA", supportingEvents: [{ url: "https://reuters.com/nvda", title: "Reuters" }] }),
      makeFinding({ findingId: "event-tsla-x", primaryAsset: "TSLA", summary: "Tesla demand guidance raised significantly.", supportingEvents: [{ url: "https://ft.com/tsla", title: "FT" }] }),
    ]),
  });
  var multiAlert = buildAlert(TEST_CFG, multiDecision, PLAYBOOK_URL);
  assert("schema: multi-ticker title uses 'need' (plural)", multiAlert && /need attention$/.test(multiAlert.title));
  assert("schema: multi-ticker eventIds is comma-separated",
    multiAlert && multiAlert.eventIds === "event-nvda-x,event-tsla-x");
  assert("schema: multi-ticker body has two ## sections",
    multiAlert && multiAlert.body.indexOf("## NVDA") !== -1 && multiAlert.body.indexOf("## TSLA") !== -1);
  assert("schema: multi-ticker body has --- separator",
    multiAlert && multiAlert.body.indexOf("---") !== -1);
})();

console.log("\n=== SUITE: HTTPS-only edge cases in buildAlert ===");

(function() {
  // HTTP-only source must be suppressed
  var httpDecision = makeDecision({
    notificationMessage: "NVDA event.",
    selectedEventsJson: JSON.stringify([makeFinding({
      supportingEvents: [{ url: "http://insecure.example.com/nvda", title: "HTTP only" }],
    })]),
  });
  assert("http:// only source suppresses delivery", buildAlert(TEST_CFG, httpDecision, PLAYBOOK_URL) === null);

  // HTTPS + HTTP mixed: HTTPS wins, alert produced
  var mixedDecision = makeDecision({
    notificationMessage: "",
    selectedEventsJson: JSON.stringify([makeFinding({
      supportingEvents: [
        { url: "http://insecure.example.com/", title: "HTTP" },
        { url: "https://reuters.com/nvda-valid", title: "Reuters" },
      ],
    })]),
  });
  var mixedAlert = buildAlert(TEST_CFG, mixedDecision, PLAYBOOK_URL);
  assert("https:// + http:// mixed: alert produced via https:// entry", mixedAlert !== null);
  if (mixedAlert) {
    assert("body contains https:// Reuters URL", mixedAlert.body.indexOf("https://reuters.com/nvda-valid") !== -1);
    assert("body does NOT contain http:// insecure URL", mixedAlert.body.indexOf("http://insecure.example.com/") === -1);
  }

  // null entry in supportingEvents does not crash; valid https:// still accepted
  var nullEntryDecision = makeDecision({
    notificationMessage: "",
    selectedEventsJson: JSON.stringify([makeFinding({
      supportingEvents: [null, { url: "https://ft.com/nvda-story", title: "FT" }],
    })]),
  });
  assert("null supportingEvents entry does not throw; https:// entry accepted",
    (function() { try { return buildAlert(TEST_CFG, nullEntryDecision, PLAYBOOK_URL) !== null; } catch(e) { return false; } })());
})();

console.log("\n=== SUITE: Script identity — structural pattern assertions on deployed stub ===");

(function() {
  // Structural assertions only: these grep the deployed stub source for expected patterns.
  // They catch common drift (wrong source field, removed safety checks, wrong URL validator)
  // but do NOT verify runtime behaviour. Full runtime integration requires a production trigger.
  var stubSrc = require("fs").readFileSync(
    require("path").join(__dirname, "../templates/gpw-monitor.stub.js"), "utf8"
  );

  // Source verification must use the URL constructor (not a plain regex prefix check)
  assert("stub uses URL constructor for source verification",
    /new URL\(s\.url\)/.test(stubSrc));
  assert("stub checks https: protocol via URL constructor",
    /p\.protocol\s*===\s*["']https:["']/.test(stubSrc));
  assert("stub checks non-empty hostname via URL constructor",
    /p\.hostname\.length/.test(stubSrc));

  // Confirm the stub reads selectedEventsJson (not eventCandidatesJson)
  assert("stub reads selectedEventsJson",
    stubSrc.indexOf("selectedEventsJson") !== -1);
  assert("stub does NOT read eventCandidatesJson for rawFindings",
    !(/rawFindings.*eventCandidatesJson/.test(stubSrc.replace(/\n/g, " "))));

  // Confirm eligible() checks boolean true (not string)
  assert("stub eligible() checks f.selected !== true",
    stubSrc.indexOf("f.selected !== true") !== -1);

  // Confirm sourceVerified is used for tickersAffected (not accepted)
  assert("stub derives tickersAffected from sourceVerified",
    /sourceVerified\.map.*primaryAsset/.test(stubSrc.replace(/\n/g, " ")));

  // Confirm notificationMessage is NOT used as the body expression (const body = d.notificationMessage ||)
  // Note: d.notificationMessage || "" is legitimately used in the mirrored decision record write.
  assert("stub does NOT use notificationMessage as body fallback",
    !/const\s+body\s*=\s*d\.notificationMessage/.test(stubSrc.replace(/\n/g, " ")));
})();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log("───────────────────────────────────────────────");
console.log("Total: " + (passed + failed) + "  Passed: " + passed + "  Failed: " + failed);
if (failures.length > 0) {
  console.log("\nFailed tests:");
  failures.forEach(function(f) {
    console.log("  - " + f.name + (f.detail ? " (" + f.detail + ")" : ""));
  });
}
console.log("───────────────────────────────────────────────");
process.exit(failed > 0 ? 1 : 0);
