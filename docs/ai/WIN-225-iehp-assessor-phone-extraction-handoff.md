# WIN-225 IEHP Assessor Phone Extraction Handoff

- Date: July 19, 2026
- Linear: WIN-225
- Branch: `codex/win-157-iehp-assessor-phone-extraction`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `supabase/functions/extract-assessment-fields/index.ts`, `supabase/functions/extract-assessment-fields/index.test.ts`

## Scope

- Implement the next bounded IEHP FBA upload parsing slice for `IEHP_FBA_ASSESSOR_PHONE`.
- Keep the change contained to the existing extractor plus source-of-truth docs for this field.
- Preserve existing snapshot-prefill behavior from `client_snapshot.primary_therapist_phone`.

## Non-goals

- No auth, routing, tenant-boundary, migration, or deploy changes.
- No broad phone-label extraction outside the assessor identification block.
- No changes to unrelated baseline CI failures.

## Delegated Agents

- `specification-engineer`: confirmed parser-only containment was safe once the defect was reproduced.
- `software-architect`: recommended a key-scoped IEHP helper rather than broad generic phone matching.
- `test-engineer`: confirmed the critical-lane verification set.
- `security-engineer`: confirmed tenant and service-role boundaries should remain unchanged.
- `code-review-engineer`: initially requested changes for regex false positives and doc drift; later confirmed the two GitHub review fixes are functionally correct and identified only generated lockfile drift plus stale verification evidence, both corrected before handoff.

## Change Summary

- Added an IEHP-specific assessor-phone extractor that accepts generic `Phone Number` / `Phone` labels only inside the assessor identification block.
- Tightened the IEHP matcher to reject malformed bare/overlong digit runs.
- Added focused parser tests for valid anchored labels, missing values, malformed values, numeric false positives, and unrelated nearby numbers.
- Aligned markdown and generated IEHP mapping artifacts to the actual staged-source behavior: snapshot prefill first, then assessor-anchored document extraction.
- Addressed PR review feedback by evaluating `client_snapshot.primary_therapist_phone` before the document fallback and routing rejected assessor-phone values directly to `not_started` instead of generic label extraction.
- Added regression coverage for snapshot-versus-document precedence and malformed values under the exact `Assessor's phone number` label.

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type:
  - `server/API/edge integration`
  - `database/RLS/migrations/tenant isolation`
  - `docs/process only`
- Required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts` -> pass after review fixes on July 19, 2026 (`42 passed, 0 failed`)
  - `.\node_modules\.bin\vitest.cmd run src\server\__tests__\assessmentDocumentsHandler.test.ts -t "passes client primary therapist phone into IEHP extraction snapshot for assessor phone prefill"` -> pass on July 19, 2026
  - `npm.cmd run ci:check-focused` -> pass after review fixes on July 19, 2026; DB-backed and CI-only checks skipped because `SUPABASE_DB_URL` and branch-protection context are unavailable locally
  - `npm.cmd run lint` -> pass after review fixes on July 19, 2026
  - `npm.cmd run typecheck` -> pass after review fixes on July 19, 2026
  - `npm.cmd run validate:tenant` -> pass after review fixes on July 19, 2026
  - `npm.cmd run build` -> pass after review fixes on July 19, 2026
  - `npm.cmd run test:ci` -> fail after review fixes on July 19, 2026; the 2 known unrelated baseline failures recurred and 4 `ProgramsGoalsTab` cases failed during a Vitest worker timeout
  - `.\node_modules\.bin\vitest.cmd run src\components\__tests__\ProgramsGoalsTab.test.tsx` -> pass after the full-run timeout on July 19, 2026 (`98 passed, 0 failed`), confirming the 4 additional failures were full-suite contention
  - `npm.cmd run verify:local` -> fail on July 19, 2026 because it inherits the same 2 baseline failures from `npm run test:ci`
- Blocked checks:
  - `none`
- Result: `fail`
- Residual risk: the bounded IEHP slice and the transiently failing UI suite verify cleanly in isolation, but repository-wide local verification remains red on the two pre-existing baseline failures in `src/lib/__tests__/supabase.edge.test.ts` and `tests/ci/check-e2e-reliability-gates.test.ts`.

## PR Hygiene

- `pr-ready`: yes
- `lane`: `critical`
- `branch-ready`: yes
- `linear-ready`: yes
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: `supabase/functions/extract-assessment-fields/index.ts`
- `change summary`: present
- `verification summary`: present
- `pr handoff`: ready
- `reviewer`: completed
- `required follow-up`:
  - push the two review fixes
  - reply to and resolve both addressed PR review threads
  - report the two existing baseline failures separately from the passing targeted slice

## Known Baseline Failures

- `src/lib/__tests__/supabase.edge.test.ts` -> `downloads blob from async download endpoint` fails with `TypeError: blob.text is not a function`
- `tests/ci/check-e2e-reliability-gates.test.ts` -> `synthetic BCBA provisioning keeps authenticated preflight and unconditional cleanup contracts` fails because the expected `SUPABASE_PUBLISHABLE_KEY` workflow snippet is missing
