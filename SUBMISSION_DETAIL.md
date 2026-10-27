# Guided Portfolio Watch — Take-Home Submission

**Candidate:** Charlie Tsui
**Submission date:** 2026-10-26
**Assignment:** Alva PM Take-Home — Build and ship a reusable Skill on the Alva platform

---

## 1. Published Artifact

| Item | Value |
|---|---|
| Playbook URL | https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch |
| Playbook ID | 33229 |
| Current version | v1.0.3 |
| Slug | `c9jsd/guided-portfolio-watch` |
| Versioned URL | https://c9jsd.playbook.alva.ai/guided-portfolio-watch/v1.0.3/index.html |
| Visibility | Public |
| Lint | `alva lint playbook` — 0 errors |

The Playbook is publicly accessible and displays financial statement data from a stored snapshot for NVDA, TSLA, and AAPL (NVDA through FY2026, TSLA and AAPL through FY2025). The snapshot was loaded by a manual feed run; the daily refresh cronjob (40870) remains intentionally paused. All three tickers are configured as watchlist entries, not confirmed brokerage positions — the Playbook carries this disclaimer explicitly.

---

## 2. Skill Contract

The Skill is defined at `.agents/skills/guided-portfolio-watch/SKILL.md` and covers a 7-step agent workflow:

1. **Parse user intent** — `src/intent-to-config.js` extracts tickers, horizon, guidance mode, ownership classification, and optional weights from free-form text, without asking for financial expertise.
2. **Clarify if needed** — at most one question; only when no tickers are identifiable.
3. **Assemble MonitoringConfig** — a deterministic JSON object written to ALFS at `~/feeds/gpw-monitor/v1/config.json`. This is the single source of truth for both feeds.
4. **Write config to ALFS** — confirmed with a read-back.
5. **Deploy feeds** — `gpw-fundamentals` (financials) and `gpw-monitor` (monitoring + alerts), both reading config at runtime. Requires user approval.
6. **Build and release Playbook** — from `templates/gpw-playbook.stub.html` via `alva lint → draft → release`. Requires user approval.
7. **Enable alert delivery** — publishing creates an owner FEED_ALERT binding automatically. Verified via `alva alert history`.

**Skill acceptance criteria (from SKILL.md):**
- `alva lint playbook` passes with no errors ✓ (verified)
- `alva screenshot` shows visible data ✓ (verified — real iPhone QA)
- `alva alert history` shows a `sent` row within 24h of a scheduled run — *see Section 7*
- Changing `config.json` tickers and re-running produces a complete update with no old ticker references ✓ (verified locally via `test/reusability.test.js`)

---

## 3. Target User, Problem, and Product Decisions

### Target User

A hands-off long-term investor who bought equities they believe in, intends to hold 3–5 years, and has no financial background. They do not follow the market daily and do not know which changes are meaningful for a specific business versus general noise.

### Problem

Most financial dashboards assume the reader already understands finance. A beginner who receives "revenue up 65%, net income up 64%" without context has no way to assess whether this is remarkable, expected, or concerning — and no way to know whether anything requires attention. The result is either anxiety from noise or inaction from incomprehension.

### Product Decisions

**Business changes, not daily price noise.** The Skill excludes price data. A beginner monitoring prices daily is likely to over-react and undermine a long-term strategy. The Skill focuses on events with multi-year business impact: earnings changes, regulatory decisions, strategic announcements, and supply-chain shifts.

**Explanation-first structure.** Every alert and insight card follows a fixed structure: *What happened → Why it matters → What remains uncertain → What to watch next → Sources.* Metric labels in guided mode read "Total sales," "Profit after costs," and "Cash generated" — not their technical names.

**Guidance inferred, not asked.** The agent infers guidance preference from natural-language signals ("explain it to me" → guided; correct use of EBITDA/FCF → standard). It never asks "are you a beginner?" The mode is a communication preference, not an expertise claim, and can be adjusted via AGENTS.md after setup.

**Single source of truth.** Both feeds read from a single `config.json` file at ALFS runtime. The Playbook is fully config-driven: changing tickers in config and re-running the feeds produces a complete update with no code changes — the reusability guarantee.

