# WIN-237 IEHP 2-Degree Rotation Handoff

- Date: July 21, 2026
- Linear: `WIN-237`
- Branch: `codex/win-237-iehp-2deg-rotation`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Trigger: `.github/workflows/iehp-pdf-mini-matrix-proof.yml`

## Scope

- Add one deterministic synthetic `scan-300dpi-monochrome-rotated-2deg` case.
- Keep the existing 300 DPI, monochrome threshold, JPEG quality 85, image-only PDF, authenticated assertions, zero-draft checks, and unconditional cleanup.
- Rotate the raster source content exactly 2 degrees before the monochrome screenshot.
- Raise the ordered hosted evidence contract from five to six cases.

## Non-goals and Stop Conditions

- No parser, OCR, extraction-field, server/API, Supabase, migration, auth, secret, production-data, or additional degradation changes.
- Stop if hosted extraction cannot pass without widening into one of those surfaces.

## Test-First Evidence

- RED 1: three fixture-contract failures, one missing rotation-consumption failure, and one missing six-case workflow-contract failure.
- GREEN 1: helper/workflow tests passed (`30/30`); focused runner structure test passed (`1/1`).
- Review RED 2: the first contiguous synthetic phone format was not covered by the workflow raw-phone leak detector (`3` expected fixture failures after changing the test contract).
- GREEN 2: the case now uses accepted spaced synthetic format `909 555 0105`; helper tests passed (`27/27`) and the existing raw-phone guard can detect an accidental leak.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: browser smoke harness plus protected workflow evidence contract
- required checks: focused tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`; hosted immutable preview proof
- executed checks:
  - focused helper/workflow tests -> pass (`30/30`)
  - focused runner structure test -> pass (`1/1`)
  - second-cycle helper tests -> pass (`27/27`)
  - `npm run ci:check-focused` -> pass; environment-dependent probes skipped as reported
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> four unrelated baseline failures: Windows CRLF config assertion, Windows `Blob.text()` behavior, missing synthetic BCBA workflow contract, and stale BT/ABA branch contract
  - `npm run verify:local` -> policy, lint, and typecheck passed; stopped at the same four aggregate baseline failures
  - hosted workflow run `29889945690` -> immutable head/deployment checks passed; smoke emitted `6/6` passing cases with `6/6` cleanup verification
  - rotated case -> `extracted`, zero drafts, one valid snapshot-precedence phone row with `client_snapshot.primary_therapist_phone` provenance, one matching referral-date row with document provenance, cleanup verified
- blocked checks:
  - GitHub `workflow_dispatch` used the default-branch five-case finalizer and rejected the valid six-case artifact; this PR updates and locally tests that finalizer at six
- result: `pass-with-blocked-checks`
- residual risk: hosted Adobe extraction and cleanup are proven; the promoted six-case finalizer can only execute after this workflow definition reaches the default branch

## Review

- Specification and architecture reviews confirmed the harness-only boundary and stop conditions.
- Code and security/deployment reviews approved with no required fixes and no auth, tenant, secret, PHI, redaction, or cleanup regression.
- Human review is required before merge.
