---
name: guided-portfolio-watch
description: >-
  Build and maintain a Guided Portfolio Watch for any portfolio of US-listed
  equities. Generates a Playbook, daily monitoring feeds, and
  explanation-first alerts. Optimized for hands-off, beginner-friendly
  investing without requiring financial-analysis expertise.
version: "0.1"
---

# Guided Portfolio Watch Skill

## What This Skill Builds

For any user-provided portfolio, this skill produces:

1. **MonitoringConfig** — a structured JSON object written to ALFS, the single source of truth for the ticker list, horizon, guidance mode, and preferences note.
2. **Two feed automations** — `gpw-fundamentals` (financial history) and `gpw-monitor` (daily event analysis + push alerts), both reading config at runtime.
3. **One Playbook** — `guided-portfolio-watch`, live at `https://alva.ai/u/{username}/playbooks/guided-portfolio-watch`.
4. **Daily alerts** — explanation-first notifications when material events occur.

The Skill is reusable: changing config.json and re-running the feeds produces a complete Playbook and alert pipeline for any new portfolio without code changes.

---

## Guidance without Prescription

Guidance mode controls communication style and explanation depth only. It does not unlock prescriptive investment advice.

Across all modes (guided, neutral, standard):

- **No investment instructions.** Do not recommend buying, selling, holding, or sizing any position. Do not give personalized allocation guidance.
- **User responsibility.** The user retains full responsibility for investment decisions. The Skill surfaces information; it does not make decisions.
- **Evidence and uncertainty first.** Highlight relevant evidence, known uncertainties, missing context, and questions worth investigating — rather than conclusions about what to do.
- **Labels are not ratings.** Signal labels (Improving / Declining / Mixed) describe year-over-year metric trends. They are not investment ratings or recommendations.

These boundaries are enforced in `buildPreferencesNote()` (shared instruction in every `portfolioWatchPreferencesNote`, regardless of mode), the alert format (no "buy/sell" section), and the Playbook disclaimer.

---

## Step 1 — Parse User Intent

Call `src/intent-to-config.js` (or apply its logic) to extract a MonitoringConfig from the user's message. Do this before asking any questions.

### Ticker Extraction

Scan for 1–5 uppercase letter sequences or patterns like `BRK.B`. Accept US-listed equities only. Reject ETFs, crypto (e.g., BTC, ETH, SOL), options, and non-US tickers — inform the user and continue with accepted symbols.

Common-word blocklist (reject even if uppercase): `I, A, AN, OR, FOR, AND, AT, IN, ON, MY, ME, THE`.

### Guidance Mode (preference inference — not expertise claim)

Apply this priority order. Stop at the first match.

```
1. EXPLICIT PREFERENCE (always wins):
   "in plain English" / "explain to me" / "I'm new to investing"
   "I don't understand" / "help me understand" → guided

   "I want technical details" / "assume I know finance"
   "skip the basics" / "technical analysis" (as a preference) → standard

2. CONTEXTUAL SIGNALS (only when explicit preference is absent):
   Correct use of: EBITDA, FCF, NIM, P/E, basis points, net interest margin,
   operating leverage, CAGR → standard

   "should I be worried?" / "what does this mean for me?" / "is this bad?" → guided

3. DEFAULT (mixed, conflicting, or absent signals):
   → neutral
```

Never ask "are you a beginner?" or "what is your experience level?".
NEUTRAL uses the guided layout by default; user can change via AGENTS.md.

### Horizon

- Keywords: "long-term", "3–5 years", "hold forever", "retirement" → `long-term`
- Keywords: "medium-term", "1–3 years", "next couple years" → `medium-term`
- Keywords: "day trade", "swing trade", "short-term", "< 1 year" → **unsupported**. Inform user; ask if long-term monitoring is acceptable before continuing.
- Default (no signal): `long-term`.

### Ownership Classification

