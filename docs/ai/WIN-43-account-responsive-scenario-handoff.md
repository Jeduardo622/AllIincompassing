# WIN-43 Account Responsive Scenario Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial local observer tooling outside protected production paths
- triggering paths: `scripts/lib/responsive-ui-observer.ts`, `scripts/playwright-responsive-ui-observer.ts`, observer tests, and observer contract documentation

## Scope

- task intent: add a fixed, synthetic, loopback-only `/account` responsive-observer scenario
- files touched: `.agents/skills/responsive-ui-observer/SKILL.md`, `docs/ai/WIN-43-account-responsive-scenario-handoff.md`, `scripts/lib/responsive-ui-observer.ts`, `scripts/playwright-responsive-ui-observer.ts`, `tests/responsiveUiObserver.test.ts`, and `tests/responsiveUiObserverRuntime.test.ts`
- non-goals: no production app, auth, runtime-config, API, Supabase, workflow, hosted, or credential changes
- stop condition: any required production-path change or hosted mutation requires rerouting
- single-purpose diff: yes

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer, security-engineer
- agents used: all required roles
- implementation review: added a fail-closed disabled-state assertion and regression test for `Save Changes`
- security review: approved with no findings
- code review: initial documentation findings addressed; final rereview passed with no findings
- test review: pass-with-blocked-checks; no slice-specific findings

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts --reporter=verbose`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4176 --route=/account --scenario=account-settings --artifact-run-id=win-43-account-settings-final`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - focused observer tests: pass, 58/58
  - `npm run build`: pass
  - `npm run test:ci`: initial default-heap run reached the late suite and terminated on Node heap exhaustion without an assertion result
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: 573 files and 5,162 tests passed; one unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` ordering assertion failed
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: policy, lint, and typecheck passed, then the same unchanged BCBA provisioning assertion failed after 573 files and 5,162 tests passed; later aggregate steps were not reached
  - exact responsive observer: pass at desktop `1440x900` and mobile `390x844`; no failure codes
- blocked checks:
  - `npm run test:ci`: blocked by the unchanged prerequisite-branch BCBA provisioning assertion at line 51 (`roleReadback` token absent after `roleMapping`)
  - `npm run verify:local`: blocked at its included `test:ci` step by that same assertion; `ci:verify-coverage`, the aggregate build rerun, and Tier-0 were therefore not reached inside the aggregate command
- evidence:
  - desktop screenshot hash: `sha256:aa8b4096140ece88e6594423a32efcee868ec0c6c4f8326959a643c5516303f9`
  - desktop evidence hash: `sha256:910d5bf2e553a90f6d34e378366970c376a8bec91f66fbfc2f6040f6b37e93a6`
  - mobile screenshot hash: `sha256:76c76405fd4b4732cdd38a5a35b6303e4866e4edcae62bf5368aee6c1c863100`
  - mobile evidence hash: `sha256:7ee9c787f004c2f0b65ed530e1b32fd044ec3f730901f0fdf406126549415602`
  - local redacted artifacts: `artifacts/responsive-ui-observer/win-43-account-settings-final/`
- startup note: the first cold Vite desktop navigation timed out before rendering; its blank artifact was rejected. Exact-head final evidence was captured only after both required viewports passed.
- result: pass-with-blocked-checks
- residual risk: exact-head CI must determine whether the inherited QA-provisioning assertion remains present in the protected environment

## Scenario Boundary

- the account route is available to all authenticated users; the fixed client role is the least-privilege authenticated shell and does not claim coverage of every role-specific sidebar variant
- each viewport starts in a fresh browser context, clears local and session storage, then seeds one fixed PHI-free client identity
- the scenario fulfills only `GET /api/runtime-config`; external origins, unexpected same-origin reads, and non-read methods fail closed
- the observer verifies the expected account controls and requires `Save Changes` to remain disabled without activating profile or password mutations

## PR Hygiene

- intended base: `codex/add-clients-responsive-scenario` (PR #995 prerequisite)
- branch: `codex/add-account-responsive-scenario`
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: local redacted evidence remains untracked
- verification summary: present
- linear-ready: yes; tracked under WIN-43
- pr handoff: ready for a stacked draft PR against `codex/add-clients-responsive-scenario`
- reviewer: completed
- pr-ready: yes for a stacked draft PR with the inherited blocker disclosed
- required follow-up: commit, push, open the draft PR against `codex/add-clients-responsive-scenario`, and inspect exact-head CI
