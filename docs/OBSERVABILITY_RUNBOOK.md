# Observability Runbook

## Scope
This runbook defines production monitoring signals, initial SLO thresholds, and the alert delivery path (Slack webhook). It is the source of truth for observability ownership and verification.

## Ownership
- **Primary owner**: Platform/DevOps
- **Monitoring dashboard**: `/monitoring` (MonitoringDashboard UI)
- **Compliance dashboard artifact**: `docs/analytics/compliance-dashboard.md`
- **Slack channel**: `#deployments` (configurable via `SLACK_ALERTS_CHANNEL`)

## Alert sources and signals
1. **API latency**
   - Signal: Route render time in compliance dashboard artifacts.
   - Threshold (initial): average render time <= 2000ms.
2. **API error rate**
   - Signal: CI route audit success rate, smoke logs.
   - Threshold (initial): success rate >= 99%.
3. **Auth failures**
   - Signal: preview smoke auth health + Supabase auth health endpoint.
   - Threshold (initial): auth health must be OK in smoke run.
4. **DB performance**
   - Signal: `npm run db:check:performance` advisory output.
   - Threshold (initial): no critical advisories; slow query warnings tracked weekly.

## Slack alerting (webhook-only)
- Required env: `SLACK_WEBHOOK_URL`
- Optional env: `SLACK_ALERTS_CHANNEL` (defaults to `#deployments`)
- Manual notify:
  - `npm run alert:slack -- --title "Smoke failure" --text "preview:smoke failed" --severity high --source "preview:smoke" --runbook docs/INCIDENT_RESPONSE.md`
- Verification:
  - `npm run alert:slack:test`

## CI and smoke alerts (manual wiring)
When CI or smoke failures occur, use the Slack notifier to route alerts to `#deployments`. This is designed to be called from CI workflows or manual triage sessions.

## Runbook links
- Incident response: `docs/INCIDENT_RESPONSE.md`
- Staging operations: `docs/STAGING_OPERATIONS.md`
- Preview smoke: `docs/PREVIEW_SMOKE.md`