- "I own", "I bought", "my position", "I have" → `holding`
- "watching", "tracking", "keep an eye on" → `watchlist`
- Ambiguous → `holding` (safer default; avoids telling a holder they don't own this)

Ownership affects alert prose language only. The pipeline treats all symbols identically.

### Weights (Optional)

Parse explicit percentage patterns: "50% NVDA, 30% TSLA, 20% AAPL". If provided, store as `weights` object (values 0–1, must sum to 1.0 ± 0.02; normalize if off by rounding). If not provided, omit `weights` from config.

---

## Step 2 — Clarify If Needed (at most one question)

Ask only if the answer materially changes what gets built:

| Situation | Ask |
|---|---|
| No tickers provided | "Which companies would you like to monitor?" |
| Horizon conflicts (day trading) | Inform + confirm long-term is acceptable |

Do not ask about: number of shares, cost basis, financial goals, experience level.
Do not ask a second question.

---

## Step 3 — Assemble MonitoringConfig

Build the full MonitoringConfig object (see `config/monitoring-config.schema.json`).

**sectorFocusAreas** — fetch company-detail for each ticker via `arrays-data-api-equity-fundamentals`. Use the `sector` + `industry` fields and the lookup table in `src/intent-to-config.js` to generate a one-sentence focus note per ticker. If the API call fails or sector is unknown, use the generic fallback: `"Watch: revenue, earnings, and business-specific developments."` Never invent a focus area.

**preferencesNote** — assemble from config fields using this template:

```
The user [owns/is tracking] [TICKER LIST]. Investment horizon: [HORIZON].

[If GUIDED:] Use plain, jargon-free English. Define financial terms when they first appear.
Frame everything around what the user should pay attention to and why.
[If STANDARD:] Assume intermediate financial literacy. Use standard financial terminology.
[If NEUTRAL:] Use clear, accessible language. Avoid unexplained jargon.

Alert policy: Focus on material long-term business developments only.
Exclude: pure price movements, technical analysis, unsubstantiated rumors.
Include: earnings/guidance changes, regulatory/legal events, strategic announcements,
and supply-chain or product changes with multi-year business impact.

[If weights provided:] Illustrative allocation: [TICKER] [PCT]%, ... (user-provided scenario; not verified current weights.)

[Per-ticker focus areas:]
[TICKER]: [sectorFocusArea]
...

[If any unknown inputs:] Quantities, cost bases, and total portfolio value are not known. Do not compute or imply portfolio-level performance figures.
```

---

## Step 4 — Write Config to ALFS

```bash
# Serialize config to local temp file, then write to ALFS
alva fs write --path '~/feeds/gpw-monitor/v1/config.json' --file /tmp/gpw-config.json --mkdir-parents
```

Confirm the write succeeded with:
```bash
alva fs read --path '~/feeds/gpw-monitor/v1/config.json'
```

Also write the config to `~/feeds/gpw-fundamentals/v1/config.json` (same content — both feeds read from their own path to stay decoupled).

---

## Step 5 — Deploy Feeds (Requires User Approval)

Read `references/setup-workflow.md` before deploying. Do not deploy until the user has confirmed the MonitoringConfig is correct.

Feed 1: **gpw-fundamentals** (use template `templates/gpw-fundamentals.stub.js`)
- Cron: `15 6 * * *`
- Output: `fundamentals/snapshot` (JSON blob)
- No alert output

Feed 2: **gpw-monitor** (use template `templates/gpw-monitor.stub.js`)
- Cron: `30 6 * * *`
- Output: `analysis/decision` + `alerts/daily` (V2 alertOutput)
- Deploy with `--push-notify`

---

## Step 6 — Build and Release Playbook (Requires User Approval)

Use template `templates/gpw-playbook.stub.html`. Fill in all `[GPW-*]` markers.
Follow the full lifecycle: `alva lint playbook` → `alva release playbook-draft` → `alva release playbook` → `alva screenshot`.

---

## Step 7 — Enable Alert Delivery (Requires User Approval)

Publishing creates an owner FEED alert binding automatically. Confirm delivery:
```bash
alva alert history --automation gpw-monitor
# Expected: at least one row with status = "sent"
```

---

## Acceptance Criteria

The Skill is complete when:
- `alva lint playbook` passes with no errors
- `alva screenshot` shows visible data (not a blank frame)
- `alva alert history` shows a `sent` row within 24h of a scheduled run
- Changing `config.json` tickers and re-running gpw-fundamentals produces new company sections with no old ticker references

---

## What This Skill Does NOT Build

- Price charts or intraday price monitoring
- Buy / sell / hold recommendations
- Earnings calendar
- Performance vs. benchmark
- Trading or order execution
