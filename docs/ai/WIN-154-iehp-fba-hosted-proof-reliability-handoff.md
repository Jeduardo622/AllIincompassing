# WIN-154 IEHP FBA Hosted Proof Reliability Handoff

- Date: August 13, 2026
- Linear: `WIN-154`
- Branch: `codex/win-154-fba-hosted-proof-reliability`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `src/server/**` and `.github/workflows/**`

## Hosted Failure Evidence

- Owner-dispatched run: `31673104385`
- Validated PR: `#940`
- Validated SHA: `14cfc686ec453632fc2dcd873933dc8cfe9ac249`
- Immutable PR-head and Netlify preview validation: passed.
- Passed cases with cleanup: the first five canonical matrix cases through `scan-300dpi-monochrome-rotated-2deg`.
- Runtime failure: `scan-150dpi-grayscale-low-quality` reached `extraction_failed` because the background extraction workflow aborted at its 55-second application deadline.
- Coverage shortfall: fail-fast execution skipped `table-structured-fields` and `skills-behaviors-proof`; the finalizer found five of eight evidence objects.
- Cleanup failure: the workflow sourced but did not export `PW_SUPERADMIN_USER_ID` before invoking the cleanup child process.
- Public artifact boundary: upload succeeded with only redacted `run-status.json`; no private log, screenshot, or raw phone evidence was published.

## Routed Scope

- Increase the application extraction deadline to five minutes while keeping a separate explicit ten-minute stale-claim threshold.
- Increase the IEHP smoke polling deadline beyond the application extraction deadline.
- Continue after case-local matrix failures, emit sanitized failure evidence, and exit nonzero after all cases have run.
- Export the existing private smoke-admin identity into the cleanup child process.
- Preserve sanitized partial case and aggregate evidence on failed runs without weakening the exact `8/8/8/1` success gate.

## Implemented Slice

- Raised the application extraction deadline from 55 seconds to five minutes and kept stale-claim recovery as a separate explicit ten-minute boundary.
- Raised the hosted smoke polling ceiling to six minutes and made matrix execution continue across case-local failures before returning a nonzero result.
- Extracted evidence finalization into a testable fail-closed module that emits canonical sanitized partial evidence on failed runs and strictly enforces the exact success contract on successful runs.
- Extended the proof job budget to 75 minutes so all eight bounded case attempts, cleanup, and finalization can complete.
- Corrected cleanup environment propagation by parsing only the allowlisted smoke-admin email and user ID; the generated password line is never sourced or exported to the cleanup child.

## Initial Slice Non-Goals And Stop Conditions

- No parser or Adobe extraction implementation changes.
- No Supabase function, schema, migration, RLS, grant, auth, runtime-config, or Netlify configuration changes.
- No secret changes, `.env*` reads, customer documents, PHI, raw OCR output, screenshots, or private logs in public artifacts.
- Stop and re-route if the hosted rerun proves the low-quality case fails for extraction quality rather than the bounded runtime deadline.

## Verification Card

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Change type: server/API and CI/workflow.
- Required: `npm ci`; focused server, smoke-runner, finalizer, and workflow tests; workflow YAML parse; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run verify:local`; exact-head owner-dispatched hosted proof.
- Executed: `npm ci` passed; `npx vitest run src/server/__tests__/assessmentDocumentsHandler.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts tests/scripts/finalize-iehp-pdf-mini-matrix-evidence.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts` passed 126/126; `npm run ci:check-focused` passed; `npm run lint` passed; `npm run typecheck` passed; `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` passed 4,290 tests with five skipped; `npm run ci:verify-coverage` passed at 92.81% line coverage; `npm run build` passed; `npm run test:routes:tier0` passed 220/220; `git diff --check` passed.
- Wrapper diagnostics: the default-heap `npm run test:ci` attempt exhausted the 4 GB Node heap. Two later 8 GB `npm run verify:local` attempts passed policy, lint, and typecheck but stopped in their repeated full-suite phase on unrelated contention: one Schedule batch/worker timeout and one asynchronous AppNavigation assertion. The isolated Schedule suite passed 18/18 and the isolated AppNavigation suite passed 31/31. The earlier standalone 8 GB full suite remains green.
- Blocked at the initial handoff capture: the branch had not yet been pushed. Draft PR `#941` now tracks this branch; the Adobe diagnostic follow-up below requires a new exact-head CI/deployment/proof cycle.
- Result: `pass-with-blocked-checks` for the bounded slice; not merge-ready until fresh required CI and the exact-head hosted proof pass.
- Residual risk: only the hosted Adobe-backed rerun can prove that the five-minute budget is sufficient and all eight evidence objects pass cleanup and redaction gates.

