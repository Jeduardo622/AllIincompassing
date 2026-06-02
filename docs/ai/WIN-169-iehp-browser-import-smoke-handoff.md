# WIN-169 IEHP Browser Import Smoke Handoff

## Scope

- Added an on-demand IEHP browser import smoke that selects the IEHP FBA upload template in the UI, uploads an explicitly configured IEHP DOCX fixture, waits for extraction, asserts zero draft programs/goals, captures a screenshot, and auto-cleans created assessment artifacts.
- Added helper coverage for safe sample-file resolution, synthetic upload naming, redacted cleanup manifests, and existing assessment-import cleanup behavior.
- Kept the smoke out of GitHub Actions workflows for this slice.

## Route Classification

- classification: low-risk autonomous
- lane: standard
- triggering paths: `scripts/**`, `tests/**`, `package.json`, `docs/ai/**`
- protected paths touched: none

## Verification Card

- `npm test -- tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/assessment-import-cleanup.test.ts` -> pass
- `npm run playwright:iehp-assessment-import-smoke` with an explicit authorized IEHP sample fixture -> pass; final status `extracted`, draft programs `0`, draft goals `0`
- `npm run ci:check-focused` -> pass; DB-backed checks skipped locally because database URLs were not configured
- `npm run lint` -> pass
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npm run verify:local` -> pass

## Residual Risk

- The IEHP smoke remains on-demand and credentialed; it is not part of CI.
- The smoke requires `PW_ASSESSMENT_SAMPLE_FILE` unless a root sample filename is clearly marked redacted, synthetic, smoke, or test.
- If cleanup fails after a hosted write, the local manifest is intentionally redacted; manual cleanup may require rerunning with terminal context or inspecting hosted smoke records.
