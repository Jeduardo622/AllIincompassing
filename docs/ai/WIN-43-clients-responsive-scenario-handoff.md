# WIN-43 Clients Responsive Scenario Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial local observer tooling outside protected production paths
- triggering paths: `scripts/lib/responsive-ui-observer.ts`, `scripts/playwright-responsive-ui-observer.ts`, observer tests, and observer contract documentation

## Scope

- task intent: add a fixed, synthetic, loopback-only `/clients` responsive-observer scenario
- files touched: observer scripts, focused observer tests, this handoff, and `.agents/skills/responsive-ui-observer/SKILL.md`
- single-purpose diff: yes

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer, security-engineer
- agents used: all required roles
- reviewer: completed; implementation findings closed, security approved

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts`: pass, 51/51
  - `npm run build`: pass
  - `npm run test:ci`: fail after 573 passing files and 5,157 passing tests on one unchanged QA-provisioning assertion
  - `npx vitest run tests/scripts/provision-ci-smoke-bcba.test.ts --reporter=verbose`: fail, 21/22 with the same unchanged assertion
- blocked checks:
  - `npm run verify:local`: not rerun because it includes the same deterministic unchanged `provision-ci-smoke-bcba` failure already isolated by `test:ci`
- result: pass-with-blocked-checks
- residual risk: exact-head CI must determine whether the inherited QA-provisioning contract failure is present in the protected environment

## PR Hygiene

- branch-ready: yes
- linear-ready: yes; tracked under WIN-43 because the workspace issue limit blocks a dedicated issue
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: local redacted evidence remains untracked
- verification summary: present
- pr-ready: yes for draft human review with the inherited verification blocker disclosed
- required follow-up: commit, push, open the draft PR, and inspect exact-head CI

## Handoff Summary

This branch adds a fixed local-only `/clients` observer scenario with synthetic auth/data and fail-closed request handling. Focused coverage passes for valid execution, unexpected reads, exact-query drift, mutation rejection, and redacted evidence. Standard static/build gates pass; broad local tests are blocked only by one deterministic unchanged QA-provisioning assertion, so exact-head CI remains the final arbiter.