## Specialist Reviews

- Specification, architecture, implementation, test, performance, deploy/CI, code, and security review roles completed.
- Code review found no implementation correctness defect; its stale-handoff blocker is resolved by this update.
- Security review identified blanket cleanup auto-export and whole-file sourcing as excessive. The workflow now parses only the allowlisted cleanup identity fields, and its test whitelists the exact cleanup environment while rejecting source-based or password export.

## PR Hygiene

- Branch-ready: yes; dedicated `codex/` branch.
- Linear-ready: yes; linked to `WIN-154`, status `In Review`.
- Single-purpose: yes; one hosted FBA proof-reliability slice.
- Unrelated changes: none.
- Generated artifact drift: none.
- Protected-path drift: none beyond the declared critical-lane workflow and server surfaces.
- PR handoff: draft PR `#941` exists and remains intentionally unmerged.
- PR-ready: no; the diagnostic follow-up requires refreshed review, exact-head checks, reviewed function deployment, and owner-dispatched hosted proof.

## Adobe Failure Diagnostic Follow-up

### Fresh Route And Evidence

- Date: August 13, 2026.
- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Triggering paths: `supabase/functions/extract-assessment-fields/**` and `src/server/**`.
- Failed exact-head hosted run: `31715024657` on SHA `5d617b7355c9aaade24dddc15915722c10e8c5e6`; all eight synthetic cases reached `extract-assessment-fields` version 122 and failed with HTTP 502.
- Adobe Developer Console showed the PDF Services entitlement, OAuth server-to-server credential, connected product profile, and same-day service activity as active. Adobe Insights has a 24-hour delay and showed historical successful responses only.
- Adobe usage report showed 103 Extract PDF document transactions, below the 500-transaction monthly free-tier allowance; quota exhaustion is not supported by the evidence.
- Supabase hosted logs exposed request-level 502 records only, not a sanitized Adobe operation stage. The prior function mapped token, asset, upload, submission, polling, and result failures to the same public code.

### Bounded Scope

- Add a fixed Adobe failure-stage vocabulary and optional numeric upstream HTTP status.
- Normalize transport, response-body, result-download, and ZIP-parse exceptions into the same sanitized Adobe error boundary.
- At this stage, semantic Adobe job failures left `upstream_status` null when the HTTP response itself succeeded because Adobe's structured semantic status had not yet been evaluated. The `PR #968 Semantic Poll Status Recovery` section below explicitly supersedes that historical behavior with an integer-only `body.error.status` contract.
- Return only `stage` and `upstream_status` alongside the existing generic Edge Function error/code.
- Persist only allowlisted `adobe_stage` and `adobe_upstream_status` fields in the existing tenant-scoped extraction-failure review event so the hosted proof can identify the failing provider boundary.
- Discard unknown stage names and invalid HTTP status ranges at the server boundary while preserving the generic extraction failure.

Non-goals remain credential rotation, secret access, parser behavior changes, schema/RLS/grant changes, workflow behavior changes, production deployment, or merge. No provider response body, token, signed URL, credential value, document text, screenshot, or PHI may enter the response or audit event.

### Verification Card

