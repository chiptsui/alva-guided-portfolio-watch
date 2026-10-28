# Guided Portfolio Watch — Take-Home Submission

**Candidate:** Charlie Tsui | **Date:** 2026-10-27
**Assignment:** Alva PM Take-Home — Build and ship a reusable Skill

---

## Published Playbook

| | |
|---|---|
| URL | https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch |
| Version | v1.0.3 (public) |
| Lint | `alva lint playbook` — 0 errors |
| Data shown | NVDA, TSLA, AAPL financial statements (snapshot, not live-refreshed) |
| Monitoring section | "Monitoring unavailable" — cronjob paused; see Limitations |

---

## What the Skill Does

**Guided Portfolio Watch** provides a live Alva Playbook with financial statement history and year-over-year insights, alongside an implemented architecture for daily event monitoring and explanation-first push alerts. The target user is a hands-off long-term investor with no financial background — someone who bought a few equities, intends to hold 3–5 years, and does not know which market changes are actually meaningful for their specific companies.

Monitoring and push alerts are implemented and the AI pipeline has been exercised in one production run. Both production cronjobs remain intentionally paused; financial-event notifications have not yet been delivered end-to-end.

The Skill is designed to be reusable: changing `config.json` and re-running the feeds is intended to produce a complete, updated Playbook and alert pipeline for any new portfolio without touching source code. This has been demonstrated through local alternate-ticker test scenarios (MSFT, JPM, XOM) but has not been validated for arbitrary users or accounts at scale.

---

## Key Product Decisions

- **Business changes only, not price noise.** The Skill excludes price data and monitors for events with multi-year business impact (earnings changes, regulatory decisions, strategic announcements, supply-chain shifts). A beginner monitoring prices daily is likely to over-react and undermine a long-term strategy.
- **Explanation-first structure.** Every alert and insight card follows: *What happened → Why it matters → What remains uncertain → What to watch next → Sources.* Metric labels in guided mode read "Total sales," "Profit after costs," "Cash generated" — not their technical names.
- **Guidance inferred, not asked — with explicit decision boundaries.** The agent infers communication preference from natural-language signals; it never asks "are you a beginner?" Prompt instructions in `buildPreferencesNote()` direct the LLM to surface evidence and uncertainties rather than recommend buying, selling, or sizing positions. Alert formatting reinforces this; actual LLM output compliance is unverified. The mode is adjustable via AGENTS.md.
- **Evidence gate on alerts.** Findings without at least one external HTTPS source URL are suppressed before delivery. This gate was added after investigating the first production run (see Test Evidence).

---

## Architecture

```
User intent (free text)
    ↓  parseIntent() [src/intent-to-config.js] — deterministic
    ↓  MonitoringConfig written to ALFS [config.json]
    │
    ├─ gpw-fundamentals [cronjob 40870, PAUSED]
    │      Arrays REST API → income / balance sheet / cash flow
    │      → Playbook: YoY insight cards, guided narrative, annual history
    │
    └─ gpw-monitor [cronjob 40871, PAUSED]
           @alva/portfolio-watch — event fetch, dedup, LLM analysis (gpt-5.6-terra)
           ↓  eligible() — deterministic post-LLM guard
           ↓  isVerifiedSource() — URL constructor HTTPS validation
           ↓  alertDecision + analysisStatus + healthStatus gates
           → ctx.self.ts("alerts","daily").append([...])
           → FEED_ALERT → web channel 11017
```

`parseIntent()` maps free text to tickers, guidance mode, horizon, ownership classification, and a deterministic `preferencesNote` prose string. That string becomes the `portfolioWatchPreferencesNote` passed to `@alva/portfolio-watch`. It now includes a shared decision-support boundary instruction across all guidance modes (directing the LLM not to recommend buying, selling, or sizing positions), though actual LLM output compliance is unverified. **Note:** the Alva cloud MonitoringConfig was written before this addition and has not been updated; the live pipeline does not include the new instruction.

---

## Verified Evidence

### 404 local tests, 0 failures

| Suite | Tests | Covers |
|---|---|---|
| Intent fixture | 14 | `parseIntent()` — 14 NL→config scenarios |
| YoY insights | 78 | `computeCompanyInsight()` — signals, edge cases, consecutive-year enforcement |
| Playbook logic | 77 | Inline browser JS — signal accuracy, HTML structure, watchlist/holding rendering |
| Guided narrative | 47 | FCF vs OCF, four-section rendering, accordion CSS |
| Skill reusability | 39 | Full pipeline with MSFT/JPM/XOM synthetic data, no source changes |
| Monitor alert logic | 93 | `eligible()`, URL constructor validation, malformed URL rejection, alertOutput schema |
| Decision-support contract | 56 | Boundary instruction in all guidance modes, no prescriptive static text, G-1–G-4 inference regression, schema validation, alert template structural safety |

### Production monitoring run — run 48637368 (2026-10-26)

| Field | Value |
|---|---|
| Events processed | 110 |
| Findings selected by LLM | 1 (SpaceX/NVDA, `alertDecision: push`) |
| Alert delivery | **Not generated** — post-processing script bug (wrong source field + wrong selected type) |
| Resolution | Bugs identified, corrected, 93 tests added, corrected script deployed 2026-10-26 |

