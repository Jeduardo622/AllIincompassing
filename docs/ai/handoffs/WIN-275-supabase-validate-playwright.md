# WIN-275 Supabase Validate Chromium Repair

## Scope

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Branch: `codex/win-275-supabase-validate-playwright`
- Base: `79301e387d9989400b4999cbc4902c5b6466eaaa`
- Implementation files: `.github/workflows/supabase-validate.yml` and `tests/integration/live-rls-fixture-schema.contract.test.ts`
- Non-goals: migrations, Supabase configuration, secrets, application behavior, deployments, and hosted actions

The repair installs the lockfile-pinned Playwright Chromium binary after `npm ci` and before the Supabase Validate application tests. The structural contract parses the workflow and requires `npm ci` -> `playwright install [options] chromium` -> first `npm test` ordering while rejecting `install-deps` and npm package-install false positives.

## Verification Card

- Required checks: direct YAML validation, focused contract and observer tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, and `npm run verify:local`
- TDD: initial RED `1 failed / 16 passed`; structural removal RED `1 failed / 16 passed`; final focused contract GREEN `21/21`; contract plus observer GREEN `27/27`
- Resource diagnosis: the default approximately 4 GB heap exhausted; one 6 GB run hit unrelated full-suite contention; a clean 6 GB `npm run test:ci` passed `479` files and `4105` tests, with `2` files and `5` tests skipped
- Specialist review: implementation, architecture, test, DevOps, and security reviews found no implementation or privilege regression; two code-review test-predicate findings were fixed
- Result: `pass-with-blocked-checks`; the final clean `verify:local` passed after preserving the hash-bound canonical ledger handoff
- Blocked hosted proof: the pull-request checks and post-merge Supabase Validate main-push run have not run yet
- Residual risk: the existing Supabase CI project-identity guard remains separate security hardening debt; this slice does not widen secrets, triggers, permissions, or mutation scope

The canonical `docs/ai/handoffs/agent-work-ledger-foundation.md` remains unchanged because existing shadow and retention attestations bind its exact hash.
