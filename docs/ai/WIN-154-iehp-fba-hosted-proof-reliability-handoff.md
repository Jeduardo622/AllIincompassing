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
- Keep semantic Adobe job failures distinct from HTTP failures by leaving `upstream_status` null when the HTTP response itself succeeded.
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