- Required: focused Edge Function and server tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local` when supported; exact-head CI; exact-head hosted synthetic proof after reviewed deployment.
- Red-green evidence: token HTTP status and transport-stage tests failed before implementation; server audit propagation failed before implementation; all passed after the bounded changes.
- Executed: `npm ci` passed; complete `extract-assessment-fields` Deno matrix passed 76/76; `assessmentDocumentsHandler.test.ts` passed 61/61; `deno check` for the Edge Function entrypoint passed; `deno fmt --check` passed for the new Adobe helper and test changes (the legacy entrypoint is not globally Deno-formatted, so its narrow seven-line hunk was reviewed without reformatting unrelated code); `npm run ci:check-focused` passed with its documented credential-dependent skips; `npm run lint` passed; `npm run typecheck` passed; `npm run validate:tenant` passed; `npm run build` passed; `git diff --check` passed.
- Aggregate verification: the final 8 GB `npm run verify:local` passed in 416.5 seconds, including `npm run test:ci`, coverage verification at 92.81% lines, build, and the Tier-0 browser gate at 220/220. An earlier full-suite attempt hit a Vitest worker timeout in `ProgramsGoalsTab`; that isolated suite passed 116/116, and the final aggregate run cleared the failure.
- Blocked checks: exact-head CI, reviewed Supabase Edge Function deployment, and the exact-head hosted synthetic matrix require the pushed commit plus the critical-lane human review/deployment action.
- Result: `pass-with-blocked-checks`; all required local gates pass, while exact-head CI, reviewed deployment, and hosted proof remain required.
- Residual risk: the diagnostic slice identifies the failing Adobe boundary but does not itself repair a stale secret or Adobe upstream rejection. Any credential rotation remains a separate protected owner action after the stage/status evidence proves it is necessary.

### Follow-up Specialist Reviews

- Code review: approved with no actionable correctness, compatibility, or scope-drift finding.
- Security review: approved; provider body, tokens, URLs, document content, and PHI remain outside the public and persisted diagnostic boundary.
- Supabase review: the initial request for explicit malformed-diagnostic behavior was resolved by the pure sanitizer and negative coverage; no migration, RLS, grant, auth, or tenant-scope change was found.
- Test review: no functional defect found; the focused and aggregate verification package is complete locally, with hosted gates explicitly blocked.

### Follow-up PR Hygiene Verdict

- `pr-ready`: yes for critical-lane human review; not merge-ready.
- `lane`: `critical`.
- `branch-ready`: yes; dedicated `codex/win-154-fba-hosted-proof-reliability` branch.
- `linear-ready`: yes; linked `WIN-154` remains `In Review`.
- `single-purpose`: yes; the diff only adds sanitized Adobe failure-stage observability for the existing FBA workflow.
- `unrelated changes`: none.
- `generated artifact drift`: none; timestamp-only local test-report drift was excluded.
- `protected-path drift`: none beyond the declared Edge Function and server/API surfaces.
- `change summary`: present.
- `verification summary`: present with required, executed, blocked, result, and residual-risk fields.
- `pr handoff`: draft PR `#941`; exact-head CI, human review, reviewed function deployment, and hosted matrix proof remain required.
- `reviewer`: code, security, test, architecture, specification, implementation, and Supabase reviews completed.
- `required follow-up`: push the exact head, require CI success, obtain critical-lane owner review, deploy the reviewed Edge Function, then rerun the eight-case hosted synthetic matrix before merge confirmation.

## Post-Merge Hosted Proof Target

- PR `#941` was owner-merged at `dc62f5ec32d0143b992d0f8cd51ab2214265e0b5` after exact-head required CI and specialist review passed.
- Production `extract-assessment-fields` is active at version `123`; direct source inspection confirms `AdobePdfExtractStage`, `toPublicDiagnostics`, and `upstream_status` are deployed.
- The protected mini-matrix workflow requires an open same-repository PR targeting `main`, so merged PR `#941` cannot be used as its immutable Netlify preview target.
- This docs-only follow-up exists solely to provide that fresh open target. It changes no parser, application, workflow, Supabase, auth, secret, runtime, or deployment behavior.
- Keep the follow-up PR open until the repository owner dispatches `.github/workflows/iehp-pdf-mini-matrix-proof.yml` against its exact head and Codex validates the curated redacted artifact contract at `8/8/8/1`.

## PR #966 Adobe Failure Evidence Recovery

- Date: August 16, 2026.
- Blocking PR: `#966` at SHA `528417c2c3b181559eef5384ed78fb2835c4d017`.
- Blocking run: `31991229911`, attempt 2.
- Live result: all required jobs except `iehp-assessment-import-smoke` passed; the IEHP job failed after the default DOCX case succeeded and the synthetic Skills and Behaviors PDF reached `extraction_failed`; `ci-gate` failed only because of that job.
- Repeated hosted evidence: production `extract-assessment-fields` returned two HTTP 502 responses for each failed PDF attempt, consistent with the existing single retry, but request logs did not expose the already-sanitized Adobe stage and upstream status.

### Fresh Route And Scope

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Branch: `codex/win-154-adobe-failure-evidence`.
- Linear: `WIN-154`.
- Allowed files: `scripts/playwright-iehp-assessment-import-smoke.ts`, its focused test, and this handoff.
- The smoke may read only the latest same-organization `assessment_review_events` row for the exact assessment document and `extraction_failed` action before cleanup.
- Public failure output is restricted to allowlisted `adobe_stage` and integer `adobe_upstream_status`; raw event payloads, provider bodies, tokens, URLs, document text, and PHI remain excluded.
- Non-goals: no production server, Edge Function, workflow, migration, RLS, grant, secret, retry-policy, parser, or cleanup changes; no weakening of the IEHP or aggregate CI gates.
- Stop conditions: any need for broader tenant access, a new privileged API, secret rotation, raw provider content, or production-path changes before exact stage evidence is available.

