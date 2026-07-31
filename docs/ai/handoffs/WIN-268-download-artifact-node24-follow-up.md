# WIN-268 Download Artifact Node 24 Follow-up

## Route Task

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering path: `.github/workflows/ci.yml`
- Linear: `WIN-268`
- Allowed files:
  - `.github/workflows/ci.yml`
  - `tests/workflows/github-actions-node24-runtime.test.ts`
  - `docs/ai/handoffs/WIN-268-download-artifact-node24-follow-up.md`
- Non-goals:
  - no application `node-version` change
  - no workflow trigger, permission, secret, environment, artifact path, condition, or job-logic change
  - no unrelated action upgrade
  - no app, Supabase, migration, auth, Netlify, or `scripts/ci/**` change
- Stop conditions:
  - any required edit outside the allowed files
  - any artifact extraction or runner incompatibility requiring workflow-logic changes
  - any need to widen permissions, triggers, secrets, or the application Node version

## Live Failure Evidence

- PR #882 CI run `30633114062` passed but emitted a Node 20 deprecation annotation for `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` (`v4.3.0`).
- Current `origin/main` contained exactly one `actions/download-artifact` use, in the `tier0-browser` job.
- Official upstream metadata declares the old pin as `node20` and immutable `v7.0.0` SHA `37930b1c2abaa49bbe596cd826c3c89aef350131` as `node24`.
- The existing workflow pin contract did not include `actions/download-artifact`, which allowed the stale runtime to survive PR #877.

## Implementation

- Replaced only the `actions/download-artifact` immutable pin and version comment in `.github/workflows/ci.yml`.
- Intentionally left the already-covered `checkout`, `setup-node`, and `upload-artifact` pins unchanged; this follow-up closes the single omission from PR #877.
- Added `actions/download-artifact` to the existing parser-based expected-pin contract.
- Preserved the `dist` artifact name, `artifact-dist` path, conditional execution, normalization step, job graph, permissions, triggers, and application `node-version: 20`.

## TDD Evidence

- Red: the amended parser contract failed only because `ci.yml` still used `d3f86a106a0bac45b974a628896c90dbdf5c8093` instead of `37930b1c2abaa49bbe596cd826c3c89aef350131`.
- Green: `github-actions-node24-runtime.test.ts` and `ci-test-memory.test.ts` passed after the one-line workflow pin replacement (`2` files, `2` tests).

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: CI workflow / GitHub-authored action runtime
- Required checks:
  - parser-based workflow contract tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - hosted CI with the artifact download step executed
  - mandatory non-author human review before merge
- Executed checks:
  - targeted parser tests: pass (`2` files, `2` tests)
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run test:ci`: pass (`437` files, `3623` tests; `2` files and `5` tests skipped by environment contracts)
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local`: pass, including coverage, build, and `220/220` Tier-0 Cypress tests
- Blocked checks:
  - hosted GitHub Actions proof is pending branch publication
  - non-author human review is pending
- Result: `pass-with-blocked-checks`
- Residual risk: local tests prove the pin and workflow shape, but GitHub-hosted CI must prove v7 artifact download/extraction behavior and absence of the Node 20 annotation.

## Required Reviews

- `specification-engineer`: approved the one-pin, one-contract-test boundary.
- `devops-engineer`: confirmed v7.0.0 uses Node 24 and found no input/output contract drift; requires hosted `tier0-browser` execution.
- `test-engineer`: confirmed the parser contract is the minimum red-green boundary and selected the critical-lane verification envelope.
- `software-architect`: approved the isolated action-ref and parser-contract design.
- `implementation-engineer`: approved implementation conformance with no required fixes.
- `code-review-engineer`: approved committed clean diff `82ec3a30` after the test-generated report timestamp was removed.
- `security-engineer`: approved; confirmed no permission, trigger, secret, token, artifact-scope, tenant, auth, or deploy drift.

## PR Hygiene

- Branch: `codex/win-268-download-artifact-node24`
- PR: `#883`
- Single purpose: yes
- Unrelated changes: none
- Protected-path drift: intended one-line immutable action pin replacement only
- Human review: mandatory before merge
- PR-ready: yes; merge remains blocked on hosted proof and mandatory non-author human review
