# Priority 4 Rollout Evidence Bundle

## Objective

Capture the minimum evidence needed to promote Priority 4 hardening changes through staging and production without relaxing latency/error budgets.

## Required artifacts

- `artifacts/latest/evidence/tier0-browser.json`
- `artifacts/latest/evidence/auth-browser-smoke.json`
- `artifacts/latest/evidence/rollback-drill.json`
- `artifacts/latest/rollback-drill/report.json`
- `reports/p4-query-plan-evidence.md`

## Latency and error budget contract

Track these endpoints before and after rollout:

- `/api/book`
- `/api/dashboard`
- schedule reads (batch RPC path / fallback path)

Suggested acceptance gates:

- p95 latency regression <= 10% versus prior release window.
- HTTP 5xx rate does not increase above 0.5% for each endpoint.
- 409 conflict behavior remains stable with `Retry-After` headers present on conflict/rate-limit paths.

## Execution flow

1. Deploy to staging with Priority 4 migrations and workflow updates.
2. Run smoke gates (`test:routes:tier0`, `playwright:auth`, `playwright:session-lifecycle`).
3. Run rollback drill workflow and confirm evidence artifacts are uploaded.
4. Compare endpoint latency/error budgets against prior release.
5. Attach the final evidence list to release approval and `docs/OPS_READINESS.md` checklist.

## Deferred item tracking

If any requirement is deferred, document:

- owner
- mitigation window
- explicit rollback impact
- follow-up ticket ID
