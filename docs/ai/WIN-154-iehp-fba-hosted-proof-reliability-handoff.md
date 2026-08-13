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

## Non-Goals And Stop Conditions

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
- Blocked: at this handoff-card capture, this exact uncommitted branch head has no open PR; commit, push, and opening a draft PR on `codex/win-154-fba-hosted-proof-reliability` are the first required steps. Fresh hosted proof then requires that draft's exact immutable Netlify deploy preview, protected credentials, and a separate repository-owner dispatch. PR `#940` is on a different branch and cannot validate this diff.
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
- PR handoff: pending commit, push, and opening the exact-head draft PR for this branch.
- PR-ready: no; after the draft exists, its live checks and the owner-dispatched exact-head hosted proof remain required before merge readiness.