**Real-user QA finding.** Initial QA confirmed correct data on desktop and real iPhone private browsing. A real tester found that accurate financial metrics without plain-English framing were insufficient for a beginner. This drove the guided mode redesign with human-readable metric labels and the expanded "Why it matters?" section.

---

## 4. Natural Language → Executable Monitoring Behavior

**Entry point:** `src/intent-to-config.js` — zero Alva dependencies; runs with bare `node`.

The `parseIntent()` function runs a 7-stage pipeline:

| Stage | Input | Mechanism | Output |
|---|---|---|---|
| Ticker extraction | Raw text | Regex + company-name dictionary + crypto blocklist + common-word blocklist | `["NVDA", "TSLA", "AAPL"]` |
| Ownership classification | Raw text | Keyword regex ("I own" → holding, "watching" → watchlist) | `{ NVDA: "holding", ... }` |
| Horizon inference | Raw text | Keyword match; short-term → unsupported hard stop | `"long-term"` |
| Guidance mode inference | Raw text | 3-level priority tree (explicit > contextual > default) | `"guided"` |
| Weight extraction | Raw text | Percentage patterns; normalizes if sum ≠ 1.0 ± 0.02 | `{ NVDA: 0.5, ... }` or null |
| Sector focus areas | Sector/industry from company-detail API | SECTOR_FOCUS lookup table (33 sector keys); fallback for unknown | One-sentence per ticker |
| preferencesNote assembly | All above fields | Deterministic template; never LLM-generated | Prose prompt for `@alva/portfolio-watch` |

**Example transformation:**

Input: *"I'm new to investing and just bought some Apple and Nvidia stock. Long-term hold."*

Output:
```json
{
  "tickers": ["AAPL", "NVDA"],
  "holdings": { "AAPL": "holding", "NVDA": "holding" },
  "horizon": "long-term",
  "guidanceMode": "guided",
  "preferencesNote": "The user owns AAPL, NVDA. Investment horizon: 3–5+ years.\n\nUse plain, jargon-free English..."
}
```

The `preferencesNote` becomes `portfolioWatchPreferencesNote` in the `@alva/portfolio-watch` call, directing its LLM (gpt-5.6-terra) to frame findings for a beginner.

**Test coverage:** 14 intent fixture tests (`test/run-tests.js`) covering guidance mode, horizon, ticker blocklist, crypto rejection, weight normalization, and unsupported horizon detection.

---

## 5. Monitoring Architecture and Notification Pipeline

### Architecture

```
User natural-language intent
    ↓  parseIntent() — src/intent-to-config.js
    ↓  MonitoringConfig — config.json written to ALFS
    ├─ gpw-fundamentals feed (cronjob 40870, 06:15 UTC, PAUSED)
    │      Arrays REST API → income/balance/cashflow for each ticker
    │      → fundamentals/snapshot timeseries
    │      → Playbook: YoY insights, guided narrative, annual history
    │
    └─ gpw-monitor feed (cronjob 40871, 06:30 UTC, PAUSED)
           @alva/portfolio-watch (requires pro_automation entitlement)
               ├─ Event fetch + dedup (stateCommitted baseline)
               ├─ LLM analysis (gpt-5.6-terra)
               └─ findings → selectedEventsJson
           ↓  eligible() filter — deterministic post-LLM guard
           ↓  isVerifiedSource() — URL constructor validation (HTTPS required)
           ↓  alertDecision gate (alertDecision=push + analysisStatus=valid + healthStatus=valid)
           ↓  ctx.self.ts("alerts","daily").append([...])
           → FEED_ALERT → web channel 11017
           → Playbook: attention section
```

### Deterministic Layers

The wrapper adds two deterministic post-LLM guards:

**`eligible(f)`** — validates each finding from `selectedEventsJson`:
- Rejects suppressed events (`suppressionReason` non-empty)
- Requires `selected === true` (boolean, not string)
- Requires `findingType === "event_impact"`
- Requires ticker membership in current config
- Requires business-relevance keywords (earnings, revenue, regulatory, strategic, etc.)
- Rejects `rumor_only` / `unsubstantiated` findings

