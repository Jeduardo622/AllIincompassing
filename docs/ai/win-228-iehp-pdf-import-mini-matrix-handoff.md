# WIN-228 IEHP PDF Import Mini Matrix Handoff

- Date: July 20, 2026
- Linear: WIN-228
- Branch: `codex/win-228-iehp-pdf-mini-matrix`
- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `scripts/playwright-iehp-assessment-import-smoke.ts`, `scripts/lib/iehp-assessment-import-smoke.ts`, `tests/scripts/**`, `package.json`, and supporting docs

## Scope

- IEHP-only, on-demand, three-case runtime-generated digital PDF matrix.
- Keep the work focused on IEHP import behavior and hosted evidence for the three confirmed cases:
  - clean-single-page
  - multi-page-target-content
  - alternate-document-phone-format
- Preserve the documented snapshot-precedence behavior and provenance reporting.

## Non-goals

- CalOptima is separate and out of scope.
- No scanned/OCR/rotation handling.
- No CalOptima certification or certification-like claims.
- No new auth, routing, tenant, schema, or deploy changes.

## Evidence Summary

- Task 1: RED with 12 failures, then GREEN with 43 passing.
- Reviewer follow-up on Task 1: RED with 1/43, then GREEN with 44 passing.
- Task 2: RED with structure failures, then GREEN with 44 passing.
- Reviewer follow-up on Task 2: RED with 2 failures, then GREEN with 46 passing.
- Final focused run: 2 files, 46 tests passed.

## Hosted Proof

- All three cases were clean.
- All statuses were extracted.
- Programs: 0.
- Goals: 0.
- Exactly one valid snapshot-precedence phone was present with `client_snapshot.primary_therapist_phone` provenance.
- The document-derived referral date was exact and carried provenance.
- Per-case cleanup was `true` for all three cases.
- Aggregate: 3 total cases, 3 passed cases, 3 cleanup-verified cases.
- Ephemeral smoke admin cleanup: `true`.

## Verification and Gates

- `ci:check-focused` PASS.
- `lint` PASS.
- `typecheck` PASS.
- `build` PASS.
- `test:ci` FAILED only on 2 unrelated baseline Windows failures:
  - `src/lib/__tests__/supabase.edge.test.ts` with `blob.text unavailable`
  - `tests/ci/check-e2e-reliability-gates.test.ts` missing the BCBA workflow `provisionStep` expectation
- `test:ci` summary:
  - 408 files passed
  - 3065 tests passed
  - 2 files failed
- Both failures were reproduced in focused runs.
- No baseline fixes were made.
- Local policy skips:
  - `SUPABASE_DB_URL`
  - branch-protection-dependent checks

## Operational Notes

- Initial attempts were blocked by a stale local credential and missing Chromium.
- The existing provisioner plus installed Chromium enabled the successful run.
- This slice remains digital-PDF only and does not cover scanned/OCR/rotation paths.

## Residual Risk

- IEHP-only coverage is complete for the requested mini matrix, but CalOptima remains separate.
- Local `test:ci` still has the two unrelated baseline Windows failures noted above.
- Live PR checks are pending.

## Self-Review

- Scope stayed within the WIN-228 IEHP PDF mini-matrix review-fix slice across the helper manifest/HTML, focused helper tests, and this handoff.
- No PHI, raw credentials, IDs, or raw phone values were added.
- The document-phone fixtures now use three distinct reserved `909-555-0101` to `0103` formats that pass the shared phone validator.
- The multi-page HTML now places the page break before both the referral date and assessor phone so the asserted content is constrained to page two.
- `verify-change` and `pr-hygiene` are still pending for the overall branch and are not claimed here.
