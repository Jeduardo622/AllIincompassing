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
- preview-runtime evidence: after registration, preview version 64 contained the branch `index.ts`, `preflight.ts`, and `runtime.ts`, but allowed and denied `OPTIONS` requests still returned no bytes within 10 seconds; a registered control function on the same preview returned `204` in about one second, a missing slug returned `404` in 0.15 seconds, and unauthenticated `GET`/`POST` requests received gateway `401` responses promptly
- root cause: the deployed `index.ts` exported `handler` but never registered it with `Deno.serve`, so gateway-owned JWT denials worked while worker-owned preflight handling never started
- repaired-preview evidence: exact preview version 65 (`ezbr_sha256=83c739e9fbfa5da1523f5d785dd94e2e242e3e5c0bf7a583531b7054614889c1`) contains both guarded `Deno.serve(handler)` and the lazy runtime import; allowed `OPTIONS` returned `204` in 0.97 seconds, denied `OPTIONS` returned `403` in 1.07 seconds, and unauthenticated `GET`/`POST` retained gateway `401` responses in under 0.2 seconds
- repaired-preview log evidence: sanitized Edge readback records the allowed and denied worker executions at 791 ms and 929 ms for the exact function id, with no request body, identity, token, or PHI retained
- evidence handling: sanitized status, duration, function slug, version, and contract evidence only; no identity, credential, token, PHI, or raw request payload retained

## Scope

- task intent: register the deployed handler and keep its entrypoint dependency-light so allowed and denied CORS preflights return before the heavy application/auth module graph is evaluated
- files touched: `supabase/functions/feature-flags-v2/index.ts`, `supabase/functions/feature-flags-v2/preflight.ts`, `supabase/functions/feature-flags-v2/runtime.ts`, `supabase/functions/feature-flags-v2/index.test.ts`, `supabase/config.toml`, `src/tests/security/edgeFunctionConfig.test.ts`, and this handoff
- non-goals: feature-flag behavior, auth capability, tenant scope, database schema, migrations, RLS, grants, shared CORS policy, frontend rendering, workflows, credentials, production deployment, or hosted mutation
- stop condition: stop before merge or deployment pending human review; re-route if containment requires any non-goal surface
- single-purpose diff: yes

## Implementation

- `index.ts` handles `OPTIONS` before the literal dynamic import of `runtime.ts`
- `index.ts` registers that handler with `Deno.serve` only when executed as the deployed entrypoint
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
  - entrypoint registration contract before `Deno.serve`: fail as expected, with the other 4 preflight/delegation tests passing
  - `deno test --no-lock --node-modules-dir=none --no-prompt --allow-env --allow-read ./supabase/functions/feature-flags-v2/index.test.ts`: pass, 5 tests
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
  - exact preview version/hash/source readback: pass; version 65, `verify_jwt=true`, deployed `index.ts`, guarded server registration, and lazy runtime import confirmed
  - exact preview public behavior: pass; allowed `OPTIONS=204`, denied `OPTIONS=403`, and unauthenticated `GET/POST=401`, all prompt
  - exact preview sanitized Edge log readback: pass; worker-owned preflights completed in 791 ms and 929 ms
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
  - production authenticated `GET`/`POST`, wrong-org denial, and Edge log readback: require a human-reviewed merge and explicit production deployment of this critical-path change
- result: `pass-with-blocked-checks`
- residual risk: exact preview evidence proves server registration, lazy startup, CORS allow/deny behavior, and unchanged gateway JWT enforcement; production deployment and authenticated same-org/wrong-org readback remain owner-gated

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

Hosted Edge logs traced the unusable Feature Flags route to two 150-second `OPTIONS` timeouts in the deployed `feature-flags-v2` function. The first exact preview proved that a lightweight exported handler was insufficient because the deployed entrypoint never registered it with `Deno.serve`; same-preview gateway and control-function probes isolated that bootstrap gap. The repair now registers the handler and keeps the existing application/auth module behind a literal dynamic import while preserving function-local CORS and tenant contracts. Focused Deno, policy, lint, typecheck, tenant, build, and prior coverage and tier-0 route checks pass; the inherited full-suite watchdog and secret-backed production checks remain explicitly classified. This critical change requires human review before merge or deployment.