The `@alva/portfolio-watch` pipeline ran correctly. Alert generation failed in the post-processing layer — not the pipeline itself. The SpaceX/NVDA finding has no traceable external HTTPS source URL; under the corrected script it would be suppressed by the evidence gate, but this is an expected outcome under new code, not the observed outcome of that run.

### Isolated V2 delivery test (2026-10-26)

A minimal dedicated feed (`gpw-alert-test`) was created, triggered twice, and fully deleted. No GPW monitoring state was touched.

**Trigger 1** (cronjob PAUSED): run completed, alertOutput record written, but delivery was suppressed — Alva does not deliver notifications when the automation's cronjob is in PAUSED state, even on a manual trigger. **Trigger 2** (cronjob ACTIVE after manual resume): delivery succeeded.

| Field | Value |
|---|---|
| Run ID | f01b8b6b-1d5b-412b-b618-00c03dfd95b9 |
| Delivery status | **sent** |
| Provider | web |
| Channel | 11017 |

**What this proves:** V2 alertOutput → FEED_ALERT → web delivery works when automation is ACTIVE. **What it does not prove:** end-to-end GPW financial-event notification. That requires a production run with the corrected script, a finding that passes the evidence gate, and all upstream gates passing.

**Authorization lesson:** The initial trigger ran on a PAUSED cronjob per authorization, but delivery was suppressed. Delivery required resuming the cronjob and running a second trigger — a step not explicitly in the original authorization. Clearer upfront scoping would have been: "authorize one trigger; a resume may be needed if the paused state suppresses delivery."

---

## Limitations

| Item | Status |
|---|---|
| Real GPW event-to-user notification | **Not verified.** Corrected script deployed; cronjobs paused. No production alert has been delivered. |
| Decision-support prompt instruction | Added to `buildPreferencesNote()` in this repo. The Alva cloud MonitoringConfig was written before this change and has not been updated — the live deployed pipeline does not include the new boundary instruction. |
| Financial snapshot freshness | Stored snapshot from a manual run. Daily refresh requires unpausing cronjob 40870 and a valid ARRAYS_JWT. |
| Cronjobs 40870 and 40871 | Both intentionally paused. No automated runs occur without a deliberate decision to unpause. |
| Source URL coverage | One production run, one finding with no external URL. Unknown whether future findings from other event lanes will carry verifiable URLs. |
| IM delivery | No IM provider connected. Web delivery verified via isolated test only. |

*Historical note:* An `@alva/portfolio-watch` entitlement blocker existed early in development. It was resolved, enabling the production monitoring run. That blocker no longer applies.

---

## Acceptance Criteria

| Criterion (from SKILL.md) | Status |
|---|---|
| `alva lint playbook` passes | **PASS** — 0 errors |
| `alva screenshot` shows visible data | **PASS** — verified (real iPhone QA) |
| `alva alert history` shows `sent` row within 24h of scheduled run | **PARTIAL** — isolated infra test: `status=sent`; no GPW scheduled run has produced a sent row |
| Config swap produces updated output with no old ticker refs | **PASS (local)** — verified via `test/reusability.test.js` with MSFT/JPM/XOM synthetic data; not validated for arbitrary accounts at scale |

---

## Future Priorities

1. **Authorize and execute a production run with the corrected script** — unpause 40871, trigger, confirm `alva alert history` shows `sent`. This is the single highest-impact next step.
2. **Understand source URL coverage** — whether `market_news` lane findings populate `supportingEvents` with HTTPS URLs is unknown from one run. Alert suppression rate in practice depends on this.
3. **IM delivery** — web notifications require the user to open Alva. IM reaches users on their phone without a dedicated app.
4. **Quarterly signal path** — annual FY data lags earnings by months; a quarterly income timeseries would improve signal freshness.
5. **Retry on transformation failure** — a failed alert body builder after dedup baseline commit is a silent skip. An error-state timeseries record would make failures observable.

---

## Supporting Documents

| File | Purpose |
|---|---|
| `README.md` | Playbook overview, data access model, feed status, test matrix |
| `DESIGN_RATIONALE.md` | Problem statement, product decisions, architecture, limitations |
| `SKILL_CONTRACT.md` | Engineering contract: input schema, decision rules, output contract, acceptance tests |
| `SUBMISSION_DETAIL.md` | Full evidence record with code, production run investigation, delivery test sequence |
| `.agents/skills/guided-portfolio-watch/SKILL.md` | Reusable Skill definition — 7-step agent workflow |
| `src/intent-to-config.js` | NL → MonitoringConfig transform (542 lines, zero platform dependencies) |
| `templates/gpw-monitor.stub.js` | Monitoring feed script — deployed to ALFS 2026-10-26 |
| `templates/gpw-fundamentals.stub.js` | Fundamentals feed script |
| `templates/gpw-playbook.stub.html` | Playbook template |
| `config/monitoring-config.schema.json` | MonitoringConfig JSON schema |
| `test/` | 7 test suites, 404 tests |
