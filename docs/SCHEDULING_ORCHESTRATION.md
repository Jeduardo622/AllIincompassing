# Scheduling orchestration (holds, conflicts, reschedules)

## Purpose
Add a minimal, auditable delegation layer for scheduling workflows without changing core hold/confirm/cancel contracts.

## Delegation entrypoints
- `sessions-hold`: conflict responses include orchestration hints and alternative suggestions.
- `sessions-confirm`: conflict responses include orchestration hints and alternative suggestions.
- `sessions-cancel`: hold release responses include rollback guidance.

## Orchestration contract
Inputs are collected by edge functions and sent to the scheduling orchestrator:
- `workflow`: `hold | confirm | cancel | reschedule`
- `tenant`: `organizationId`
- `actor`: `actorId`, `actorRole`
- `request`: `therapistId`, `clientId`, `startTime`, `endTime`, `holdKey`, `sessionId`, `timeZone`, `idempotencyKey`
- `request`: `therapistId`, `clientId`, `startTime`, `endTime`, `holdKey`, `sessionId`, `timeZone`, `idempotencyKey`, `agentOperationId`
- `conflict`: `conflictCode`, `retryAfter`
- `delegation`: `executionMode` (`suggestion` only), `allowedTools` (AI allowlist)

Outputs (returned to callers via edge functions):
- `decision`: conflict + retry hints
- `alternatives`: AI-suggested actions (`suggest_optimal_times`)
- `authorization`: pass-through status from existing checks
- `rollbackPlan`: guidance to retry or re-acquire holds
- `orchestrationId`: audit record identifier

## Guardrails
- Tenant isolation enforced via `current_user_organization_id()`; if missing, orchestration is blocked.
- AI delegation is suggestion-only. No write actions are executed automatically.
- Allowlisted tools only: `predict_conflicts`, `suggest_optimal_times`.
- Kill switch: set `SCHEDULING_ORCHESTRATION_DISABLED=true` to skip delegation.

## Auditability
Every orchestration attempt is recorded in `scheduling_orchestration_runs` with:
- request/correlation IDs
- agent operation ID (when present)
- workflow, status, inputs, outputs, rollback plan
- organization scope

Related audit log propagation:
- `sessions-hold`, `sessions-confirm`, and `sessions-cancel` write `agentOperationId` plus nested trace IDs in `session_audit_logs.event_payload` for replay correlation.

## Rollback readiness
Orchestration always returns a `rollbackPlan` with the next safe step:
- `hold`/`confirm`: retry after `retryAfter` or use alternatives
- `cancel`: guidance to re-acquire a hold if cancellation was unintended

## Error handling
- Orchestration failures do not block core scheduling actions.
- Errors are returned as `orchestration.status = error` and logged in audit records.

## Operations
- Deploy edge functions: `sessions-hold`, `sessions-confirm`, `sessions-cancel`.
- Apply migration: `20260202120000_scheduling_orchestration_runs.sql`.
- Regenerate Supabase types after schema updates: `supabase gen types typescript --project-id wnnjeqheqxxyrgsjmygy --schema public > src/lib/generated/database.types.ts`.
