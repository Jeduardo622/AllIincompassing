# WIN-250 AI Agent Deploy Governance Handoff

Date: Thursday, July 23, 2026

## Scope

- Issue: `WIN-250`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Changed scope:
  - `.github/workflows/ci.yml`
  - `package.json`
  - `scripts/ci/deploy-ai-agent-function.mjs`
  - `scripts/ci/check-session-deploy-safety.mjs`
  - `tests/ci/deploy-ai-agent-function.test.ts`
  - `tests/ci/check-session-deploy-safety.test.ts`
- Non-goals honored:
  - left the existing session deploy script unchanged
  - did not touch runtime edge code, shared edge helpers, migrations, secrets, or other workflow files

## Implementation Summary

- Added `change_scope.outputs.ai_agent_changed` in [ci.yml](/C:/Users/test/Desktop/AllIincompassing-win250/.github/workflows/ci.yml) with:
  - `true` fallback when diff metadata is unavailable
  - `true` only for the deployed bundle manifest when diff metadata exists:
    - `supabase/functions/ai-agent-optimized/**`
    - `_shared/database.ts`, `auth.ts`, `org.ts`, `logging.ts`, `cors.ts`, `supabaseEnv.ts`, and `requestAuthHeaders.ts`
    - `lib/http/error.ts`
- Added main-only `deploy_ai_agent_edge` after `deploy_session_edge`, gated by `ai_agent_changed == 'true'`.
- Added `ci:deploy:ai-agent-function` and implemented [deploy-ai-agent-function.mjs](/C:/Users/test/Desktop/AllIincompassing-win250/scripts/ci/deploy-ai-agent-function.mjs) to:
  - deploy exactly `ai-agent-optimized`
  - retry Docker rate-limit failures with `--use-api`
  - verify remote slug presence
  - verify `verify_jwt=true`
- Extended [check-session-deploy-safety.mjs](/C:/Users/test/Desktop/AllIincompassing-win250/scripts/ci/check-session-deploy-safety.mjs) so it:
  - authorizes only the exact session deploy command in `deploy_session_edge`
  - authorizes only the exact AI deploy command in `deploy_ai_agent_edge`
  - rejects raw or misplaced deploy invocations through environment prefixes, package-manager exec wrappers, explicit binary paths, POSIX shells, PowerShell, and `cmd /c`
  - ignores comments and echoed or printed inert deploy text
  - requires `ci_gate` to enforce AI deploy success only on `main` when `ai_agent_changed=true`
- Added focused TDD coverage for the new deploy script and the workflow/checker rules, including missing/non-boolean `verify_jwt` and failed deploy retry paths.

## Reviewer Follow-up

- Change-scope review:
  - the workflow and checker now share the exact bundled dependency manifest
  - tests cover function-local paths, every listed dependency, unrelated paths, broadened or incomplete patterns, and unavailable-diff fallback
- Security review:
  - raw deploy detection unwraps up to four nested shell interpreter commands
  - tests cover `bash`, `sh`, `dash`, `zsh`, `pwsh`, `powershell.exe`, and `cmd.exe`, including common pre-command flags and nested shells
  - wrapped `echo` and `printf` commands remain inert
- Tester review:
  - remote verification rejects `verify_jwt` when false, missing, or a non-boolean string
  - non-rate-limit deploy errors do not retry
  - a failed `--use-api` retry exits before remote list verification

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type:
  - `CI/workflow/policy`
  - `server/API/edge integration`
- Required checks:
  - validate affected workflow/script directly
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npx vitest run tests/ci/deploy-ai-agent-function.test.ts tests/ci/check-session-deploy-safety.test.ts` -> `pass` (`110` tests)
  - `node scripts/ci/check-session-deploy-safety.mjs` -> `pass`
  - `npm run ci:check-focused` -> `pass`
  - `npm run lint` -> `pass`
  - `npm run typecheck` -> `pass`
  - `npm run validate:tenant` -> `pass`
  - `npm run build` -> `pass`
  - `npm run test:ci` -> `fail` in two unrelated baseline tests
  - `npm run verify:local` -> `fail` when it reaches the same `npm run test:ci` baseline failures
- Blocked checks:
  - `npm run test:ci` -> blocked by unrelated baseline failures in the BT/ABA proof workflow assertion and Blob download test
  - `npm run verify:local` -> blocked at its `npm run test:ci` stage by the same unrelated baseline failures
- Result: `pass-with-blocked-checks`
- Residual risk:
  - broader repo test baseline is not fully green because `npm run test:ci` currently fails in unrelated BT/ABA workflow and Blob download tests outside the WIN-250 file set

## `npm run test:ci` Failure Detail

- Failures observed in:
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
  - expectation mismatch for existing branch-name proof text in a BT ABA disposable-browser-proof workflow test
  - `src/lib/__tests__/supabase.edge.test.ts`
  - local test Blob does not expose `blob.text()` in the async PDF download assertion
- WIN-250 relation:
  - no files from that workflow/test area were changed in this slice
  - the targeted WIN-250 tests and direct deploy safety checker both passed

## PR Hygiene

- `pr-ready`: `yes, with declared unrelated local baseline failures`
- `branch-ready`: `yes`
- `linear-ready`: `yes` (`WIN-250`)
- `single-purpose`: `yes`
- `unrelated changes`: `none in owned scope`
- `generated artifact drift`: `none`
- `protected-path drift`: expected for `.github/workflows/ci.yml` and `scripts/ci/**`; lane remained `critical`
- `change summary`: `present`
- `verification summary`: `present`
- `pr handoff`: `ready with blocked-check detail for the unrelated local baseline`
- `reviewer`: `approved`
- `security reviewer`: `approved`

## Next Verification Commands

- `node scripts/ci/check-session-deploy-safety.mjs`
- `npx vitest run tests/ci/deploy-ai-agent-function.test.ts tests/ci/check-session-deploy-safety.test.ts`
- `npm run test:ci`
- `npm run verify:local`
