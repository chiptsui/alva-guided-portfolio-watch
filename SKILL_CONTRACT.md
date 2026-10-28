# Skill Contract: Guided Portfolio Watch

**Version:** 0.2
**Principle:** Help investors understand what deserves their attention without requiring financial-analysis expertise.
**Persona:** Hands-off investor; limited financial knowledge; rarely follows the market.

> Engineering reference. For the agent runtime instruction document see `SKILL.md`.
> For verified platform capabilities see `TECHNICAL_BASELINE.md` and `ARCHITECTURE_REVIEW.md`.

---

## A. User Input Schema

### A.1 Required

- **Tickers:** One or more US-listed equity symbols (1–5 uppercase letters). Minimum 1, soft maximum 15 (alertOutput cap). ETFs, crypto, options, and non-US tickers are rejected at intake with an explanation; setup continues with accepted symbols.

### A.2 Optional Inputs

| Input | Default if absent | Effect when provided |
|---|---|---|
| Holdings vs. watchlist | All symbols treated as holdings | Changes alert prose language only (not pipeline) |
| Investment horizon | Long-term (3–5+ years) | Medium-term adds analyst-target revisions; short-term is unsupported |
| Illustrative weights | None stated | Embedded in preferencesNote as scenario context, not as verified data |
| Quantities / cost basis | Unknown | If volunteered, noted in preferencesNote; never requested |
| Guidance preference | Neutral | Explicit preference overrides inferred mode immediately |

Short-term / day-trading requests are unsupported. Inform the user and confirm whether long-term monitoring is acceptable before proceeding.

---

## B. Agent Decision Contract

### B.1 Guidance Mode — Preference Inference

Guidance mode is a **communication preference**, not a claim about the user's expertise. The agent infers it from explicit preference signals. Jargon or question style are weak contextual signals only.

```
Priority 1 — Explicit preference (always wins):
  "explain in plain English", "I'm new to investing", "I don't understand markets",
  "help me understand", "explain to me" → guided
  "I want technical analysis", "assume I know finance", "skip the basics" → standard

Priority 2 — Contextual signals (apply only when explicit preference is absent):
  Correct use of financial jargon (EBITDA, FCF, NIM, basis points, P/E ratio) → standard
  Framing as worry or confusion ("should I be worried?", "what does this mean?") → guided

Priority 3 — Default (no signals, or mixed/conflicting signals):
  → neutral
  Build with guided layout by default; user can adjust.
  Do NOT ask "are you a beginner?" or "what is your experience level?".
```

### B.2 Clarification Policy

Ask at most **one** clarifying question, only when the answer materially changes what gets built.

| Missing info | Question to ask |
|---|---|
| No tickers in the request | "Which companies would you like to monitor?" |
| Horizon explicitly conflicts with skill scope | Inform user; confirm long-term is acceptable |

Do not ask about: experience level, number of shares, financial goals, risk tolerance score.
Do not ask a second question even if other information is missing.

### B.3 MonitoringConfig Assembly

The agent produces a single **MonitoringConfig** object (defined in `config/monitoring-config.schema.json`) from user intent. This is the single source of truth for tickers, horizon, guidance mode, and preferences note. It is written to ALFS at `~/feeds/gpw-monitor/v1/config.json` and read by both feed scripts at cloud runtime.

**AGENTS.md is separate and prose-only.** It carries free-text user notes appended to the base LLM prompt — it is never parsed as structured config. Feed scripts read it separately and append it to their base prompt via the documented pattern in `feed-sdk.md §User Instructions`.

### B.4 Event Analysis and Deduplication

Delegated entirely to `@alva/portfolio-watch`. We do not reimplement its event collection, LLM materiality analysis, or state-based deduplication. Our contribution is the `preferencesNote` field in MonitoringConfig, which becomes `portfolioWatchPreferencesNote` in the module call.

Our wrapper adds one deterministic `eligible()` guard post-analysis: accepts only `event_impact` findings for monitored symbols passing a business-relevance regex, and rejects `rumor_only` or `unsubstantiated` findings.

### B.5 Guidance without Prescription — Design Contract

Guidance mode controls communication style and explanation depth. It does not unlock prescriptive investment advice.

Across all modes:

- No buy, sell, hold, position-sizing, or allocation instructions.
- Users retain full responsibility for investment decisions.
- Present relevant evidence, known uncertainties, missing context, and questions worth investigating.
- Signal labels (Improving / Declining / Mixed) describe metric trends — not investment ratings or recommendations.

Enforcement layers:

1. **`buildPreferencesNote()`** — a shared `decisionSupportNote` block appears in every `portfolioWatchPreferencesNote`, regardless of guidance mode.
2. **Alert format** (C.3) — no "What you should do" section. "Attention needed" is one sentence, never a buy/sell directive.
3. **Playbook disclaimer** — "not a buy or sell instruction" in the beginner guide; "not investment ratings or recommendations" on signal labels.

**Limitation:** including this instruction in the prompt reduces the probability of prescriptive LLM output but does not guarantee it. No keyword-based suppression is applied to alert content; such suppression could incorrectly block legitimate financial reporting.

### B.6 What Is Deterministic vs. LLM-Driven

| Decision | Owner | Mechanism |
|---|---|---|
| Ticker parsing and normalization | Agent / `intent-to-config.js` | Regex + blocklist |
| Guidance mode inference | Agent / `intent-to-config.js` | Signal priority tree |
| Horizon inference | Agent / `intent-to-config.js` | Keyword match |
| Event collection and dedup | `@alva/portfolio-watch` | Deterministic + state |
| Materiality and finding selection | `@alva/portfolio-watch` | LLM (gpt-5.6-terra) |
| Post-filter (eligible guard) | Wrapper script | Deterministic regex |
| Push vs. quiet decision | Wrapper script | Deterministic |
| Alert body sections | Wrapper script | Template from LLM-generated fields |

---

## C. Output Contract

### C.1 MonitoringConfig (runtime source of truth)

Written to ALFS: `~/feeds/gpw-monitor/v1/config.json`

Schema: `config/monitoring-config.schema.json`

Key fields:

```json
{
  "version": "1.0.0",
  "tickers": ["AAPL", "MSFT"],
  "holdings": { "AAPL": "holding", "MSFT": "holding" },
  "horizon": "long-term",
  "guidanceMode": "guided",
  "weights": { "AAPL": 0.6, "MSFT": 0.4 },
  "sectorFocusAreas": {
    "AAPL": "Watch: iPhone demand, Services revenue, platform regulation.",
    "MSFT": "Watch: Azure growth, AI services, enterprise spending."
  },
  "preferencesNote": "[assembled prose for portfolioWatchPreferencesNote]",
  "createdAt": "2026-10-23T00:00:00Z",
  "updatedAt": "2026-10-23T00:00:00Z"
}
```

`sectorFocusAreas` is populated at setup time from the company-detail API (`sector` + `industry` fields → lookup table). If the API call fails or the sector is unknown, a generic fallback is used. The field is never invented.

`preferencesNote` is assembled deterministically from the other fields. It is never LLM-generated.

### C.2 Playbook UI (sequential scroll, no tabs in MVP)

Four sections in order:

1. **`#decision`** — What deserves your attention? Source: `analysis/decision/@last/1` from gpw-monitor feed.
2. **`#plan`** — Your monitoring plan. Source: same decision record (tickers, horizon, alert policy from embedded monitoringConfig).
3. **`#companies`** — Financial history per ticker. Source: `fundamentals/snapshot/@last/1` from gpw-fundamentals feed.
4. **`#guide`** — Beginner guide. Source: static HTML. Always present; collapsed by default for standard/neutral.

### C.3 Alert Format

Every material alert uses this fixed explanation-first structure:

```
## [TICKER] · [Date]
**What happened** — [1–3 sentences, plain past tense]
**Why it matters over [horizon]** — [1–3 sentences, long-term impact]
**Attention needed** — [1 sentence, never a buy/sell]
**What remains uncertain** — [1–2 sentences]
**What to watch next** — [2–4 bullets]
**Sources** — [[Title](url)] ...
```

Findings without at least one external `https://` source URL are excluded from the alert body.

### C.4 Alert Delivery (V2 alertOutput)

```javascript
// Declared output — group must not be named "data"
feed.def("alerts", {
  daily: alertOutput(makeDoc("Portfolio Alert", "Push-ready portfolio event", [
    str("title"), str("body"),
    messageActionsField(), messagePresentationField()
  ]))
});

// Record on push run only — quiet run: do not append
await ctx.self.ts("alerts", "daily").append([{
  date: Date.now(),
  title: "Portfolio Watch — AAPL, MSFT",
  body: "[explanation-first markdown]",
  actions: [
    openUrlAction("View Playbook", "https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch"),
    sendPromptAction("Tell me more", "Explain the latest portfolio watch alert.")
  ],
  presentation: cardPresentation({ footer: "Guided Portfolio Watch", ... })
}]);
```

**Status: documented, unverified end-to-end for new feeds.** Verified via `alva alert history` after first scheduled run.

### C.5 Data Freshness and Uncertainty