### Verification State

- Red test: the focused smoke suite passed 60 existing tests and failed only the two new diagnostic assertions because the helper was not yet implemented.
- Required local checks: focused smoke tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, `npm run verify:local`, and `git diff --check`.
- Required hosted checks: exact-head CI plus the secret-backed IEHP smoke against the immutable preview.
- Green focused result: `npx vitest run tests/scripts/playwright-iehp-assessment-import-smoke.test.ts --reporter=dot --pool=forks --maxWorkers=1 --minWorkers=1` passed 66/66, including the 200-with-empty-event retry before cleanup.
- Passed standalone gates: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run build`, and `git diff --check`.
- Aggregate result: two isolated 8 GB `npm run verify:local` attempts completed all 550 runnable test files and all 4,974 runnable tests with no assertion failures, then Vitest reported the same unhandled worker RPC timeout calling `onTaskUpdate`; both attempts exited 1, so aggregate verification is blocked rather than passed. The policy checks, lint, typecheck, tenant validation, and build were also run separately and passed.
- Specialist result: code, test, security, and Supabase reviews approved the bounded implementation after raw extraction-error output was removed, deterministic latest-event ordering and transient query retry were added, and malformed diagnostic values were covered.
- Current result: `pass-with-blocked-checks`; focused and standalone local gates pass, while the aggregate harness timeout and exact-head hosted checks remain explicit blockers. No merge or hosted deployment is authorized by this handoff.
- Residual risk: the evidence query depends on the caller-visible tenant-scoped audit row being committed before cleanup. The bounded retries reduce event-write lag risk; an unavailable row remains fail-safe and emits no provider content, but it cannot identify the Adobe boundary until exact-head CI runs.

## PR #968 Semantic Poll Status Recovery

- Exact-head diagnostic run: `31998175206` at SHA `d28174a97ef3bea231ab8b5e34ef7a8d8d0f87d5`.
- Live result: every substantive job passed except `iehp-assessment-import-smoke`; the synthetic Skills and Behaviors PDF failed with `adobe_stage=job_poll adobe_upstream_status=not_reported`, and `ci-gate` failed only because of that job.
- Interpretation: token, asset creation, upload, submission, poll transport, and result download were not the failing boundary. Adobe returned a successful poll response whose job status was semantic `failed`.
- Adobe SDK contract: the official Node SDK models semantic job failures as a structured error with `code`, `message`, and numeric `status`, and throws its service error from those fields. The prior HTTP-only interpretation of `upstream_status` is superseded for this bounded follow-up.

### Fresh Route And Scope

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Allowed production file: `supabase/functions/extract-assessment-fields/adobe-pdf-extract.ts`.
- Allowed test file: `supabase/functions/extract-assessment-fields/adobe-pdf-extract.test.ts`.
- The semantic `failed` branch may propagate only `body.error.status` when it is an integer from 100 through 599, using the existing `upstream_status` channel.
- Adobe error code, message, raw response body, token, signed URL, document text, screenshot, and PHI remain discarded.
- Non-goals: no server, smoke, schema, RLS, grant, workflow, retry, parser, cleanup, credential, secret, or deployment change.
- Stop conditions: any need for a new diagnostic field, raw provider content, authority widening, retry behavior, or additional protected surface.

### Verification State

- Red result: the new semantic failure test expected sanitized upstream status `422` and received `null` before implementation.
- Green Edge Function result: the repository CI command for the complete `extract-assessment-fields` Deno matrix passed 78/78 with `--no-lock --node-modules-dir=none`; `deno check` passed for the entrypoint and `deno fmt --check` passed for the touched helper and test.
- Boundary coverage: valid statuses `100`, `422`, and `599` propagate; absent, null, primitive, string, decimal, below-range, above-range, and missing `error.status` values remain `null`. Provider code and message are absent from the internal generic message and public diagnostics.
- Passed repo gates: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run build`, and `git diff --check`.
- Aggregate result: `npm run test:ci` completed all 550 runnable files and 4,975 runnable tests with no assertion failures, then Vitest emitted the same worker RPC timeout calling `onTaskUpdate` seen in two prior isolated `verify:local` attempts; the command exited 1. `npm run verify:local` is blocked by that reproducible first-stage harness failure rather than reported as passed.
- Result: `pass-with-blocked-checks`; exact-head CI in GitHub's clean worker environment and critical-lane human review remain required.
- Hosted blocker: production cannot expose the structured semantic status until the critical-lane PR is owner-reviewed, merged, and the reviewed `extract-assessment-fields` function is separately deployed. No deployment is authorized by this handoff.
- Required post-deploy proof: confirm the deployed function version matches the owner-reviewed merge, rerun the hosted synthetic Skills and Behaviors PDF smoke, and verify the same tenant-scoped review event contains only `adobe_stage=job_poll` plus an allowlisted numeric `adobe_upstream_status`, with no Adobe code, message, or raw provider payload.

