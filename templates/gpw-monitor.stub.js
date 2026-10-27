"use strict";
/**
 * gpw-monitor.stub.js
 * Template for the gpw-monitor cloud feed script.
 *
 * CLOUD RESOURCE SAFETY: Do NOT reuse or overwrite cronjob IDs 40804 or 40805 —
 * those belong to the existing long-term-fundamentals and long-term-portfolio-watch
 * baselines. Obtain a new ID with:
 *   alva deploy create --name gpw-monitor
 * then publish with:
 *   alva automation publish --name gpw-monitor --version 1.0.0 --cronjob-id <NEW-ID> --push-notify --agent-type alpi
 *
 * NOTE: All await calls must be inside the async IIFE below.
 * The cloud runtime does not support top-level await.
 */

const {
  Feed, feedPath, makeDoc, str,
  alertOutput, messageActionsField, messagePresentationField,
  openUrlAction, sendPromptAction, cardPresentation,
} = require("@alva/feed");
const { runPortfolioWatch } = require("@alva/portfolio-watch");
const alfs = require("alfs");
const env  = require("env");

// [GPW-PLAYBOOK-URL] Replace with published Playbook URL after release.
const PLAYBOOK_URL = `https://alva.ai/u/${env.username}/playbooks/guided-portfolio-watch`;