- Decision panel: shows `runAtMs` as "Checked [datetime]". Warning banner if > 48h old.
- Quiet run: explicit "No new material events in latest check — [datetime]" message. Not a blank panel.
- Financial history: shows `asOf` timestamp and filing date per record.
- All sections carry the disclaimer: "For informational purposes only. Not investment advice."

---

## D. Acceptance Tests

### D.1 Guidance Mode Tests (local, no cloud)

| ID | Input | Expected `guidanceMode` |
|---|---|---|
| G-1 | "I'm new to investing and just bought some Apple and Microsoft stock." | `guided` |
| G-2 | "Set up monitoring for NVDA and AMD." | `neutral` |
| G-3 | "Monitor my NVDA and AMD positions. I'm interested in data-center revenue and margin trends." | `standard` |
| G-4 | "I have some ETFs and a few stocks. I want to understand when something big happens." | `guided` |

All four run via `node test/run-tests.js` against fixture files. No cloud access needed.

### D.2 Reusability Tests (require cloud deployment)

| ID | Test | Pass condition |
|---|---|---|
| R-1 | Two-ticker non-tech portfolio (JPM, XOM) | Playbook shows JPM/XOM sections; no NVDA/TSLA/AAPL references |
| R-2 | Five-ticker diverse portfolio (MSFT, AMZN, BRK.B, V, MCD) | All five company sections render |
| R-3 | Config swap | Change config.json tickers → re-run gpw-fundamentals → new companies appear; old ones gone |

R-1 through R-3 require deployed feeds and are deferred to cloud deployment milestone.

### D.3 Alert Tests (require deployed automation)

| ID | Test | Pass condition |
|---|---|---|
| AC-1 | `alva lint playbook` | No error-severity findings |
| AC-2 | `alva screenshot` | Visible data in at least one section |
| AC-3 | Feed decision record | `analysisStatus: valid`, `runAtMs` within 25h |
| AC-4 | Alert body content | Has `**What happened**` heading; at least one external `https://` URL |
| AC-5 | `alva alert history` | At least one `sent` row within 24h of scheduled run |
| AC-6 | Reusability via config swap | New tickers render; no old ticker references |

---

## E. Implementation Plan

### E.1 Reuse (verbatim or near-verbatim)

| Item | Source | Change |
|---|---|---|
| `@alva/portfolio-watch` module call | Existing baseline | New `feedName` + config-driven `manualHoldings` + `preferencesNote` |
| Monitor script structure | `long-term-portfolio-watch/v1/src/index.js` | 7 parameterization points; config read from ALFS |
| Fundamentals script | `long-term-fundamentals/v1/src/index.js` | Ticker array from config.json; remove hardcoded weights |
| All HTML helpers | Existing Playbook HTML | Copy verbatim |
| Decision panel + chart layout | Existing Playbook HTML | Copy; add quiet-run message and freshness indicator |

### E.2 New Code

| Item | File | Why new |
|---|---|---|
| Intent-to-config transform | `src/intent-to-config.js` | No equivalent exists |
| Sector focus-area lookup table | `src/intent-to-config.js` | Replaces hardcoded per-ticker text |
| config.json reader in feed scripts | gpw-monitor.js, gpw-fundamentals.js | Feed scripts read structured ALFS file |
| Beginner guide HTML section | Playbook HTML | New section |
| Quiet-run message | Playbook HTML | New behavior |
| V2 alertOutput + actions | gpw-monitor.js | Replaces legacy `notify/message` |

### E.3 Unverified Capabilities

| Capability | Risk | Mitigation |
|---|---|---|
| V2 `alertOutput` delivery for new feeds | Medium | Test via `alva alert history` after first run |
| `alva automation publish` for new feeds | Low | Documented workflow; standard path |
| `--agent-type alpi` AGENTS.md editing | Medium | Fall back to config.json only if publish fails |
| `sendPromptAction` rendering on web | Medium | Web delivery is acceptable; IM requires provider |
| `alva release playbook` for new HTML | Low | Follow existing lint/draft/release flow |

---

## Appendix: Reusable Skill Definition

The Guided Portfolio Watch is a **reusable Skill** (see `SKILL.md`) that, for any user-provided portfolio:

1. Parses user intent locally → produces a MonitoringConfig
2. Writes MonitoringConfig to `~/feeds/gpw-monitor/v1/config.json`
3. Deploys two feeds (`gpw-fundamentals`, `gpw-monitor`) that read from config.json at runtime
4. Releases a Playbook that reads from both feeds
5. Enables alert delivery

Reusability is proven when: changing `config.json` and re-running the feeds produces a fully updated Playbook and alert pipeline for the new portfolio without any code changes. This is acceptance test AC-6 / R-3.