### Offline QA Follow-up

- Date: August 17, 2026.
- Docker verification: the pinned `denoland/deno:2.8.3` container passed the complete extractor matrix 78/78. The local Supabase Edge Runtime loaded `extract-assessment-fields`, preserved the function-level `auth.getUser()` check, and returned the expected `400 Invalid request body` for a synthetic authenticated schema-validation request. The synthetic user was deleted and the worktree remained clean before this follow-up.
- Clinical QA preflight: correctly failed closed without reading `.env` files because no redacted browser credentials, route/client target, source expectations, or generated-output capture input were configured. Browser clinical parity therefore remains blocked rather than passed.
- QA agent findings: code, test, debugging, Supabase, and security reviewers found no parser, auth, tenant, RLS, SSRF, or semantic-status defect. One security reviewer requested a narrower diagnostics read because the smoke selected the full `event_payload` before client-side sanitization.
- Red-green remediation: the focused smoke tests failed when they required a flat allowlisted projection while production still returned nested `event_payload`. The query now projects only `adobe_stage:event_payload->>adobe_stage` and `adobe_upstream_status:event_payload->adobe_upstream_status`; the response parser consumes only those projected fields and retains the existing allowlist/range sanitizers.
- Projection proof: the exact projected query returned HTTP 200 against local PostgREST, and the focused smoke suite passed 66/66 after the correction. The Adobe helper suite passed 22/22, the server extraction-failure persistence slice passed 3/3, `npm run lint` passed, `npm run typecheck` passed, and `git diff --check` passed.
- Aggregate follow-up: the default 4 GB `npm run test:ci` attempt exhausted the Node heap. The exact CI-memory retry (`NODE_OPTIONS=--max-old-space-size=8192`) completed 550 files and 4,975 tests without an assertion failure, then exited 1 on the known Vitest worker RPC timeout calling `onTaskUpdate`. Its complete coverage artifact passed `npm run ci:verify-coverage` at 92.96% line coverage against the required 86.00%; the aggregate command remains blocked rather than reported as passed.
- Security re-review: approved with no findings. Caller JWT use and the existing assessment-document, organization, action, deterministic ordering, and bounded retry filters remain unchanged; service-role access was not introduced.
- Residual hosted risk: the real Adobe terminal response shape, hosted review-event commit visibility, deployed RLS/grant drift, and exact-head function behavior still require the reviewed hosted smoke. Local QA cannot substitute for those checks.

### Canonical PR Consolidation

- Date: August 17, 2026.
- PR #966 is now the user-authorized canonical review vehicle for both WIN-219 and this WIN-154 slice. Merge commit `947f61ccd110711bd958e804c9ade0894621a624` preserves PR #968 head `b75d99aef78188bedb80de5063a6d4a87c1eb2a1` as an exact parent and introduces no additional WIN-154 production change.
- The combined route is `high-risk human-reviewed`, lane `critical`, because the union touches migration, Edge Function, CI workflow, and CI-policy surfaces.
- The earlier WIN-154-only verification remains valid for its files. Combined-head verification additionally passed the 307-test focused union, Deno 78/78, policy, lint, typecheck, tenant validation, build, diff check, and 92.96% coverage threshold. The 8 GB aggregate completed 551 files and 4,983 tests without an assertion failure before the known Vitest `onTaskUpdate` RPC timeout exited 1.
- PR #968 is superseded only after the combined PR #966 remote head proves both original heads and the exact 13-file union. Closing #968 does not authorize merge, migration apply, function deployment, payroll activation, or any required-check bypass.
- The hosted Adobe failure-evidence blocker is unchanged: owner-reviewed deployment and a fresh hosted Skills and Behaviors smoke remain required before the diagnostics can be treated as production-proven.
