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
- `code-review-engineer`: initially requested changes for regex false positives and doc drift; re-review requested after follow-up fixes.

## Change Summary

- Added an IEHP-specific assessor-phone extractor that accepts generic `Phone Number` / `Phone` labels only inside the assessor identification block.
- Tightened the IEHP matcher to reject malformed bare/overlong digit runs.
- Added focused parser tests for valid anchored labels, missing values, malformed values, numeric false positives, and unrelated nearby numbers.
- Aligned markdown and generated IEHP mapping artifacts to the actual staged-source behavior: snapshot prefill first, then assessor-anchored document extraction.

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
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts` -> pass on July 19, 2026 (`40 passed, 0 failed`)
  - `.\node_modules\.bin\vitest.cmd run src\server\__tests__\assessmentDocumentsHandler.test.ts -t "passes client primary therapist phone into IEHP extraction snapshot for assessor phone prefill"` -> pass on July 19, 2026
  - `node scripts/ci/run-policy-checks.mjs` -> pass on July 19, 2026
  - `node node_modules/eslint/bin/eslint.js . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` -> pass on July 19, 2026
  - `.\node_modules\.bin\tsc.cmd -p tsconfig.json --noEmit` -> pass on July 19, 2026
  - `.\node_modules\.bin\tsx.cmd scripts\check-tenant-safety.ts` -> pass on July 19, 2026
  - `.\node_modules\.bin\vite.cmd build` -> pass on July 19, 2026
  - `.\node_modules\.bin\vitest.cmd run --coverage --run --reporter=verbose --coverage.reporter=json-summary` -> fail on July 19, 2026 with 2 unrelated baseline failures
  - `npm.cmd run verify:local` -> fail on July 19, 2026 because it inherits the same 2 baseline failures from `npm run test:ci`
- Blocked checks:
  - `none`
- Result: `fail`
- Residual risk: the bounded IEHP slice verifies cleanly in targeted coverage and non-test gates, but the branch is not merge-ready until the pre-existing repo baseline failures in `src/lib/__tests__/supabase.edge.test.ts` and `tests/ci/check-e2e-reliability-gates.test.ts` are resolved or waived.

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
  - push branch
  - open PR linked to WIN-225
  - report the two existing baseline failures as live merge blockers

## Known Baseline Failures

- `src/lib/__tests__/supabase.edge.test.ts` -> `downloads blob from async download endpoint` fails with `TypeError: blob.text is not a function`
- `tests/ci/check-e2e-reliability-gates.test.ts` -> `synthetic BCBA provisioning keeps authenticated preflight and unconditional cleanup contracts` fails because the expected `SUPABASE_PUBLISHABLE_KEY` workflow snippet is missing
