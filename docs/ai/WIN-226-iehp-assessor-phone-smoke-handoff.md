# WIN-226 IEHP Assessor Phone Smoke Handoff

## Scope And Route

- Linear: `WIN-226`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering path: `src/server/api/assessment-documents.ts` (`src/server/**` protected server/API boundary with a tenant-scoped therapist phone read)
- Bounded change: keep the field-level smoke assertion from the original slice and make the existing primary-therapist snapshot lookup use the request's authenticated anon-key/JWT headers, constrained by exact therapist ID and resolved organization ID.
- Non-goals retained: no parser, extraction-field, persistence, workflow, migration, Edge Function, secret, or production-data changes.
- Stop condition retained: do not edit `.github/workflows/**`; the hosted-preview proof gap is reported below.

## Behavior

- After `extracted`, the smoke calls `/api/assessment-checklist?assessment_document_id=...`, requires exactly one `IEHP_FBA_ASSESSOR_PHONE` row, and rejects missing, duplicate, empty, malformed, or precedence-mismatched values.
- Preflight derives the deterministic synthetic expected phone through the existing authenticated Supabase path. JSON evidence reports row count, format result, precedence result, and redacted values only.
- The server snapshot lookup now reuses the authenticated request headers for one exact `therapists` query filtered by both primary therapist ID and client organization ID. A denied, empty, or malformed response omits the snapshot phone; it never retries with service-role credentials.
- Existing `extracted`, zero-draft, and fail-closed `finally` cleanup behavior remains intact.

## Test-First Evidence

- Smoke RED: focused Vitest run -> `4 failed, 4 passed`; deterministic phone preflight and exported checklist assertion did not exist.
- Smoke GREEN and review fixes: `13 passed`, then malformed-phone RED/GREEN (`1 failed` -> `14 passed`) and response-shape RED/GREEN (`2 failed` -> `16 passed`).
- Server RED 1: the focused positive snapshot test failed because the lookup used the privileged runtime credential instead of anon key plus caller bearer token.
- Server RED 2: the new authenticated-403 test failed because the lookup retried with the synthetic service-role marker.
- Server GREEN: both focused regressions passed; final combined server/smoke/fixture/cleanup run passed `4 files, 86 tests`, including all `5` cleanup-helper tests.

## Verification Card

- Lane: `critical`
- Required checks: focused tests, `ci:check-focused`, lint, typecheck, `test:ci`, tenant validation, build, tier-0 browser, auth Playwright, `verify:local`, and hosted IEHP import smoke against the new commit.
- Executed passes:
  - focused server/smoke/fixture/cleanup suites -> `4 files, 86 tests passed`
  - `npm run ci:check-focused` -> pass; DB-backed checks skipped because no DB URL is configured locally
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
- Executed failures / blocked checks:
  - `npm run test:ci` -> `3042 passed, 5 skipped, 2 failed`; failures are outside WIN-226: session-notes PDF Blob `.text()` compatibility and a stale workflow-snippet assertion
  - `npm run verify:local` -> policy, lint, and typecheck passed, then it stopped at `test:ci`; it repeated the two baseline failures and surfaced unrelated schedule-test instability
  - `npm run test:routes:tier0` -> no pass claim: default port `4173` was occupied; alternate port `4174` timed out before Cypress completed
  - `npm run ci:playwright` -> not run because its credentials are absent from this process
  - local IEHP hosted smoke -> not run because its credentials and sample path are absent from this process
  - hosted preview proof -> pending after push; the current workflow IEHP job uses `secrets.PW_BASE_URL`, not the PR deploy-preview URL, so it cannot be attributed to the new server commit unless that URL is independently shown to serve the commit
- Result: `blocked` pending hosted deploy-preview field proof and human review.
- Residual risk: mocked PostgREST tests do not execute hosted RLS. The decisive proof remains a credentialed smoke against the deploy preview showing `extracted`, zero drafts, one non-empty valid assessor-phone row, snapshot precedence, and successful document/storage cleanup.

## Reviewer Findings

- Software architecture: authenticated request-scoped lookup only; exact therapist and organization filters; no service-role fallback.
- Security: approve; same-organization PII read is minimized and fails closed without privilege escalation.
- Supabase/tenant safety: pass; effective RLS permits the synthetic same-org actor and denies cross-org reads. Hosted RLS remains the integration proof.
- Test engineering: server cases are adequate after aligning the positive actor to the provisioned `super_admin`; require all five cleanup-helper tests and deploy-preview smoke evidence.
- Code review: no server correctness finding; required this critical reclassification and fresh handoff evidence before push.

## PR Hygiene

- `pr-ready`: no, pending hosted proof and human approval
- `branch-ready`: yes (`codex/win-226-iehp-assessor-phone-smoke`)
- `linear-ready`: yes (`WIN-226`)
- `single-purpose`: yes
- `unrelated changes`: untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain excluded
- `generated artifact drift`: none
- `protected-path drift`: declared and routed as `critical` (`src/server/**`)
- `required follow-up`: push the bounded fix, wait for the preview deployment of the new SHA, run the credentialed IEHP smoke against that preview without changing `.github/workflows/**`, and obtain required human review before merge.