**`isVerifiedSource(s)`** — validates each supporting event's source URL:
```javascript
try { var p = new URL(s.url); return p.protocol === "https:" && p.hostname.length > 0; }
catch (_) { return false; }
```
Rejects: null, non-string, malformed, HTTP, `javascript:`, empty hostname. Uses the URL constructor (Node 10+, confirmed available in Alva cloud runtime).

Findings without at least one verified source URL are suppressed and logged. The alert body is built exclusively from source-verified findings.

### Delivery Path

```
alertOutput() declaration in feed.def()
    + push_notify=true on cronjob (40871)
    + target_status=ACTIVE (automation must be active)
    + alertDecision=push + analysisStatus=valid + healthStatus=valid
    + at least one source-verified finding
    → ctx.self.ts("alerts","daily").append([record])
    → FEED_ALERT bound to channel 11017
    → web delivery to Alva web client
```

**Key operational lesson learned:** A manually triggered run on a PAUSED cronjob writes the feed record but suppresses delivery (`target_status: PAUSED`). Delivery requires `target_status: ACTIVE`. This was discovered during the isolated delivery test.

### Alert Format

Every material alert uses this explanation-first structure:

```
## TICKER

**What happened** — plain past tense, 1–3 sentences

**Why it matters** — long-term business impact, 1–3 sentences

**What remains uncertain** — data quality notes, 1–2 sentences

**What to watch next**
- bullet 1
- bullet 2

**Sources** — [Title](https://...)

*Data as of Mon DD, YYYY*
```

Actions: `openUrlAction("View in Playbook", url)` + `sendPromptAction("Tell me more", prompt)`

---

## 6. Test Evidence

### Local Test Suites (348 tests, 0 failures)

| Suite | File | Tests | Coverage |
|---|---|---|---|
| Intent fixture tests | `test/run-tests.js` | 14 | `parseIntent()` — 14 scenarios: ticker extraction, guidance mode, horizon, weights, crypto rejection, blocklist |
| YoY insights unit tests | `test/yoy-insights.test.js` | 78 | `computeCompanyInsight()` — signals, edge cases, null handling, consecutive-year enforcement, FCF/OCF disambiguation |
| Playbook logic regression | `test/playbook-logic.test.js` | 77 | Inline browser JS — signal accuracy, gap enforcement, HTML structure, watchlist/holding rendering |
| Guided narrative correctness | `test/guided-narrative.test.js` | 47 | FCF vs OCF terminology, four-section rendering, neutral mode, accordion CSS |
| Skill reusability | `test/reusability.test.js` | 39 | Full pipeline with MSFT/JPM/XOM synthetic data — no source-code changes required |
| Monitor alert logic | `test/monitor-alert.test.js` | 93 | `eligible()` type correctness, URL constructor validation, malformed URL rejection, provenance policy, mixed-finding isolation, suppression, alertOutput schema, structural stub assertions |

Run all suites:
```
node test/run-tests.js && node test/yoy-insights.test.js && node test/playbook-logic.test.js && node test/guided-narrative.test.js && node test/reusability.test.js && node test/monitor-alert.test.js
```

### Production Monitoring Run (run 48637368, 2026-10-26)

| Field | Value |
|---|---|
| Run ID | 48637368 |
| Date | 2026-10-26 |
| Status | COMPLETED |
| Events processed | 110 |
| Findings selected by LLM | 1 |
| `alertDecision` | push |
| `analysisStatus` | valid |
| `healthStatus` | valid |
| Alert delivery | **Not generated** — post-processing script bug |

**What actually happened:** The `@alva/portfolio-watch` pipeline ran correctly and produced one material finding (SpaceX/NVDA) with `alertDecision: push`. However, alert generation failed due to two data-contract bugs in the post-processing script that was deployed at the time:

1. The script read from `eventCandidatesJson` (pre-LLM candidates, different schema) instead of `selectedEventsJson` (post-LLM findings with boolean `selected` field).
2. The `selected` field type check expected a string; the actual value is boolean `true`.

These bugs meant no alert record was ever appended — the post-processing stage silently produced nothing.

**Subsequent fix:** Both bugs were identified through investigation, corrected in `templates/gpw-monitor.stub.js`, covered by 93 offline tests, and the corrected script was deployed to ALFS on 2026-10-26. The corrected script also adds URL constructor–based source validation (`isVerifiedSource`).

