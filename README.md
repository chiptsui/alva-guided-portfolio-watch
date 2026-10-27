# Guided Portfolio Watch

A reusable Alva Skill for long-term investors who want plain-language monitoring of a custom set of publicly-traded companies — without requiring financial-analysis expertise.

**Published Playbook:** https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch (v1.0.3, public)

---

## Quick Links

| | |
|---|---|
| Published Playbook | https://alva.ai/u/c9jsd/playbooks/guided-portfolio-watch |
| Design Process | [DESIGN_PROCESS.md](DESIGN_PROCESS.md) |
| Skill definition | [.agents/skills/guided-portfolio-watch/SKILL.md](.agents/skills/guided-portfolio-watch/SKILL.md) |
| Run all tests | `node test/run-tests.js && node test/yoy-insights.test.js && node test/playbook-logic.test.js && node test/guided-narrative.test.js && node test/reusability.test.js && node test/monitor-alert.test.js` |

---

## Implementation Status

| Component | Status |
|---|---|
| Published Playbook (v1.0.3) | Live — financial statement data visible |
| Financial snapshot | From a manual feed run; daily refresh cronjob (40870) is paused |
| `gpw-monitor` corrected script | Deployed to ALFS 2026-10-26; cronjob (40871) paused |
| AI monitoring pipeline | Exercised once in production (110 events, 1 finding selected) |
| Financial-event notification | Not yet verified end-to-end — cronjobs remain intentionally paused |
| Alva web delivery infrastructure | Verified independently (`status=sent` via isolated test) |
| Local test suite | 348 tests, 0 failures |
| Reusability | Demonstrated via local alternate-ticker scenarios (MSFT/JPM/XOM); `HOME` path in Playbook template requires manual update for a different account |

---

## What This Skill Builds

For any user-provided portfolio of US-listed equities, the Skill produces:

1. **MonitoringConfig** — a structured JSON file written to ALFS, the single source of truth for tickers, horizon, guidance mode, and the LLM preferences note.
2. **Two feed automations** — `gpw-fundamentals` (financial history) and `gpw-monitor` (daily event analysis + push alerts), both reading config at runtime.
3. **One Playbook** — `guided-portfolio-watch`, live and publicly accessible.
4. **Push alerts** — explanation-first notifications when material events with verifiable sources occur.

The Skill is designed to be reusable: changing `config.json` tickers and re-running the feeds is intended to produce a complete, updated Playbook and alert pipeline for any new portfolio without code changes.

---

## Repository Structure

```
.agents/skills/guided-portfolio-watch/
    SKILL.md                    # Reusable Skill definition (7-step workflow)
    references/
        setup-workflow.md       # Deployment sequence reference
config/
    monitoring-config.schema.json   # MonitoringConfig JSON schema
src/
    intent-to-config.js         # NL → MonitoringConfig (zero platform dependencies)
    yoy-insights.js             # Year-over-year insight computation
    validate-config.js          # Config validation helper
    check-placeholders.js       # Template placeholder check
templates/
    gpw-fundamentals.stub.js    # Fundamentals feed script template
    gpw-monitor.stub.js         # Monitoring feed script (corrected, deployed 2026-10-26)
    gpw-playbook.stub.html      # Playbook HTML template
    agents-md.stub.md           # AGENTS.md template for user preferences
test/
    run-tests.js                # Intent fixture tests (14)
    yoy-insights.test.js        # YoY insight unit tests (78)
    playbook-logic.test.js      # Playbook rendering regression (77)
    guided-narrative.test.js    # Guided mode correctness (47)
    reusability.test.js         # Alternate-ticker reusability (39)
    monitor-alert.test.js       # Alert pipeline logic (93)
    fixtures/                   # Test inputs and expected outputs
scripts/
    gpw-alert-test.js           # Isolated delivery test (evidence artifact)
DESIGN_PROCESS.md               # One-page design process (PM-facing)
SKILL_CONTRACT.md               # Engineering contract: input schema, output contract, AC tests
SUBMISSION.md                   # Take-home submission (concise)
SUBMISSION_DETAIL.md            # Full evidence record
DESIGN_RATIONALE.md             # Supporting design reference
```

---

## Running the Tests

No Alva account or cloud credentials are required. Tests run against local fixtures with bare Node.js.

```bash
node test/run-tests.js           # 14 intent parsing tests
node test/yoy-insights.test.js   # 78 YoY insight unit tests
node test/playbook-logic.test.js # 77 Playbook rendering tests
node test/guided-narrative.test.js # 47 guided narrative tests
node test/reusability.test.js    # 39 reusability tests
node test/monitor-alert.test.js  # 93 alert pipeline tests
# Total: 348 tests, 0 failures
```

---

## Financial Data

The Playbook displays financial statement data from a stored snapshot, not a live feed:

- NVDA: latest annual figures through FY2026
- TSLA: latest annual figures through FY2025
- AAPL: latest annual figures through FY2025

Each section is labelled with its exact reporting period and filing date. Quarterly income data in the source database is from 2023 and is displayed only in the expanded history section with its period date — not presented as the latest quarter.

The snapshot was loaded by a single manual run of the `gpw-fundamentals` feed. Daily automated refresh requires the cronjob (40870) to be unpaused.

---

## Configuration

Both feeds read from a single canonical config:

```json
{
  "version": "1.0.0",
  "tickers": ["NVDA", "TSLA", "AAPL"],
  "holdings": { "NVDA": "watchlist", "TSLA": "watchlist", "AAPL": "watchlist" },
  "horizon": "long-term",
  "guidanceMode": "guided",
  "preferencesNote": "..."
}
```

The `preferencesNote` field is assembled deterministically by `src/intent-to-config.js` from the other config fields. It becomes the `portfolioWatchPreferencesNote` passed to `@alva/portfolio-watch`, directing the LLM's framing for the user's guidance preference.

---

## Data Access Model

This Playbook uses Alva's bundled-feed PBSV access model. The fundamentals feed (ID 36243) is bundled privately with the Playbook. Playbook viewers receive a scoped token granting read access to the bundled feed's data — the feed itself remains private and is not publicly readable via the API.

---

## Disclaimers

For informational purposes only. Does not constitute investment advice. Holding/watchlist status labels reflect user-supplied configuration, not verified brokerage positions. Portfolio quantities, cost bases, total wealth, and risk tolerance are not known to this system. Financial statement data may lag recent announcements.
