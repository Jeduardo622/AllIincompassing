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

## Agent trace pipeline
- **Trace store**: `public.agent_execution_traces` (admin/monitoring read-only via RLS).
- **Correlation IDs**: edge functions emit `x-request-id` and `x-correlation-id`; use these to join step-level traces across retries or fallbacks.
- **Replay hooks**: traces capture sanitized inputs + tool call payloads in `replay_payload` for controlled replays.
- **Expected steps**: `request.received`, `execution.gate.allowed|denied`, `llm.response.received`, `tool.execution.allowed|blocked`, `response.sent`.

## Deterministic replay tooling
- **Replay script**: `npx tsx scripts/agent-replay.ts --correlation-id <id> --seed <int>`
- **Auth**: requires `EDGE_REPLAY_ACCESS_TOKEN` (admin JWT), plus `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
- **Seeded runs**: pass `--seed` to re-run with a fixed LLM seed (logged in trace payloads).

## Error taxonomy + retry policy
- **Taxonomy table**: `public.error_taxonomy` defines error `code`, `category`, `severity`, `retryable`, and `http_status`.
- **Edge responses**: `{ requestId, code, message, classification }` where `classification` mirrors taxonomy.
- **Retry policy**:
  - Retryable: `rate_limited`, `upstream_timeout`, `upstream_unavailable`, `upstream_error`
  - Non-retryable: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `internal_error`
  - Backoff: exponential with jitter, capped at 2s for frontend edge calls; 3 attempts for upstream (OpenAI) calls.
- **Query**:
  - `select * from error_taxonomy order by severity desc;`

## Slack alerting (webhook-only)
- Required env: `SLACK_WEBHOOK_URL`
- Optional env: `SLACK_ALERTS_CHANNEL` (defaults to `#deployments`)
- Manual notify:
  - `npm run alert:slack -- --title "Smoke failure" --text "preview:smoke failed" --severity high --source "preview:smoke" --runbook docs/INCIDENT_RESPONSE.md`
- Verification:
  - `npm run alert:slack:test`

## Severity mapping
Map alert severity to incident severity tiers (see `docs/INCIDENT_RESPONSE.md`):
- **`high`** → SEV1 (production outage, data integrity issues) - immediate response
- **`medium`** → SEV2 (major degradation, auth failures) - respond within 30 minutes
- **`low`** → SEV3 (localized degradation) - respond within 4 hours

## CI and smoke alerts

### Automatic alerting (recommended)
Add Slack alert steps to CI workflows using `if: failure()` conditions. Example:

```yaml
- name: Alert on smoke failure
  if: failure() && github.ref == 'refs/heads/main'
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: |
    npm run alert:slack -- \
      --title "Production smoke test failed" \
      --text "Preview smoke test failed on ${{ github.ref }}. Check workflow: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
      --severity high \
      --source "ci:preview:smoke" \
      --runbook docs/INCIDENT_RESPONSE.md
```

### Manual alerting
When CI or smoke failures occur, use the Slack notifier to route alerts to `#deployments`. This is designed to be called from CI workflows or manual triage sessions.

### Alert frequency and throttling
- **Production failures** (main branch): Always alert immediately
- **Staging failures** (develop branch): Alert on first failure; suppress duplicates within 1 hour
- **Preview/PR failures**: Alert only if blocking merge or affecting multiple PRs
- Use `--dry-run` flag to test alert formatting without sending: `npm run alert:slack -- --dry-run --title "Test" --text "Test message"`

## Escalation procedures
1. **Initial alert**: Sent to `#deployments` with severity level
2. **No acknowledgment within SLA**: Escalate by:
   - Tagging Platform/DevOps team members in Slack
   - Creating a GitHub issue with `incident` label
   - For SEV1: Consider paging on-call engineer (if PagerDuty configured)
3. **Escalation criteria**:
   - SEV1: No response within 15 minutes
   - SEV2: No response within 30 minutes
   - SEV3: No response within 2 hours

## Runbook links
- Incident response: `docs/INCIDENT_RESPONSE.md`
- Staging operations: `docs/STAGING_OPERATIONS.md`
- Preview smoke: `docs/PREVIEW_SMOKE.md`
