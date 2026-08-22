# WIN-43 Feature Flags Responsive Scenario Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial local responsive-observer tooling outside protected production paths
- triggering paths: `scripts/lib/responsive-ui-observer.ts`, `scripts/playwright-responsive-ui-observer.ts`, focused observer tests, and observer contract documentation

## Scope

- task intent: add a fixed, synthetic, loopback-only `/settings/feature-flags` responsive-observer scenario
- intended base: `codex/add-account-responsive-scenario` (draft PR #1004)
- allowed files: observer skill, observer library/runtime, focused observer tests, and this handoff
- non-goals: no production app, auth, runtime-config, API, Supabase, workflow, deploy, hosted-data, credential, or mutation changes
- stop condition: reroute if the scenario requires any non-goal surface or cannot fail closed on unexpected requests
- single-purpose diff: yes

## Acceptance Criteria

- the CLI accepts the fixed scenario only with exactly one `/settings/feature-flags` route
- each viewport starts with a fresh PHI-free synthetic authenticated super-admin shell
- the scenario fulfills only the exact synthetic auth bootstrap, shell read, runtime-config, and semantic `feature-flags-v2` list contracts required to render the route
- external origins, unexpected same-origin reads, query/body shape drift, and non-read methods fail closed
- the observer verifies the Settings shell, active Feature Flags tab, Super Admin Feature Flags heading, enrollment lock, global flags controls, and organization overrides surface
- the observer prevents simultaneous pending and terminal organization states from qualifying as a pass
- the observer does not activate create, toggle, plan-assignment, or other mutation controls
- evidence is sanitized and covers desktop `1440x900` and mobile `390x844`

## Required Agents

- required sequence: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`
- agents used: specification, implementation, code review, and test engineering complete
- reviewer: initial `request changes` was limited to this stale handoff plus optional direct auxiliary-read coverage; both were addressed

## Verification Card

- required checks:
  - focused responsive observer unit/runtime tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - responsive observation for `/settings/feature-flags` at `1440x900` and `390x844`
- executed checks:
  - focused observer tests: `76/76` passed
  - focused positive scenario after reviewer follow-up: `1/1` passed and now exercises exact auxiliary shell reads
  - `npm run ci:check-focused`: passed; database-backed checks skipped because no database URL was configured
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run test:ci`: scoped tests passed; aggregate failed on the inherited `provision-ci-smoke-bcba` source-order assertion (`5182` passed, `1` failed, `101` skipped) plus one Vitest worker update timeout
  - real Vite responsive observation on `http://127.0.0.1:4177/settings/feature-flags`: passed at desktop `1440x900` and mobile `390x844`
- evidence hashes:
  - desktop screenshot: `sha256:55ccdf92fb1bf1db6d0a0548bfbc8b928bc7631ede6041a84fcf27f28f205291`
  - desktop evidence: `sha256:ccb4da9dac854273fc8ad0039434c3a075079cc1483082a7347140c6603a2106`
  - mobile screenshot: `sha256:528f2e7cd6ccf6ef64ff745f5527f4c03f45e243f64011caf6d5ed67f82ab0bf`
  - mobile evidence: `sha256:265ec01cb23a7498255b3689e4985c652025c9012818a9b060bde122046137c9`
- blocked checks: `verify:local` reproduced the same inherited BCBA provisioning assertion during its `test:ci` stage and the redundant full-suite tail was stopped; secret-backed database checks are not available locally
- result: feature-flags observer slice passes targeted, static, build, and real responsive verification; aggregate local gate remains red for the attributed inherited assertion
- residual risk: low; exact auxiliary shell read contracts may need a scenario update if the authenticated layout intentionally changes its bootstrap queries

## PR Hygiene

- branch: `codex/add-feature-flags-responsive-scenario`
- branch-ready: yes
- linear-ready: yes, tracked under `WIN-43`
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none tracked; redacted responsive evidence remains ignored and the temporary diagnostic was removed
- verification summary: targeted and real responsive checks pass; aggregate failure is inherited and explicitly attributed above
- pr-ready: yes
- required follow-up: push and open a stacked draft PR against `codex/add-account-responsive-scenario`, then wait for exact-head CI

## Handoff Summary

The hosted feature-flags audit and bounded application repair exposed a missing deterministic local observer scenario. This stacked tooling slice adds synthetic, fail-closed responsive coverage without changing production application or authority behavior. The real Vite route now passes both required viewports with redacted, hash-bound evidence.
