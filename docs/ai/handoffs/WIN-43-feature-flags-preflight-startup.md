# WIN-43 Feature Flags Preflight Startup Repair

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the live Feature Flags route is blocked by a deployed Edge Function `OPTIONS` timeout, and the bounded repair touches the protected `supabase/functions/**` API boundary
- triggering paths: `supabase/functions/feature-flags-v2/**`

## Live Reproduction

- route: hosted `/settings/feature-flags`
- persona: authenticated super-admin QA persona
- action boundary: read-only navigation and preflight inspection; no flag, organization, role, credential, or hosted data mutation
- observed defect: after a hard reload the contradictory cached loading/empty state was gone, but the current bundle remained indefinitely on `Loading...`
- backend evidence: current hosted Edge logs recorded two `OPTIONS` requests to `feature-flags-v2` version 63 ending in `504` after approximately 150 seconds, with no following `POST`
- deployed-entrypoint evidence: hosted function metadata identifies `supabase/functions/feature-flags-v2/index.ts` as the active entrypoint
- preview-deployment evidence: the first PR preview retained production-cloned function version 63 because `feature-flags-v2` was absent from `supabase/config.toml`; branch-action logs showed only explicitly registered functions being deployed
- evidence handling: sanitized status, duration, function slug, version, and contract evidence only; no identity, credential, token, PHI, or raw request payload retained

## Scope

- task intent: keep the deployed entrypoint dependency-light so allowed and denied CORS preflights return before the heavy application/auth module graph is evaluated
- files touched: `supabase/functions/feature-flags-v2/index.ts`, `supabase/functions/feature-flags-v2/preflight.ts`, `supabase/functions/feature-flags-v2/runtime.ts`, `supabase/functions/feature-flags-v2/index.test.ts`, `supabase/config.toml`, `src/tests/security/edgeFunctionConfig.test.ts`, and this handoff
- non-goals: feature-flag behavior, auth capability, tenant scope, database schema, migrations, RLS, grants, shared CORS policy, frontend rendering, workflows, credentials, production deployment, or hosted mutation
- stop condition: stop before merge or deployment pending human review; re-route if containment requires any non-goal surface
- single-purpose diff: yes

## Implementation

- `index.ts` handles `OPTIONS` before the literal dynamic import of `runtime.ts`
- `preflight.ts` preserves the function's existing narrow origin allowlist, requested-header behavior, and disallowed-origin `403`
- `runtime.ts` preserves the prior non-`OPTIONS` GET/POST, request-scoped auth, protected-admin wrapper, and single-organization guards
- `supabase/config.toml` registers `feature-flags-v2` with `verify_jwt = true` so Supabase PR previews deploy the reviewed branch function instead of retaining the production-cloned version
- no migration, RLS, grant, shared auth, shared CORS, workflow, or secret surface changed

## Required Agents

- required sequence: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer` -> `performance-engineer` -> `supabase-reviewer` -> `devops-engineer`
- agents used: specification, architecture, implementation, code review, test planning, security, performance, Supabase, and DevOps review
- reviewer: completed; final re-review passed with no remaining file or line findings

## Verification Card

- required checks:
  - focused Deno tests and checks for the actual function entrypoint
  - Supabase Edge Runtime bundle of the actual function entrypoint
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused Vitest coverage for Feature Flags and route guards
  - focused preview-deployment configuration contract
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run validate:tenant`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `deno test --no-lock --node-modules-dir=none --no-prompt --allow-env --allow-read ./supabase/functions/feature-flags-v2/index.test.ts`: pass, 4 tests
  - `deno check --no-lock --node-modules-dir=none` for `index.ts`, `runtime.ts`, and `preflight.ts`: pass
  - `deno info --json` for `index.ts`: pass; `runtime.ts` is recorded as a dynamic dependency
  - Supabase Edge Runtime v1.74.3 `bundle` for the actual `index.ts`: pass
  - `npm run ci:check-focused`: pass; database-backed parity and drift checks were not applicable without a database URL
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - focused Vitest for `SuperAdminFeatureFlags.test.tsx`, `Settings.test.tsx`, and `guards.test.ts`: pass, 32 tests
  - focused Vitest for `src/tests/security/edgeFunctionConfig.test.ts`: pass
  - preview-deployment config contract before registration: fail as expected because `[functions.feature-flags-v2]` was absent
  - preview-deployment config contract after registration: pass, 2 tests
  - widened-diff security, Supabase, DevOps, and code reviews: pass with no findings
  - `npm run test:ci`: fail at the default 4 GB heap with Node out-of-memory after no observed assertion failure
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: fail, 5184 passed and 101 skipped with one deterministic failure in `tests/scripts/provision-ci-smoke-bcba.test.ts`
  - isolated rerun of `tests/scripts/provision-ci-smoke-bcba.test.ts`: fail, 1 failed and 21 passed; both the test and subject file match `origin/main`, whose exact-main Linux CI passed
  - `npm run ci:verify-coverage`: pass; overall line coverage 93.08% against the 86.00% threshold and all module floors passed
  - `npm run validate:tenant`: pass
  - `npm run test:routes:tier0`: pass, 250 tests across 8 Cypress specs
  - `npm run build`: pass
  - `git diff --cached --check`: pass
- blocked checks:
  - `npm run ci:playwright`: protected hosted persona credentials are not available to this process; no `.env*` file was read
  - `npm run verify:local`: aggregate cannot be green locally because its `test:ci` stage contains the unchanged Windows CRLF-sensitive BCBA provisioning assertion above; exact-head Linux CI remains required
  - preview deployed `OPTIONS` and function metadata readback: pending the new exact-head Supabase Preview deployment with the registration stanza
  - production authenticated `GET`/`POST`, wrong-org denial, and Edge log readback: require a human-reviewed merge and explicit production deployment of this critical-path change
- result: `pass-with-blocked-checks`
- residual risk: source, focused tests, Deno graph checks, and the production Edge Runtime bundler support the lazy startup boundary, but only post-deploy hosted preflight latency and authenticated readback can prove the production timeout is resolved

## PR Hygiene

- branch-ready: yes, `codex/fix-feature-flags-preflight-startup`
- linear-ready: yes, tracked under `WIN-43`
- protected-path drift: expected and contained to `supabase/functions/feature-flags-v2/**`
- unrelated changes: none
- generated artifact drift: none; temporary Docker proof containers and volume were removed
- verification summary: present
- pr-ready: yes, for human review only
- required follow-up: complete final reviewer pass, push and open a critical-lane PR, require human review and exact-head CI, then perform hosted preflight/authz/tenant/log readback after owner merge and deployment

## Handoff Summary

Hosted Edge logs traced the unusable Feature Flags route to two 150-second `OPTIONS` timeouts in the deployed `feature-flags-v2` function. The repair moves the existing application and auth handler behind a literal dynamic import while preserving the function-local CORS and tenant contracts in a lightweight deployed entrypoint. Focused Deno, Edge Runtime bundle, policy, lint, typecheck, coverage, tenant, build, and all 250 tier-0 route checks pass; the aggregate Windows test failure is unchanged from `origin/main`, and secret-backed plus post-deploy checks remain explicitly blocked. This critical change requires human review before merge or deployment.
