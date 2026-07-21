# WIN-236 — IEHP 300 DPI scanned PDF mini-matrix handoff

- Date: July 21, 2026
- Linear: `WIN-236`
- Branch: `codex/win-236-iehp-300dpi-scan`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `.github/workflows/iehp-pdf-mini-matrix-proof.yml`, `scripts/lib/iehp-assessment-import-smoke.ts`, `scripts/playwright-iehp-assessment-import-smoke.ts`, and their focused tests
- Protected boundary: `.github/workflows/iehp-pdf-mini-matrix-proof.yml`; human review is required before merge

## Route-task Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- rationale: the new scan case widens the hosted PDF mini-matrix contract and therefore touches the protected owner-dispatched workflow and its curated evidence counts
- allowed files: the IEHP smoke helper, the IEHP Playwright smoke runner, the narrowest focused tests, the hosted matrix workflow contract, and this handoff
- stop conditions: any parser/OCR/server/API/Supabase/auth/runtime-config/migration/secret/production-data change

## Scope

- Add one deterministic synthetic `scan-300dpi-monochrome` PDF mini-matrix case.
- Generate that case at runtime as a 2550x3300 rasterized black-and-white JPEG-backed Letter PDF with no live data.
- Preserve existing assessor-phone snapshot precedence assertions, referral-date assertions, extracted status assertions, zero-draft assertions, and unconditional document/storage cleanup.
- Widen the hosted matrix workflow and workflow-contract test from four to five total cases so curated evidence stays exact.

## Non-goals

- No parser or OCR changes.
- No new extraction fields.
- No server/API/Supabase/auth/workflow-secret changes.
- No production data, PHI, or real phone numbers.
- No broad smoke-framework refactor.

## Test-first Evidence

- RED:
  - `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts` failed `4/26` because `IEHP_PDF_MINI_MATRIX_CASES` still had only three cases and no scan metadata.
  - `npm test -- tests/scripts/playwright-iehp-assessment-import-smoke.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts` failed the smoke structure assertion because the `raster-scan` generation branch was missing.
- GREEN:
  - `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts` passed `26/26`.
  - `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts` passed `29/29`.
  - `npm run test -- tests/scripts/playwright-iehp-assessment-import-smoke.test.ts` now passes the new scan-branch structure assertion; the only remaining failure in that file is the unchanged baseline `supabase/config.toml` expectation outside this slice.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type:
  - CI/workflow/policy
  - test harness / Playwright smoke runner
- required checks:
  - focused script/workflow tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - hosted `npm run playwright:iehp-assessment-import-pdf-mini-matrix` against the protected preview workflow
- executed checks:
  - `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts` -> pass (`26/26`)
  - `npm test -- tests/scripts/playwright-iehp-assessment-import-smoke.test.ts` -> fail on one unchanged baseline assertion in `selectConfiguredSmokeClient > keeps both CI IEHP proofs on the generated super-admin and unconditional cleanup path`; the new scan-branch structure assertion passed
  - `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts` -> pass (`29/29`)
  - `npm run ci:check-focused` -> pass; branch-protection, DB grant, and auth-parity probes skipped outside CI as reported by the command
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> fail outside this slice on:
    - `tests/ci/deploy-session-edge-bundle.test.ts` timeout
    - `src/lib/__tests__/ai-documentation.test.ts` fetch/null-text baseline
    - Vitest coverage temp-file `ENOENT` under `coverage/.tmp`
  - `npm run verify:local` -> fail at its `test:ci` stage on the same unrelated `deploy-session-edge-bundle`, `ai-documentation`, and coverage-temp-file failures; upstream policy, lint, and typecheck stages passed
- blocked checks:
  - local hosted smoke command -> blocked because `PW_BASE_URL`, `PW_SUPERADMIN_EMAIL`, `PW_SUPERADMIN_PASSWORD`, `PW_ASSESSMENT_CLIENT_ID`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are all missing from the current process
- result: `pass-with-blocked-checks`
- residual risk: local structure tests prove the new synthetic scan path and workflow contract, but only the hosted workflow can prove the current extraction stack actually handles the rasterized PDF end-to-end

## Review

- `code-review-engineer`: completed; no blocking findings. Noted only a low-severity maintainability follow-up to derive workflow case-count guards from `expectedCaseIds.length`.
- `test-engineer`: requested but did not return findings before interruption.
- `security-engineer`: requested but did not return findings before interruption.

## Current Hosted-verification Blocker

This local process has no Playwright or Supabase smoke credentials, so no local hosted smoke was run. The protected GitHub workflow still needs to be exercised from the PR head SHA after push.

## Next action

Push the branch, open the PR, dispatch the protected `iehp-pdf-mini-matrix-proof` workflow against the PR head SHA, and stop for human review if the hosted five-case proof fails or if the rasterized case shows the parser lacks existing OCR support.
