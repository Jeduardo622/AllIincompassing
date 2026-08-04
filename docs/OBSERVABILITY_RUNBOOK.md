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

## Route telemetry and request correlation (2026-03)
- **Client route telemetry**: `src/App.tsx` emits `Route navigation event` logs on path/search/hash/navigation-type changes with user/role context.
- **Request correlation headers**: `src/lib/api.ts` attaches:
  - `x-request-id` (generated UUID when absent)
  - `x-correlation-id` (defaults to request id when absent)
- **Edge compatibility**: headers align with `_shared/logging.ts` correlation fields and can be joined with trace/report utilities in `/monitoring`.
- **Operational expectation**: route transitions and edge calls for critical flows should now share a diagnosable request/correlation chain.

## Agent trace pipeline
- **Trace store**: `public.agent_execution_traces` (admin/monitoring read-only via RLS).
- **Correlation IDs**: edge functions emit `x-request-id` and `x-correlation-id`; use these to join step-level traces across retries or fallbacks.
- **Ledger trace payloads**: Agent Work traces expose only allowlisted operational diagnostics and ledger IDs. Raw prompts, model output, source content, tool arguments, and replay payloads are not returned by the trace report.
- **Expected steps**: `request.received`, `execution.gate.allowed|denied`, `llm.response.received`, `tool.execution.allowed|blocked`, `response.sent`.

## Deterministic replay tooling
- **Replay script**: `npx tsx scripts/agent-replay.ts --packet-url http://127.0.0.1:54321/functions/v1/agent-trace-report --request-id <safe-id>`.
- **Auth**: pass a local operator JWT only through process variable `EDGE_REPLAY_ACCESS_TOKEN`. The packet URL must be loopback and must not contain credentials.
- **Behavior**: this is diagnostic reconstruction only. The CLI requests explicit `{ "mode": "replay" }`, validates one `agent-work-replay.v1` packet, and prints sanitized JSON. It has no seed, provider call, tool execution, mutation, or response-body logging path.
- **Limitation**: a selector that resolves to zero or multiple work items, lacks a step/attempt binding, or exceeds any bounded replay surface fails closed. Inspect the sanitized dashboard summary and narrow the selector instead of guessing.

## Agent trace report utility (Phase 5)
- **Edge function**: `agent-trace-report` (developer-facing replay/debug report).
- **Supported selectors**: `correlationId`, `requestId`, `agentOperationId`.
- **Aggregated sources**:
  - `public.agent_execution_traces`
  - `public.scheduling_orchestration_runs`
  - `public.session_audit_logs`
- **Ledger replay**: POST `{ "mode": "replay", "requestId": "<safe-id>" }` (or another supported selector). Replay loading is not part of ordinary trace reports. The function emits only selector-bound organization-scoped step/attempt rows and fails closed rather than returning a partial packet when any bounded surface is incomplete.
- **Operations mode**: POST `{ "mode": "operations" }` for `agent-work-operations.v1`. Every ledger query is organization-scoped and limited to 500 rows. When `sample.truncated` is true, `sample.releaseGateStatus` is `blocked_incomplete_sample` and every live release signal is unavailable rather than falsely green.
- **Output**: merged allowlisted timeline fields and sanitized per-source records for ordinary trace mode; explicitly sampled ledger metrics for operations mode; and inert selector-bound ledger packets only for replay mode.
- **AuthZ**: requires authenticated user with `admin`, `super_admin`, or `monitoring` role.
- **Monitoring UI**: `/monitoring` includes an **Agent Trace Replay** tab with operator-triggered sampled operations loading, fail-closed release gates, sanitized ID/reason-code drill-downs, and allowlisted timeline fields. It does not poll JSONB selectors.
- **Example query**:
  - `curl -X POST "$SUPABASE_URL/functions/v1/agent-trace-report" -H "Authorization: Bearer <admin_jwt>" -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"correlationId":"<id>"}'`

## Agent Work release gates and triage

- **Primary owner**: Platform/DevOps owns queue, lease, worker, scheduler, and function health.
- **Security owner**: Security/Privacy owns tenant, PHI-sanitizer, approval-authority, and replay-boundary incidents.
- **Clinical/product owner**: Clinical/Product owns unexplained IEHP parity and readiness-evidence findings; domain assessment tables remain authoritative.
- **Release-blocking thresholds**: cross-tenant access `0`; false completion `0`; unverified mutation effects `0`; PHI payload violations `0`; approval bypass/stale acceptance `0`; unknown transitions `0`; stale running beyond the sweeper SLO `0`; readiness evidence coverage `100%`.
- **First response**: stop local schedulers/workers, set ledger policy to `disabled`, preserve only sanitized IDs/reason codes and command output, drain or quarantine queue messages, and reconcile ledger projections against authoritative domain rows.
- **Replay triage**: use a single loopback selector and the inert packet CLI. Never re-execute a provider or tool from a packet.
- **Promotion boundary**: `active` is not authorized. Local and future reviewed operation is limited to `disabled`, `shadow`, or `advisory`; any proposal for bounded effects is a separate routed increment requiring human approval.

## Session flow trace propagation
- Agent-driven scheduling now propagates `x-request-id`, `x-correlation-id`, and `x-agent-operation-id` through:
  - `ai-agent-optimized` trace rows (`agent_execution_traces`)
  - `sessions-hold` / `sessions-confirm` / `sessions-cancel` orchestration inputs (`scheduling_orchestration_runs`)
  - session lifecycle audit payloads (`session_audit_logs`)
- This enables a single selector (`correlationId` or `agentOperationId`) to reconstruct the end-to-end scheduling execution chain.

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

### Automatic alerting (implemented)
- The CI policy entrypoint `npm run ci:check-focused` now runs via `scripts/ci/run-policy-checks.mjs`.
- On first policy-check failure in CI, the wrapper sends a Slack alert (when `SLACK_WEBHOOK_URL` is configured) with:
  - source: `ci:check-focused`
  - severity: `medium`
  - runbook: `docs/INCIDENT_RESPONSE.md`
- The same pipeline includes a startup canary (`scripts/ci/check-startup-canary.mjs`) to catch bootstrap import/export regressions early.

### Manual alerting
When CI or smoke failures occur outside the automated policy-check path, use the Slack notifier to route alerts to `#deployments`.

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
