# WIN-226 IEHP Assessor Phone Smoke Handoff

## Scope And Route

- Linear: `WIN-226`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `src/server/api/assessment-documents.ts` from the earlier correction and `.github/workflows/ci.yml` for the review/CI follow-up.
- Bounded follow-up: prove persisted snapshot provenance and make the IEHP PR job exercise the current Netlify deploy preview on trusted same-repository PRs.
- Non-goals retained: no parser, extraction-field, persistence, migration, Edge Function, fixture/provisioner, secret-value, credential, or production-data changes.
- Stop condition: do not add privileged query fallbacks or widen into RLS/server/function/deploy orchestration if the hosted authenticated provenance read is denied.

## Behavior

- After `extracted`, the smoke calls `/api/assessment-checklist?assessment_document_id=...`, requires exactly one `IEHP_FBA_ASSESSOR_PHONE` row, and rejects missing, duplicate, empty, malformed, or precedence-mismatched values.
- Preflight derives the deterministic synthetic expected phone through the existing authenticated Supabase path. JSON evidence reports row count, format result, precedence result, and redacted values only.
- The server snapshot lookup now reuses the authenticated request headers for one exact `therapists` query filtered by both primary therapist ID and client organization ID. A denied, empty, or malformed response omits the snapshot phone; it never retries with service-role credentials.
- Existing `extracted`, zero-draft, and fail-closed `finally` cleanup behavior remains intact.
- The smoke now reads only `field_key,source_span` from `assessment_extractions` with the anon key plus generated user JWT, filters the exact document, field, and organization, limits the response to two rows, and requires exactly one `client_snapshot.primary_therapist_phone` provenance record.
- PR CI now targets `https://deploy-preview-{PR_NUMBER}--velvety-cendol-dae4d6.netlify.app`; non-PR runs retain `secrets.PW_BASE_URL`. Fork PRs do not receive this secret-backed IEHP job, and `pull_request_target` is not used.

## Test-First Evidence

- Smoke RED: focused Vitest run -> `4 failed, 4 passed`; deterministic phone preflight and exported checklist assertion did not exist.
- Smoke GREEN and review fixes: `13 passed`, then malformed-phone RED/GREEN (`1 failed` -> `14 passed`) and response-shape RED/GREEN (`2 failed` -> `16 passed`).
- Server RED 1: the focused positive snapshot test failed because the lookup used the privileged runtime credential instead of anon key plus caller bearer token.
- Server RED 2: the new authenticated-403 test failed because the lookup retried with the synthetic service-role marker.
- Server GREEN: both focused regressions passed; final combined server/smoke/fixture/cleanup run passed `4 files, 86 tests`, including all `5` cleanup-helper tests.
- Review follow-up RED: `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts` ran `19` tests with `5` expected failures for preview targeting, provenance evidence, missing provenance, duplicate provenance, and document-derived false precedence.
- Review follow-up GREEN: the focused suite passed `24/24` after adding fail-closed organization scope and malformed-provenance cases; the combined smoke/fixture/provision/cleanup suites passed `45/45`.

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
  - review follow-up focused suite -> `24/24` passed
  - related smoke/fixture/provision/cleanup suites -> `45/45` passed
- Executed failures / blocked checks:
  - review follow-up `npm run test:ci` -> `3045 passed, 5 skipped, 2 failed`; failures are outside WIN-226: session-notes PDF Blob `.text()` compatibility and the stale BCBA workflow-snippet assertion
  - review follow-up `npm run verify:local` -> policy, lint, and typecheck passed, then it stopped at `test:ci`; it repeated the stale BCBA workflow and Blob `.text()` baseline failures and surfaced the known unrelated `ProgramsGoalsTab` instability
  - `npm run test:routes:tier0` -> no pass claim: default port `4173` was occupied; alternate port `4174` timed out before Cypress completed
  - `npm run ci:playwright` -> not run because its credentials are absent from this process
  - local IEHP hosted smoke -> not run because its credentials and sample path are absent from this process
  - Netlify deploy preview -> pass for head `264e9023` at `https://deploy-preview-821--velvety-cendol-dae4d6.netlify.app`
  - prior hosted CI IEHP smoke -> failed in run `29693503346`, job `88210644586`: the secret-backed long-lived target returned one empty assessor-phone row; cleanup still passed
  - current deploy-preview field proof -> pass on commit `1e9fe92b`, run `29696674281`, job `88218578256`: `extracted`, zero draft programs/goals, exactly one non-empty valid matching phone, `provenanceVerified: true`, `client_snapshot.primary_therapist_phone`, and matching redacted values
  - cleanup proof -> pass in the same job: the smoke completed document/storage cleanup, unconditional synthetic-admin cleanup deleted the run-scoped account, and evidence/artifact upload passed
- Result: bounded local and hosted field-level proof pass; critical-lane human review is still required before merge.
- Residual risk: mocked PostgREST tests do not execute hosted RLS. The decisive proof remains a credentialed smoke against the deploy preview showing `extracted`, zero drafts, one non-empty valid assessor-phone row, snapshot precedence, and successful document/storage cleanup.

## Reviewer Findings

- Software architecture: authenticated request-scoped lookup only; exact therapist and organization filters; no service-role fallback.
- Security: approve; same-organization PII read is minimized and fails closed without privilege escalation.
- Supabase/tenant safety: pass; effective RLS permits the synthetic same-org actor and denies cross-org reads. Hosted RLS remains the integration proof.
- Test engineering: server cases are adequate after aligning the positive actor to the provisioned `super_admin`; require all five cleanup-helper tests and deploy-preview smoke evidence.
- Code review: no server correctness finding; required this critical reclassification and fresh handoff evidence before push.
- Codex PR review: accepted; checklist value equality alone could not establish snapshot precedence, so persisted `source_span` is now required.
- Workflow/security review: credentialed preview execution is restricted to same-repository PRs; service-role credentials remain confined to provisioning and unconditional admin cleanup.

## PR Hygiene

- `pr-ready`: yes for human review; merge remains blocked on required human approval and any still-running required checks
- `branch-ready`: yes (`codex/win-226-iehp-assessor-phone-smoke`)
- `linear-ready`: yes (`WIN-226`)
- `single-purpose`: yes
- `unrelated changes`: untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain excluded
- `generated artifact drift`: none
- `protected-path drift`: declared and routed as `critical` (`src/server/**` and the bounded IEHP block in `.github/workflows/ci.yml`)
- `required follow-up`: obtain required human review, wait for the remaining live PR checks, and merge only if branch protection allows it.