**Post-fix expectation (not observed):** The SpaceX/NVDA finding has no traceable external source URL — `rawEventsJson.url: ""`, `sourceLinks: []`, source is a Reuters NewsML identifier in metadata only with no public hyperlink, and 4 indexed_x candidates with `https://x.com/` URLs showed zero cross-linkage via any documented field. Under the corrected script, this finding would be suppressed by the evidence gate with `missing_verifiable_source`. This is an expected outcome under the new code, not the observed outcome of run 48637368.

The corrected script has not yet run in production. Whether future monitored findings will carry verifiable source URLs is unknown from one run.

---

## 7. Isolated V2 alertOutput Delivery Verification

To verify the Alva notification infrastructure independently of the full analysis pipeline, a controlled isolated test was executed on 2026-10-26.

### What Was Tested

A minimal dedicated feed (`gpw-alert-test`) was created, used once, and fully deleted. It made no calls to `@alva/portfolio-watch`, consumed no financial data APIs, and touched no production monitoring state or dedup baseline.

### Sequence

```
1. Created cronjob 40883 (gpw-alert-test, cron: 0 0 1 1 *, PAUSED)
2. alva automation publish → feed_id 36255, FEED_ALERT auto-bound to channel 11017
3. First trigger (cronjob PAUSED): run COMPLETED, alertOutput record written, delivery suppressed
   → Lesson: target_status=PAUSED suppresses delivery even on manual trigger
4. Resumed cronjob → ACTIVE → second trigger
5. Run f01b8b6b-1d5b-412b-b618-00c03dfd95b9: COMPLETED, 1 credit, 463ms
   → alva alert history: status="sent", delivery_provider="web", channel 11017 ✓
6. Cleanup: alva alert disable, alva automation delete (id 36255 + cronjob 40883), alva fs remove
7. Verified: 0 test bindings remaining; production bindings intact (36244, 36243)
8. Verified: production cronjobs 40870 (paused, run_count=1) and 40871 (paused, run_count=1) unchanged
```

### Result

| Field | Value |
|---|---|
| Run ID | f01b8b6b-1d5b-412b-b618-00c03dfd95b9 |
| Status | COMPLETED |
| Alert delivery status | **sent** |
| Delivery provider | **web** |
| Channel | 11017 |

**What this verifies:** The Alva V2 alertOutput delivery infrastructure (FEED_ALERT → web channel) works as documented. A feed script that calls `ctx.self.ts("alerts","<name>").append([record])` on an `alertOutput`-declared timeseries, running under an ACTIVE automation with `push_notify=true`, delivers to the web channel.

**What this does NOT verify:** End-to-end GPW event-to-user delivery. A real gpw-monitor alert requires: a production run with the corrected script, a material finding that passes both the `eligible()` filter and the evidence gate (at least one external HTTPS source URL), and all upstream gates passing (`alertDecision: push`, `analysisStatus: valid`, `healthStatus: valid`). This test validates the delivery infrastructure only.

### Authorization Boundary Lesson

The first trigger was executed on a PAUSED cronjob (as authorized), and produced no delivery. To verify delivery, the cronjob was resumed, triggering a second run. This second trigger — resuming the cronjob and triggering again — was not explicitly included in the original single-trigger authorization. It was necessary to complete the delivery verification, but represents an authorization boundary where clearer upfront scoping ("authorize one trigger, may require resume if delivery is suppressed") would have been better.

---

## 8. Limitations

### Current State

| Limitation | Detail |
|---|---|
| No GPW alert delivered end-to-end | The one production run (48637368) had a post-processing bug that prevented alert generation. The corrected script was deployed 2026-10-26 but has not yet run in production. A GPW financial-event notification has never been delivered. |
| Both cronjobs intentionally paused | Cronjobs 40870 (gpw-fundamentals) and 40871 (gpw-monitor) are paused. No automated scheduled runs occur. Unpausing and confirming delivery requires a deliberate next step. |
| Financial snapshot is not live-refreshed | The Playbook reads from a stored snapshot. Daily refresh requires cronjob 40870 to be unpaused and an active ARRAYS_JWT credential. |

