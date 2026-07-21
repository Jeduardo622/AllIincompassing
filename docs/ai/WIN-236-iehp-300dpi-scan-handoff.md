# WIN-236 IEHP 300 DPI Scan Handoff

- Date: July 21, 2026
- Linear: `WIN-236`
- Branch: `codex/win-236-iehp-300dpi-scan`
- PR: `#830` (`https://github.com/Jeduardo622/AllIincompassing/pull/830`)
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Trigger: the hosted proof's exact evidence contract changes under `.github/workflows/**`
- Required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`

## Scope

- Add one deterministic synthetic `scan-300dpi-monochrome` case to the on-demand IEHP PDF mini-matrix.
- Render a 2550 x 3300 black-on-white source image with light JPEG compression and embed only that image in a straight Letter PDF.
- Reuse the existing authenticated upload, extracted-status, zero-draft, checklist/provenance assertions, per-document cleanup, and synthetic-admin cleanup.
- Require five ordered, redacted, cleanup-verified hosted evidence objects: four PDF cases plus the existing Skills & Behaviors proof.

## Non-goals and Stop Conditions

- No parser, OCR, extraction-field, server/API, Supabase function, migration, auth, secret, or production-data changes.
- If the hosted extractor cannot process the image-only PDF, stop with that limitation; do not widen this slice into parser/OCR work.

## Test-first Evidence

- RED: focused tests failed on the missing fourth case, missing raster generation path, and the workflow's four-case evidence contract (`6` slice-specific failures).
- GREEN: helper/workflow tests passed (`29/29`); runner structure tests passed (`6/6`); `npm run typecheck` passed.
- Hosted follow-up RED: run `29876647651` reached the scan case and failed before upload with `page.evaluate: ReferenceError: __name is not defined`; a focused regression then failed on the nested helper that `tsx` serialized into the browser context.
- Hosted follow-up GREEN: the browser callback now uses `HTMLImageElement.decode()` without a nested transpiled helper; runner structure tests passed (`6/6`) and typecheck passed before the immutable rerun.
- Hosted extraction GREEN: workflow run `29877347962` validated implementation commit `83af7083`, bound the exact Netlify deployment, and completed all five smoke cases. The new scan case reached `extracted`, retained zero drafts, matched the synthetic referral date and snapshot-precedence assessor phone with document/client-snapshot provenance, and verified document plus storage cleanup.
- The full runner test file also exposes an unchanged Windows line-ending baseline assertion in `supabase/config.toml`; the narrowed changed-surface runner tests are green.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: browser smoke harness plus CI/workflow evidence contract
- required checks: focused tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`; owner-approved hosted IEHP PDF mini-matrix workflow
- executed checks:
  - focused helper/workflow tests -> pass (`29/29`)
  - focused runner structure tests -> pass (`6/6`)
  - `npm run ci:check-focused` -> pass; environment-dependent database and branch-protection probes skipped as reported
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - isolated `npm run test:ci` -> `3134` pass / `2` unrelated baseline failures: Windows `Blob.text()` behavior and the missing BCBA workflow provision-step expectation
  - focused rerun of an earlier load-sensitive deployment-bundle timeout -> pass (`1/1`)
  - `npm run verify:local` -> policy, lint, and typecheck passed; stopped at the same aggregate baseline boundary before coverage/build/tier-0 continuation
  - hosted workflow run `29877347962` -> immutable head and deployment checks passed; smoke command emitted `5/5` passing cases with `5/5` cleanup verification, including `scan-300dpi-monochrome`
- blocked checks:
  - the workflow run's finalizer used the default-branch four-case definition and rejected the otherwise valid five-case artifact (`Expected exactly four case evidence objects but found 5`); the PR changes and focused workflow test update that contract to five, so a post-merge dispatch is required to exercise the promoted finalizer
- result: `pass-with-blocked-checks`
- residual risk: hosted extraction and cleanup are proven, but GitHub cannot exercise the PR version of a `workflow_dispatch` finalizer before that workflow definition reaches the default branch

## Protected-path Review

- The workflow change only adds the new ordered case ID and raises exact case/aggregate guards from four to five.
- Triggers, immutable PR-head validation, Netlify deployment binding, secret names, private environment handling, redaction, and unconditional cleanup are unchanged.
- `code-review-engineer`, `security-engineer`, and deployment review found no required changes; the optional follow-up is a stronger artifact-shape unit assertion.
- Human review is required before merge.
