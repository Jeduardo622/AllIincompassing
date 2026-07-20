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
- Final pre-PR-review focused run: 2 files, 48 tests passed.
- Codex PR review follow-up: RED with 2 focused failures, then GREEN with 49 passing.

## Hosted Proof

- All three cases were clean.
- The final hosted rerun used three distinct accepted synthetic document-phone formats, all different from the snapshot phone.
- The multi-page case placed both asserted fields after the page break.
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
- `verify:local` ran and stopped at the same two `test:ci` failures after its policy, lint, and typecheck stages passed.
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
- No PHI, raw credentials, customer IDs, or real phone values were added.
- The document-phone fixtures now use three distinct reserved `909-555-0101` to `0103` formats that pass the shared phone validator.
- The multi-page HTML now renders deterministic page-one content before the forced break and places both asserted fields after it.
- The precedence ambiguity guard now canonicalizes equivalent 10-digit and `+1` US phone formats before comparison.
- `verify-change` and `pr-hygiene` were executed; the slice is reviewable, while local full-suite status remains red only on the two documented unrelated Windows baselines.
