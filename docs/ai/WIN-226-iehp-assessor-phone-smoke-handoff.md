# WIN-226 IEHP Assessor Phone Smoke Handoff

## Scope And Route

- Linear: `WIN-226`
- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `scripts/playwright-iehp-assessment-import-smoke.ts`, `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`, `docs/ai/WIN-226-iehp-assessor-phone-smoke-handoff.md`
- Extended the existing smoke from status-only proof to authenticated checklist proof for `IEHP_FBA_ASSESSOR_PHONE` without changing parser, server, function, workflow, migration, secret, or production-data surfaces.

## Behavior

- Preflight derives the deterministic expected phone from the configured smoke client's primary therapist through the existing authenticated Supabase read path and fails before upload when the relationship or phone is absent.
- After `extracted`, the smoke calls `/api/assessment-checklist?assessment_document_id=...`, requires exactly one assessor-phone row, rejects missing/duplicate/empty/malformed values, and requires the value to match the snapshot phone after normalization.
- The preflight rejects malformed snapshot phones before upload, and the checklist fetch normalizes both supported app response shapes (raw row array or `{ items, structured_sections }`).
- JSON evidence reports row count, format result, precedence result, and redacted values only.
- Existing `extracted`, zero-draft, and fail-closed `finally` cleanup behavior remains intact.

## Test-First Evidence

- RED: focused Vitest run -> `4 failed, 4 passed`; failures proved the deterministic phone preflight and exported checklist assertion did not exist.
- GREEN: focused smoke test -> `13 passed`.
- Review-fix RED/GREEN: malformed snapshot phone -> `1 failed` then `14 passed`; dual checklist response normalization -> `2 failed` then `16 passed`.
- Final focused smoke, fixture, and cleanup suites -> `28 passed`.

## Verification Card

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type: non-sensitive test harness and docs
- Required checks:
  - focused script tests
  - `npm run playwright:iehp-assessment-import-smoke`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - focused script/cleanup suites -> pass after review fixes (`28 passed`)
  - `npm run ci:check-focused` -> pass; DB-backed and CI-only checks reported their local skips
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - final `npm run test:ci` rerun -> fail with the two known `origin/main` baseline failures: `src/lib/__tests__/supabase.edge.test.ts` blob `.text()` and `tests/ci/check-e2e-reliability-gates.test.ts` missing publishable-key workflow snippet; it also ended with an unrelated `coverage/.tmp/coverage-116.json` `ENOENT` rejection; the WIN-226 tests passed in the same run
  - `npm run verify:local` -> fail at `test:ci`; repeated the two baseline failures and also surfaced unrelated `ProgramsGoalsTab`, `SessionNotesTab`, and deploy-bundle test instability
- Blocked checks:
  - `npm run playwright:iehp-assessment-import-smoke` -> blocked because the required hosted smoke and Supabase credentials are not present in this process; no safe default synthetic IEHP DOCX exists in the repo root
- Result: `fail`; the bounded slice checks pass, but mandatory repository-wide verification remains red and hosted proof is blocked
- Residual risk: hosted RLS or smoke-fixture/client provisioning drift is not proven locally; CI must supply the existing safe synthetic fixture and configured smoke client before the new field assertion can execute end to end.

## Reviewer Findings

- `code-review-engineer` requested malformed expected-phone preflight validation and normalization of the checklist API's two supported response shapes.
- Both findings were fixed test-first and the final focused suites, policy, lint, typecheck, and build checks passed.

## PR Hygiene

- `pr-ready`: no; open as draft because mandatory repository-wide verification is red and hosted proof is blocked
- `branch-ready`: yes (`codex/win-226-iehp-assessor-phone-smoke`)
- `linear-ready`: yes (`WIN-226`)
- `single-purpose`: yes
- `unrelated changes`: generated untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` are excluded from the commit and PR
- `generated artifact drift`: none in the intended diff
- `protected-path drift`: none
- `reviewer`: completed; final verdict `approve`
- `required follow-up`: run the hosted IEHP smoke in credentialed CI and resolve or separately waive the known repository baseline failures before marking ready to merge
