# WIN-256 Fill Docs Static Deploy Handoff

Date: Sunday, July 26, 2026

## Scope

- Issue: `WIN-256`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths:
  - `scripts/ci/deploy-fill-docs-function.mjs`
  - `scripts/ci/check-session-deploy-safety.mjs`
  - `scripts/ci/run-rollback-drill.mjs`
  - `tests/ci/deploy-fill-docs-function.test.ts`
  - `tests/ci/check-session-deploy-safety.test.ts`
  - `.github/workflows/ci.yml`
  - `package.json`
  - `docs/supabase_branching.md`
  - `docs/ai/WIN-256-fill-docs-static-deploy-handoff.md`
- Non-goals honored:
  - no `fill-docs` runtime code changes
  - no auth, schema, migration, or function runtime edits
  - no Management API fallback or retry path

## Route Task

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Risk rationale:
  - `.github/workflows/ci.yml` controls production deployment and repository secrets.
  - `scripts/ci/**` is a protected policy surface.
  - A bad deployment path can corrupt the binary DOCX static assets or bypass CI.
- Allowed surfaces: the explicit files listed above.
- Stop conditions: any function runtime, auth, schema, migration, RLS, tenant, or secret-value change.
- Required agents used:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `devops-engineer`
- Tracking: [WIN-256](https://linear.app/winningedgeai/issue/WIN-256/fix-production-fill-docs-template-load-500-after-v16-entrypoint-repair)

## Root Cause

- Hosted `fill-docs` version 16 returned JSON `500` in production even though the handler and the real ER template succeeded locally.
- The failing deploy path used Supabase Management API bundling, which accepts string-only file uploads and corrupted the bundled DOCX bytes with replacement-character drift.
- Supabase documents that functions using `static_files` cannot deploy through `--use-api`; they require Docker-backed CLI bundling.

## RED -> GREEN

- RED:
  - `npx vitest run tests/ci/deploy-fill-docs-function.test.ts`
  - failed because `ci:deploy:fill-docs-function` was absent from `package.json`
  - failed because `scripts/ci/deploy-fill-docs-function.mjs` did not exist
- GREEN target:
  - dedicated deploy helper deploys only `fill-docs`
  - derives `project-ref` from `SUPABASE_PROJECT_REF` or `SUPABASE_URL`
  - fails closed when both target inputs are present but disagree
  - requires non-empty `SUPABASE_ACCESS_TOKEN`
  - never retries with `--use-api`
  - verifies `fill-docs` exists remotely and enforces `verify_jwt=true`
  - existing protected `deploy_session_edge` job invokes the helper only after its full CI fan-in succeeds

## Implementation Summary

- Added `scripts/ci/deploy-fill-docs-function.mjs` as a single-purpose `fill-docs` deploy helper.
- Added targeted Vitest coverage for:
  - package script wiring
  - success path with no `--use-api`
  - missing token
  - missing project ref
  - Docker/static-file deploy failure with no retry
  - rate-limit failure with no retry
  - missing remote slug
  - `verify_jwt` mismatch
- Added `ci:deploy:fill-docs-function` to `package.json`.
- Added the fill-docs deploy as the final step of the existing `deploy_session_edge` job:
  - restricted to reviewed pushes on `main`
  - gated by policy, tenant safety, runtime parity, runtime contract, lint/typecheck, unit tests, and build
  - runs on every reviewed `main` push, so function-local and `_shared` dependency changes cannot leave production stale
- Extended deploy-policy tests and the rollback runbook to require this exact guarded command.
- Rejected an earlier standalone-workflow design during independent review because it allowed manual non-main deployment and bypassed the existing protected CI fan-in.

## Required Checks

- Focused test:
  - `npx vitest run tests/ci/deploy-fill-docs-function.test.ts tests/ci/check-session-deploy-safety.test.ts`
- Direct script validation:
  - `node scripts/ci/deploy-fill-docs-function.mjs` with fake or controlled Supabase CLI
- Critical-lane repo checks still required before merge:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local` when local prerequisites permit

## Verify Change Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: `CI/workflow/policy` and `edge deployment integration`
- Required checks:
  - `npm ci`
  - `npx vitest run tests/ci/deploy-fill-docs-function.test.ts tests/ci/check-session-deploy-safety.test.ts`
  - `npm run ci:check-focused`
  - `npm run ci:rollback-drill`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npm ci` -> pass
  - focused Vitest command -> pass (`114/114`)
  - `npm run ci:check-focused` -> pass
  - `npm run ci:rollback-drill` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> local Windows fail in existing, unrelated LF-sensitive assertions; the same `origin/main` SHA passed GitHub CI run `30217501194`
- Blocked checks:
  - `npm run verify:local` -> blocked locally because it invokes the same `test:ci` step that fails on CRLF checkouts before reaching coverage and tier-0; GitHub CI is the authoritative Linux gate for this branch.
- Result: `pass-with-blocked-checks`
- Residual risk:
  - The protected main-push job and production credentials can only be proven in GitHub Actions.
  - A Docker/ECR throttle will fail closed after the session bundle has already deployed.
  - Hosted `fill-docs` binary integrity and ER/FBA/PR output still require live reproof after merge.

## Independent Review

- Security: approved; no remaining findings.
- DevOps/CI: review-ready for human review; earlier trigger and CI-fan-in blockers are closed.
- Test: workflow placement, missing/off-job command, ordering, target mismatch, Docker/static failure, and `verify_jwt` regressions are covered.
- Code review: approved; no remaining findings.

## PR Hygiene Verdict

- `pr-ready`: yes
- `lane`: critical
- `branch-ready`: yes (`codex/win-256-fill-docs-template-runtime`)
- `linear-ready`: yes (`WIN-256`)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: none beyond the explicitly routed CI/deploy surfaces
- `change summary`: present
- `verification summary`: present (`pass-with-blocked-checks`; authoritative Linux CI still required)
- `pr handoff`: ready
- `reviewer`: completed and approved
- `required follow-up`:
  - human review before merge
  - all required GitHub checks green
  - verify guarded production deploy and live ER/FBA/PR generation after merge
- `handoff summary`: Deploy `fill-docs` through the existing protected main-push CI fan-in using Docker-backed Supabase CLI bundling. Fail closed on project-target drift, Docker/static-file errors, missing function state, or `verify_jwt` mismatch; then reprove real production DOCX generation after merge.

## Live Reproof Required After Merge

1. Merge the human-reviewed PR to `main`.
2. Confirm the guarded `deploy-session-edge` job runs `ci:deploy:fill-docs-function` after all prerequisite jobs and uses Docker-backed Supabase CLI bundling only.
3. Run `supabase functions list --project-ref <ref> --output json` against production and verify:
   - `fill-docs` exists
   - `verify_jwt` is `true`
4. Re-run the production ER/FBA/PR document proof with the real static templates and confirm the JSON `500` is gone.

## Residual Risk

- Local tests prove deploy governance only; they do not prove hosted Docker availability or production credentials.
- The existing protected deployment graph is changed and still requires human review before merge.