// [GPW-EVENT-ID] Stable event identifier for deep linking.
// Deterministic: same finding always produces the same ID across runs.
// Prefers the upstream findingId from selectedEventsJson when present.
function stableEventId(finding) {
  if (finding.findingId) return finding.findingId;
  // Fallback: djb2 hash for findings without a findingId
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

const feed = new Feed({ path: feedPath("gpw-monitor") });

feed.def("analysis", {
  decision: makeDoc("Portfolio Decision", "Daily LLM analysis decision record", [
    str("analysisStatus"), str("healthStatus"), str("alertDecision"),
    str("reason"), str("skipReason"), str("notificationMessage"),
    str("runAtMs"), str("urgency"),
  ]),
});

feed.def("alerts", {
  // [GPW-ALERT-OUTPUT] V2 alertOutput — do not use notify/message
  daily: alertOutput(makeDoc("Portfolio Alert", "Push-ready explanation-first alert", [
    str("title"),
    str("body"),
    str("eventIds"),    // comma-separated stable IDs — used by Playbook deep links
    messageActionsField(),
    messagePresentationField(),
  ])),
});

(async () => {
  // [GPW-CONFIG] Load MonitoringConfig — canonical path for both feeds.
  const configPath = feedPath("gpw-monitor") + "/config.json";
  const cfg = JSON.parse(String(await alfs.readFile(configPath)));

  // Runtime schema validation — reject misconfigured runs before doing any work.
  (function validateCfg(c) {
    if (!c || typeof c !== "object")
      throw new Error("gpw-monitor: config.json is not a valid JSON object.");
    if (!Array.isArray(c.tickers) || c.tickers.length === 0)
      throw new Error("gpw-monitor: config.json missing or has no tickers. Run Skill setup first.");
    if (c.tickers.length > 15)
      throw new Error(`gpw-monitor: tickers exceeds max 15 (got ${c.tickers.length}).`);
    const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
    for (const t of c.tickers) {
      if (!TICKER_RE.test(t))
        throw new Error(`gpw-monitor: invalid ticker symbol "${t}" in config.`);
    }
    if (!["long-term", "medium-term"].includes(c.horizon))
      throw new Error(`gpw-monitor: invalid horizon "${c.horizon}" in config.`);
    if (!["guided", "standard", "neutral"].includes(c.guidanceMode))
      throw new Error(`gpw-monitor: invalid guidanceMode "${c.guidanceMode}" in config.`);
    if (typeof c.preferencesNote !== "string" || c.preferencesNote.length < 50)
      throw new Error("gpw-monitor: preferencesNote is missing or too short in config.");
  })(cfg);

  // [GPW-AGENTS-MD] Append user instructions from AGENTS.md (prose only).
  const BASE_PROMPT = cfg.preferencesNote;
  let userInstructions = "";
  try {
    const raw = await alfs.readFile(feedPath("gpw-monitor") + "/AGENTS.md");
    userInstructions = String(raw ?? "").trim();
  } catch (_) { /* missing AGENTS.md is fine */ }
  const portfolioWatchPreferencesNote = userInstructions
    ? `${BASE_PROMPT}\n\n## Additional user instructions\n${userInstructions}`
    : BASE_PROMPT;

  // [GPW-HOLDINGS] Build manualHoldings from config.
  const manualHoldings = cfg.tickers.map(symbol => ({ symbol }));

  // [GPW-ELIGIBLE] Validate a post-LLM selected finding from selectedEventsJson.
  // The upstream alertDecision=push check is a NECESSARY but not sufficient gate —
  // this layer performs deterministic validation on the actual finding data:
  //   - suppression check (LLM may suppress a selected finding post-analysis)
  //   - boolean selected field (selectedEventsJson uses boolean true, not string "true")
  //   - findingType guard (only event_impact; anomaly_attribution etc. are out of scope)
  //   - configured-ticker membership (guards against stale findings across config changes)
  //   - content keyword relevance (earnings, regulatory, strategic, demand, etc.)
  //   - explicit exclusion of rumor-only / unsubstantiated events
  function eligible(f) {
    // Reject suppressed events — non-empty suppressionReason means the finding was discarded
    if (f.suppressionReason) return false;

    // selected is boolean true in selectedEventsJson (not the string "true")
    if (f.selected !== true) return false;

    // Only event_impact findings qualify; anomaly_attribution and others are out of scope
    if (f.findingType !== "event_impact") return false;

    // Must be a currently configured ticker; guards against baseline drift
    if (!cfg.tickers.includes(f.primaryAsset)) return false;

    // payload is a direct object in selectedEventsJson, not a JSON-encoded string
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

  // [GPW-SOURCE-VERIFY] Requires a parseable HTTPS URL with a valid hostname.
  // Rejects null entries, non-string values, malformed URLs, and non-HTTPS protocols.
  // The global URL constructor is available in all modern Node.js runtimes (Node 10+).
  function isVerifiedSource(s) {
    if (s == null || typeof s.url !== "string") return false;
    try { var p = new URL(s.url); return p.protocol === "https:" && p.hostname.length > 0; } catch (_) { return false; }
  }

  // 1. Run portfolio-watch pipeline
  await runPortfolioWatch({
    feedName: "gpw-monitor-evidence",
    secret: require("secret-manager"),
    profile: {
      manualHoldings,
      horizon: cfg.horizon === "medium-term" ? "1–3 years" : "3–5 years",
      portfolioWatchPreferencesNote,
    },
  });

  // 2. Read evidence decision
  const base = feedPath("gpw-monitor-evidence");
  const read = async p => {
    let v = await alfs.readFile(base + "/data/" + p);
    while (typeof v === "string") v = JSON.parse(v);
    return v;
  };
  const decisions = await read("analysis/decision/@last/1");
  const d = decisions[decisions.length - 1];

  // 3. Mirror decision to own feed (for Playbook reads)
  await feed.run(async (ctx) => {
    await ctx.self.ts("analysis", "decision").append([{
      date:                d.runAtMs,
      analysisStatus:      d.analysisStatus,
      healthStatus:        d.healthStatus,
      alertDecision:       d.alertDecision,
      reason:              d.reason || "",
      skipReason:          d.skipReason || "",
      notificationMessage: d.notificationMessage || "",
      runAtMs:             String(d.runAtMs),
      urgency:             d.urgency || "medium",
    }]);

    // 4. Build and emit alert if material events found.
    // Read from selectedEventsJson — post-LLM findings with boolean selected field.
    // eventCandidatesJson contains pre-LLM candidates with different schema and must not be used here.
    const rawFindings = (() => {
      try { return JSON.parse(d.selectedEventsJson || "[]"); } catch (_) { return []; }
    })();
    const accepted = rawFindings.filter(eligible);

    // Evidence gate: require at least one parseable HTTPS URL with a valid hostname on each
    // finding before external delivery. HTTP URLs, malformed URLs, empty strings, non-strings,
    // null entries, and internal eventRefs do not satisfy this gate.
    // d.notificationMessage is LLM-generated narrative; it is NOT treated as a source citation.
    // Source links indicate that a finding has associated external reporting — they are not
    // independent factual verification of financial outcomes.
    const sourceVerified = accepted.filter(function(f) {
      return (f.supportingEvents || []).some(isVerifiedSource);
    });

    // Delivery decision: upstream gate (alertDecision/analysisStatus/healthStatus) is NECESSARY
    // but the evidence gate (sourceVerified) is also REQUIRED for external notification.
    const push = sourceVerified.length > 0
      && d.alertDecision  === "push"
      && d.analysisStatus === "valid"
      && d.healthStatus   === "valid";

    if (!push) {
      // Log suppression reason for audit (visible in run logs, not sent externally)
      if (accepted.length > 0 && sourceVerified.length === 0) {
        console.log("gpw-monitor: delivery suppressed — missing_verifiable_source for: " +
          accepted.map(function(f) { return f.primaryAsset; }).join(", "));
      }
      return; // quiet run — do not append alert record
    }

    // 5. Generate stable event IDs for deep linking (from source-verified set only)
    const eventIds = sourceVerified.map(stableEventId);
    const alertUrl = `${PLAYBOOK_URL}?event=${eventIds[0]}`;

    // 6. Build explanation-first alert body exclusively from source-verified findings.
    // tickersAffected and eventIds are derived from sourceVerified — not from the full
    // accepted set — so findings without verifiable sources cannot affect the alert content.
    const tickersAffected = [...new Set(sourceVerified.map(f => f.primaryAsset))];
    const body = sourceVerified.map(f => {
      // payload is a direct object in selectedEventsJson (not a JSON-encoded string)
      const pl = (f.payload !== null && typeof f.payload === "object") ? f.payload : {};
      // Verified HTTPS sources guaranteed non-empty by the sourceVerified filter above
      const sources = (f.supportingEvents || [])
        .filter(isVerifiedSource)
        .map(s => `[${s.title || s.url}](${s.url})`);

      const freshness = f.date
        ? `*Data as of ${new Date(f.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}*`
        : null;

      const dataQualityNote = Array.isArray(pl.data_quality_notes)
        ? pl.data_quality_notes[0]
        : (pl.data_quality_notes || "Unknown.");

      return [
        `## ${f.primaryAsset}`,
        `**What happened** ${f.summary || ""}`,
        `**Why it matters** ${(pl.decision_lens && pl.decision_lens.thesis_impact && pl.decision_lens.thesis_impact.rationale) || "See source."}`,
        `**What remains uncertain** ${dataQualityNote}`,
        `**What to watch next**\n${((pl.decision_lens && pl.decision_lens.watch_next) || []).map(w => `- ${w}`).join("\n")}`,
        `**Sources** ${sources.join(" · ")}`,
        freshness,
      ].filter(Boolean).join("\n\n");
    }).join("\n\n---\n\n");
    // body is non-empty: sourceVerified.length > 0 and each finding has verifiable sources

    await ctx.self.ts("alerts", "daily").append([{
      date:     d.runAtMs,
      title:    `Portfolio Watch — ${tickersAffected.join(", ")} ${tickersAffected.length > 1 ? "need" : "needs"} attention`,
      body,
      eventIds: eventIds.join(","),
      actions: [
        openUrlAction("View in Playbook", alertUrl),
        sendPromptAction("Tell me more", "Explain the latest portfolio watch alert in more detail."),
      ],
      presentation: cardPresentation({
        url:    alertUrl,
        footer: "Guided Portfolio Watch",
        fields: tickersAffected.map(t => ({ label: t, value: "Alert", inline: true })),
      }),
    }]);
  });
})();
