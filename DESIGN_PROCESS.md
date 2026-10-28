# Guided Portfolio Watch — Design Process

*Charlie Tsui · 2026-10-27*

---

## Problem

I started from a problem I know firsthand: as a newer long-term investor, I couldn't tell which financial news actually mattered for the businesses I owned. Headlines were either too shallow or assumed knowledge I didn't have.

The target user is a first-time long-term investor — someone who owns a few equities, plans to hold for years, and lacks the background to filter signal from noise. The problem worth solving: **surface only what materially affects a long-term business case, in plain English, without requiring financial expertise.**

## What I Learned from Testing

I tested an early prototype with a real user. The dashboard showed accurate financials — "revenue up 65%, net income up 64%." The user couldn't interpret what it meant for their portfolio. The numbers were correct; the context was missing.

This led to the core hypothesis: **the right unit of information is not a metric — it is an explanation.** Every insight card should answer *what happened*, *why it matters for a long-term holder*, and *what to watch next*. In plain-English mode, "revenue" becomes "total sales" and "net income" becomes "profit after costs."

## Design Decisions

**Business events, not price movements.** Daily price monitoring encourages short-term reactions and works against a long-term strategy. This product covers only material business-level changes: earnings surprises, regulatory decisions, strategic announcements, and supply-chain shifts with multi-year impact.

**Adaptive guidance, never prescriptive.** Communication style adapts to the user's signals — plain English for beginners, standard terminology for experienced investors — without ever asking "are you a beginner?" The system surfaces evidence and relevant uncertainties; investment decisions stay with the user.

**Source traceability on every alert.** After the first production AI run, the selected finding had no external source URL — only internal metadata. An alert without a verifiable citation undermines trust. Findings without at least one public HTTPS source are suppressed before delivery.

**One config, any portfolio.** Both feeds read from a single `config.json` at runtime. Swapping tickers produces a fully updated Playbook and alert pipeline without code changes — the core reusability property.

## Workflow and Validation

Setup follows a 7-step agent workflow. Free-text user input is parsed into a structured `MonitoringConfig` with no cloud calls until the user confirms.

404 local tests cover intent parsing, financial logic, Playbook rendering, reusability, and alert pipeline correctness. A live production run processed 110 AI-analyzed events and selected one finding. A post-processing bug prevented alert delivery — it was fixed and redeployed. Full financial-event notification delivery remains unverified; production cronjobs are paused pending authorization.