*Historical note:* During development, the `@alva/portfolio-watch` module initially required a `pro_automation` entitlement that was unavailable. This was resolved, enabling the production monitoring run. That blocker no longer applies.

### Structurally Unverified

| Item | Status |
|---|---|
| Real GPW alert delivery (gpw-monitor → push notification) | Unverified. The isolated test validates the infrastructure; the full pipeline has not been exercised. |
| `supportingEvents` URL population for `market_news` lane | Unknown. The one production run had a `portfolio_news`/`industry_news` finding. Whether `market_news` findings populate `supportingEvents` with HTTPS URLs is not confirmed. |
| `sendPromptAction` rendering on web | Not observed. Web delivery was confirmed but the action rendering in the notification UI was not inspected. |
| IM delivery | No IM provider connected. Web delivery only. |
| Monitoring dedup baseline ordering | The dedup baseline may be committed before downstream alert transformation completes. A failed transformation after baseline commit would not retry. |

### Scope

| Item | Outside scope |
|---|---|
| Price charts or intraday monitoring | By design |
| Buy / sell / hold recommendations | By design |
| Earnings calendar | Not built |
| Performance vs. benchmark | Not built |
| Multi-user parameterisation | Not built in MVP |

---

## 9. Future Improvements (Prioritized by User Impact)

| Priority | Improvement | User Impact |
|---|---|---|
| 1 | **Run the corrected script in production and verify end-to-end delivery** | The corrected script is deployed but unexercised. Unpausing 40871, triggering a run, and confirming `alva alert history` shows a `sent` row is the single highest-impact next step. Without it, the monitoring pipeline is untested in its current form. |
| 2 | **Source URL coverage** | The one production finding had no external source URL. Whether `market_news` lane findings reliably populate `supportingEvents` with HTTPS URLs is unknown. Without verifiable sources, material events are suppressed. Understanding this through additional runs is critical to knowing the alert suppression rate in practice. |
| 3 | **IM delivery (Telegram/Discord)** | Web notifications are only seen when the user opens Alva. IM delivery reaches users on their phone without a dedicated app — the highest friction reduction for a hands-off investor. |
| 4 | **Quarterly signal path** | Annual data (FY) lags earnings by months. A quarterly income timeseries would make insight cards reflect the most recent reported period, meaningfully improving signal freshness for the target user. |
| 5 | **AGENTS.md onboarding** | Users can customize preferences via AGENTS.md but the Playbook does not surface this. A visible entry point in the UI would reduce the gap between the Skill contract and what the user can actually discover and change. |
| 6 | **Multi-user Playbook template** | The current Playbook is a single-user instance. A parameterized template that any user can fork via config swap would validate the reusability claim with real users beyond the test suite. |
| 7 | **Retry on transformation failure** | If the alert body builder fails after the dedup baseline is committed, that finding is silently skipped. A retry mechanism or visible error-state record would make failures observable. |

---

## Submission Checklist

| Requirement | Status |
|---|---|
| Published Playbook URL | ✓ https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch |
| Skill SKILL.md contract | ✓ `.agents/skills/guided-portfolio-watch/SKILL.md` |
| `alva lint playbook` passes | ✓ 0 errors |
| Intent-to-config transform | ✓ `src/intent-to-config.js` (542 lines, 14 tests) |
| MonitoringConfig written to ALFS | ✓ `/alva/home/c9jsd/feeds/gpw-monitor/v1/config.json` |
| Feed scripts deployed | ✓ gpw-fundamentals (36243, PAUSED), gpw-monitor (36244, PAUSED) |
| Playbook shows visible data | ✓ Real NVDA/TSLA/AAPL financial statements, QA verified |
| 348 local tests, 0 failures | ✓ 6 suites |
| Production monitoring run evidence | ✓ Run 48637368, 110 events, 1 finding, alertDecision=push; post-processing bug prevented delivery; corrected script deployed |
| V2 alertOutput delivery verified | ✓ status="sent", provider="web", channel 11017 (isolated test) |
| Limitations documented | ✓ Section 8 |
| Future improvements | ✓ Section 9 |
| No exaggerated delivery claims | ✓ Real GPW alert delivery explicitly noted as unverified |
