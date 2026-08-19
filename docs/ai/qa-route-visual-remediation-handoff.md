# Route And Visual QA Remediation Handoff

## Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/qa-route-visual-remediation`
- issue: unavailable; Linear rejected issue creation because the workspace exceeded its free issue limit
- intent: remediate the confirmed route, accessibility, responsive, and audit-harness findings in one reviewable PR

## Scope

- remove fabricated therapist operational records and use honest empty states
- make the mobile navigation drawer keyboard-safe and Escape-closeable
- repair accessible names, heading hierarchy, contrast, touch targets, overflow, and horizontal-scroll affordances
- provide accurate tokenless-invite, unauthorized, missing-thread, prompt-history, and protected Not Found states
- set route-specific document titles without leaking tokens or protected identifiers
- align the `admin_schedule` root contract with the settled `/schedule` redirect
- require current production output and settled page identity in route audits

## Non-Goals

- no role, capability, authz, guardian, tenant, RLS, schema, RPC, secret, runtime-config, deploy, or hosted-mutation changes
- no changes under `src/lib/auth*`, `src/lib/runtimeConfig*`, `src/server/**`, `supabase/**`, `.github/workflows/**`, `scripts/ci/**`, or `netlify.toml`
- no production or customer data in tests or artifacts
- no cleanup or modification of unrelated dirty workspace content

## Verification

Required before PR-ready closure:

- focused regression tests with observed red-green evidence
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run verify:local` when secret-free
- responsive observer evidence at `1440x900` and `390x844` for every affected visible route
- `npm run ci:playwright` in CI; local execution remains blocked unless supported hosted credentials are available
- architecture, code, test, and security review with all actionable findings resolved

## Stop Conditions

- stop and re-route if implementation requires a protected backend path or changes who may access data or routes
- stop if a fix requires hosted credentials, customer data, or a persistent hosted mutation
- do not mark PR-ready while Linear linkage is unavailable or any required review/check remains unresolved

## Current Status

- branch created from current `origin/main` at `8f602776`
- existing dirty `WIN-251` handoff and untracked audit artifacts preserved
- Linear issue creation attempted and rejected by the workspace quota
- all 18 confirmed audit findings have bounded implementations and regression coverage
- initial code, security, and test reviews returned actionable findings; exact path matching, onboarding titles, fail-closed thread loading, and blank-page detection were corrected
- final code, security, and test re-reviews approve the current branch with no remaining branch-specific actionable findings
- supplemental Cypress visual captures covered public terminal states, protected Not Found, dark-mode impersonation, settings deep links, and the open mobile drawer; a deterministic browser assertion confirms no document-level settings overflow at the tested desktop and mobile widths

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: UI/component/page; auth-adjacent routing; browser audit tooling
- required checks: focused Vitest regressions; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run test:routes:tier0`; `npm run build`; `npm run verify:local`; `npm run test:ui:responsive`; `npm run ci:playwright`
- executed checks:
  - focused Vitest regressions: pass (`176` integrated tests, `17` public auth/account tests, `64` route-review tests, and the final `56` settings/navigation tests)
  - `npm run ci:check-focused`: pass; environment-only database and branch-protection checks reported their expected skips
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run audit:routes`: pass; a fresh preview build produced `141/141` successful route-role checks, and the CLI now fails when any route check fails
  - `npm run test:routes:tier0`: pass across the integrated route run and final rebuilt public/admin rerun; the final admin spec includes deterministic `1440x900` and `390x844` settings containment plus the real protected Not Found shell
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: partial failure; `562` files passed, `7` skipped, and the only assertion failure remaining after an in-scope rerun is the unrelated existing `tests/scripts/provision-ci-smoke-bcba.test.ts` source-contract expectation; the large run also reported a worker update timeout
  - `npm run verify:local`: fail because its default-memory `test:ci` process exhausted the Node heap; the expanded-heap rerun is recorded above
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4184 --route=/accept-invite --route=/unauthorized`: blocked by bootstrap console errors under the observer's fail-closed network policy; layout checks reported no horizontal overflow or clipped fixed controls
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4184 --route=/schedule --scenario=schedule-overlap`: blocked by console, non-read-method, and same-origin-request failures in the built-in scenario
- blocked checks:
  - `npm run ci:playwright`: requires the hosted CI credential path and remains for exact-head PR CI
  - complete responsive observer card: observer/bootstrap incompatibility described above; supplemental authenticated Cypress captures are not substituted for the mandatory card
- result: `fail` for PR-ready closure; implementation is suitable only for a draft PR pending the blocked gates and human review
- residual risk: route behavior and the audited visual states are covered locally, but the required sanitized observer card, full hosted Playwright gate, Linear linkage, and exact-head CI remain unresolved

## PR Hygiene

- pr-ready: `no`
- branch-ready: `yes`
- linear-ready: `no`; workspace quota blocks issue creation
- single-purpose: `yes`
- unrelated changes: existing `docs/ai/WIN-251-midtier-session-booking-handoff.md` and pre-existing untracked audit directories are excluded
- generated artifact drift: responsive observer and supplemental Cypress artifacts remain local and will not be committed
- protected-path drift: none; no protected backend, auth library, database, deploy, or workflow path changed
- change summary: present
- verification summary: present
- pr handoff: draft-only pending push, live CI, and required human review
