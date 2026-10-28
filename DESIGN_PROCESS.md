# Guided Portfolio Watch — Design Process

## Problem and Initial Persona

With limited user research available for this assignment, I started with a problem I knew from personal experience: most financial dashboards assume the reader already understands finance. My initial persona hypothesis was a first-time long-term investor — someone who bought a few equities, intends to hold 3–5 years, and has no financial background. This was a working assumption tested through limited early usability sessions, not a market-validated persona.

The problem worth solving: *show only what materially affects a long-term business case, in plain English, without requiring prior financial knowledge.*

## User Insight and Product Hypothesis

The core insight came from early usability testing. A prototype displaying accurate financial metrics — "revenue up 65%, net income up 64%" — failed to communicate anything meaningful to a non-expert tester. The numbers were correct; the context was absent.

This surfaced the hypothesis: **the right unit of information is not a metric; it is an explanation.** Every alert and insight card leads with *what happened*, follows with *why it matters*, and closes with *what to watch next* — with sources. In guided mode, metric labels read "Total sales," "Profit after costs," "Cash generated."

## Major Design Decisions

**No price data.** A beginner monitoring prices daily is likely to over-react and undermine a long-term strategy. The Skill covers material business-level changes only: earnings, regulatory decisions, strategic announcements, supply-chain shifts.

**Guidance inferred, not asked — with explicit decision boundaries.** Asking "are you a beginner?" is a friction point. Guidance mode is inferred from natural-language signals, overridable via AGENTS.md. Prompt instructions in `buildPreferencesNote()` direct the LLM to surface evidence, uncertainties, and questions rather than recommend buying, selling, or sizing positions. Alert formatting reinforces this; actual LLM output compliance is unverified.

**Evidence gate on alerts.** After the first production run, the selected finding had no external source URL. Alerts without at least one verifiable HTTPS citation are suppressed; source URL coverage is an open product question.

**Single config as source of truth.** Both feeds read from one `config.json` at runtime. Changing tickers produces a fully updated Playbook and alert pipeline with no code changes required.

## Skill Workflow and Testing

Setup is a 7-step agent workflow. `parseIntent()` maps input deterministically to a `MonitoringConfig` — no cloud calls until the user confirms.

404 tests cover intent parsing, YoY logic, Playbook rendering, reusability, alert pipeline, and the decision-support contract. 93 monitor-alert tests were added after a production run surfaced data-contract bugs and the source URL gap. One production run completed (110 events, 1 finding selected); alert generation failed due to a post-processing bug and was fixed. No end-to-end financial-event notification has been delivered.
