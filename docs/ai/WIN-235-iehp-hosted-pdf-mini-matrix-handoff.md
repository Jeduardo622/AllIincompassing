# WIN-235 — Hosted IEHP PDF mini-matrix handoff

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: add an owner-dispatched GitHub workflow, its narrow contract test, and this handoff. Existing IEHP runner, parser, fixture, API, Supabase, and CI aggregate behavior remain unchanged.
- Protected boundary: `.github/workflows/iehp-pdf-mini-matrix-proof.yml`; human review is required before merge.

## Execution contract

The workflow accepts only an open same-repository PR targeting `main`, an exact lowercase 40-character head SHA, and the exact approval acknowledgement. It derives the Netlify deploy-preview alias from the validated PR number, polls the exact commit SHA for both the successful alias status and its unique Netlify deploy check, derives the immutable deploy-ID URL, and verifies that immutable URL is reachable before provisioning the synthetic admin or running Playwright.

The existing `playwright:iehp-assessment-import-pdf-mini-matrix` command remains responsible for four synthetic cases, field/provenance assertions, zero-draft assertions, and per-upload document/storage cleanup. The workflow always runs synthetic-admin cleanup, disables cancellation between runs, and uploads only curated JSON under the runner temporary directory; private credentials, raw logs, screenshots, and `artifacts/latest` are excluded.

## Verification card

- Required checks: focused workflow contract; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`; hosted owner-dispatched proof.
- Executed checks:
  - focused workflow contract: RED confirmed with missing-workflow `ENOENT`; subsequent RED cases caught reserved `GITHUB_ENV` use, unexported provisioned credentials, insufficient preview-readiness handling, and use of the mutable PR preview alias; GREEN passed, 3/3 tests.
  - `npm run ci:check-focused`: passed.
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm run test:ci`: failed twice outside this diff; the first run ended on a missing Vitest coverage temp file, and the serial rerun also reported the pre-existing `blob.text is not a function` failure in `src/lib/__tests__/supabase.edge.test.ts` plus a missing coverage temp file.
  - `npm run verify:local`: failed at its `test:ci` stage on the same unrelated `blob.text is not a function` test and Vitest coverage-temp ENOENT; its preceding policy, lint, and typecheck stages passed.
- Hosted proof:
  - GitHub Actions run `29858404231` passed against PR #828 SHA `04a52cb422d3482475f5aaaa7d9b4e113a8da5a7` and its exact Netlify deploy-preview URL.
  - Redacted evidence reported 4/4 extracted cases, 4/4 zero-draft checks, 4/4 assessor-phone snapshot-precedence/provenance checks, 1/1 Skills & Behaviors reconciliation check, and 4/4 cleanup checks.
  - Synthetic-admin cleanup, evidence finalization, and the curated JSON artifact upload all passed.
- Result: `pass` for the hosted workflow proof; required human review remains outstanding because this is a critical-lane workflow change.
- Residual risk: hard runner termination can bypass in-process upload cleanup, although normal assertion failures remain covered by the runner's unconditional cleanup path. The hosted proof uses synthetic test data and does not extend to OCR or real-world document degradation.

## Next action

After required human review, merge the workflow infrastructure. The next bounded slice should add one synthetic degraded-PDF case at a time, beginning with a deterministic 300-DPI scan while preserving the same exact-SHA hosted evidence and cleanup contract.
