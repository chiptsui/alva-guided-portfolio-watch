# GPW Feed Deployment Workflow

Called from SKILL.md Step 5. Do not deploy until the user has confirmed the MonitoringConfig is correct.

## Pre-deploy Checklist

- [ ] `alva fs read --path '~/feeds/gpw-monitor/v1/config.json'` returns the correct tickers, guidanceMode, and holdings.
- [ ] User has explicitly approved the config in the conversation.

## Deploy Feed 1 — gpw-fundamentals

```bash
alva deploy create \
  --name gpw-fundamentals \
  --path ~/feeds/gpw-fundamentals/v1/src/index.js \
  --cron "15 6 * * *"
```

Trigger once manually to populate the initial snapshot:
```bash
alva deploy run --id <cronjob-id>
alva deploy run-logs --id <cronjob-id>
```

Verify snapshot written:
```bash
alva fs read --path '~/feeds/gpw-fundamentals/v1/data/fundamentals/snapshot/@last/1'
```

## Deploy Feed 2 — gpw-monitor

```bash
alva deploy create \
  --name gpw-monitor \
  --path ~/feeds/gpw-monitor/v1/src/index.js \
  --cron "30 6 * * *" \
  --push-notify
```

> **Note:** gpw-monitor requires the `@alva/portfolio-watch` entitlement. If not active on the account, the feed will fail at the module-resolve step. The Playbook will show "Monitoring temporarily unavailable" until this is resolved.

## After Both Feeds Are Running

Run the config patch to embed guidanceMode and holdings into the fundamentals snapshot:
```bash
alva run --local-file ./scripts/patch-snapshot-monctx.js
```

Then proceed to SKILL.md Step 6 to build and release the Playbook.
