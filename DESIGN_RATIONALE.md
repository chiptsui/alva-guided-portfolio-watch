# Guided Portfolio Watch — Design Rationale

## Problem and Persona

Most financial dashboards assume the reader already understands finance. A first-time long-term investor — someone who bought a few well-known equities, intends to hold 3–5 years, and has no financial background — has no reliable way to know which changes deserve attention or what they mean for a specific business. The result is either anxiety from noise or inaction from incomprehension.

**Product principle:** show only what materially affects a long-term business case, in plain English, with a clear distinction between measured facts and interpretive context. Never claim to know what the investor should do.

---

## Why Business Changes, Not Daily Price Noise

Price movements are largely unpredictable from fundamentals over short windows. A beginner monitoring prices daily is almost certain to over-react and undermine a long-term strategy. The Skill excludes price data and focuses on events with multi-year business impact: earnings changes, regulatory decisions, strategic announcements, and supply-chain shifts.

---

## Skill Architecture

**Operational path — Published financial snapshot (manually refreshed):**
```
User intent (natural language)
    ↓ parseIntent() — tickers, horizon, guidanceMode, holdings
    ↓ MonitoringConfig (version-controlled JSON)
    ↓ gpw-fundamentals feed — income, balance sheet, cash flow
    ↓ Fundamentals snapshot (PBSV-scoped, bundled with Playbook)
    ↓ Playbook — YoY insights, guided narrative, annual history
```

**Deployed path — Event Monitoring (corrected script deployed; cronjob paused):**
```
MonitoringConfig → gpw-monitor feed (LLM analysis) → push alerts + Playbook attention section
```

`parseIntent()` is deterministic: ownership signals ("I own" → holding, "I'm watching" → watchlist), horizon from natural-language phrases, guidance mode from explicit beginner signals. The YoY engine compares only consecutive fiscal years; a gap suppresses the percentage. FCF declining more than 5% alongside improving P&L downgrades the signal from Improving to Mixed.

---

## Real-User QA Finding

Initial QA confirmed correct data on anonymous desktop, real iPhone private browsing, and across refresh. However, a real tester found that accurate financial metrics alone — "revenue up 65%, net income up 64%" — were insufficient without prior knowledge of what those terms mean. The insight cards were redesigned to lead with a plain-English "What happened?", followed by "Why does it matter?" and a data-grounded "What should I watch next?" Metric labels in guided mode now read "Total sales," "Profit after costs," and "Cash generated" rather than their technical names.

---

## Evidence

348 local tests, 0 failures (full breakdown in README). Real NVDA/TSLA/AAPL financial statements loaded from a manual run of the fundamentals feed. Playbook 33229 v1.0.3 published and publicly accessible. Skill reusability confirmed with MSFT/JPM/XOM scenarios using no source-code changes. Design lint: 0 errors, 0 warnings.

---

## Limitations

**No GPW alert delivered end-to-end.** The first production monitoring run (48637368, 2026-10-26) confirmed the `@alva/portfolio-watch` pipeline ran correctly: 110 events processed, 1 finding selected with `alertDecision: push`. Post-processing bugs in the originally deployed script prevented alert generation. The corrected script was deployed the same day. Both cronjobs remain paused; a production run with the corrected script has not yet occurred. A real GPW financial-event notification has never been delivered.

**Financial snapshot is not live-refreshed.** The published snapshot was loaded by a manual feed run. Daily refresh requires cronjob 40870 to be unpaused and an active ARRAYS_JWT credential.

**IM delivery unverified.** No IM provider is connected. Web delivery was verified via an isolated infrastructure test; end-to-end GPW event delivery has not been tested.

**Annual data only.** Quarterly signals would require a separate fetch path.

---

## Next Iteration

Success: both cronjobs unpaused and running on schedule, a push notification delivered with a markdown summary and at least one external source URL, `alva alert history` showing a "sent" row for gpw-monitor. Subsequently: IM provider connection, quarterly signal path, and parameterised multi-user Playbook template.
