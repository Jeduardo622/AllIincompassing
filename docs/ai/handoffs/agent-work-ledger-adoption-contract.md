# Agent Work Ledger Adoption Contract Handoff

## Scope

- issue and route: WIN-275; `classification: high-risk human-reviewed`; `lane: critical`
- branch and base: `codex/agent-work-ledger-adoption-contract` from local retention commit `2c7f385c`; the retention branch and Task 9 recovery stashes remain untouched
- engineering boundary: Linear, verification cards, and markdown handoffs remain authoritative for software work; no engineering issue, prompt, code, review note, or arbitrary task may enter the tenant-scoped assessment Ledger
- supported callers: authenticated application users with the current manage capability may explicitly create only the fixed IEHP assessment-preparation and CalOptima draft-review workflows; the client hides mutation controls otherwise, and the server still re-derives actor, tenant, document, graph, approval, and runtime authority
- non-goals: no generic workflow intake, engineering-agent/MCP write path, migration, scheduler, Cron, Vault, hosted configuration, provider call, retention activation/deletion, PHI/customer data, autonomous clinical action, or `active` mode

## Findings And Implementation

- CalOptima already had a complete create/generate/handoff path.
- IEHP had the tenant-safe backend create route but no application create helper/control. This slice adds the explicit no-ledger action without changing migrations or Edge routes.
- The IEHP create control is passed the existing `manageProgramsGoals` capability and defaults fail-closed when that capability is absent; the Edge route remains the authoritative enforcement point.
- Exposed callers already failed closed to `disabled|shadow|advisory`, but the shared policy/repository types still admitted future `active`. This slice removes that allowance and adds focused denial coverage.

## Route Expansion And Stop Conditions

- fresh re-route after review: `classification: high-risk human-reviewed`; `lane: critical`
- trigger: the IEHP mutation control required the existing `ProgramsGoalsTab` manage-capability boundary, and the public `agent-work-items` adapter required route-level future-mode denial coverage
- allowed implementation surfaces: `src/lib/agent-work-ledger.ts`, `src/lib/__tests__/agent-work-ledger.test.ts`, `src/components/ClientDetails/IehpFbaLayoutReview.tsx`, `src/components/ClientDetails/ProgramsGoalsTab.tsx`, `src/components/__tests__/IehpFbaLayoutReview.test.tsx`, `supabase/functions/_shared/agent-work/policy.ts`, `supabase/functions/_shared/agent-work/policy.test.ts`, `supabase/functions/_shared/agent-work/repository.ts`, and `supabase/functions/agent-work-items/index.test.ts`
- allowed process/evidence surfaces: `AGENTS.md`, `README.md`, `docs/ai/codex-agent-alignment.md`, `docs/ai/repo-tech-agents-skills-workflow-memo.md`, `docs/ops/agent-work-ledger-caller-adoption.md`, this handoff, and WIN-275 adoption attestations
- unchanged non-goals: no migration, route implementation, runtime activation, generic intake, scheduler, provider, hosted, retention-deletion, or clinical-authority change
- stop conditions: any need to change the capability model, Edge authorization implementation, migration/RLS/grants, workflow graph, queue/effect semantics, hosted configuration, or a mode beyond `disabled|shadow|advisory`

## Local Architecture

- complete Dockerized Supabase supplied the fresh Postgres, Auth, Edge Runtime, Queue, and supporting local services
- application, Deno, Vitest, Cypress, and contract commands ran on the host against only the local stack
- inherited hosted Supabase variables were removed from each local process; no `.env*` file was read or modified
- fixtures, logs, and exported contract artifacts were synthetic and PHI-free; no external model provider was contacted

## TDD And Verification Evidence

- specialist audit provenance: specification `019fd851-e2aa-74d3-b6ed-6cd1dad626ac`, architecture `019fd851-e3e8-7142-870e-49249d5c95ad`, documentation `019fd851-e6a6-78e3-9360-e3bcac38ae53`, security `019fd851-e957-7ff2-920d-c5173662844d`, Supabase `019fd851-ecb3-7e60-8eaf-7dbae4b8b78d`, and test `019fd851-efbf-7ab3-94d5-41e403616038`
- baseline: `npm test -- --run src/lib/__tests__/agent-work-ledger.test.ts tests/agentWorkLedgerHostedShadowProof.test.ts` passed `48/48`
- IEHP RED/GREEN: the focused suite first failed for the absent helper/control, then `npx vitest run src/lib/__tests__/agent-work-ledger.test.ts src/components/__tests__/IehpFbaLayoutReview.test.tsx` passed; after the capability and mode-neutral-copy review findings, RED was `1/25` then `2/25` failing and GREEN was `38/38`
- shared policy RED/GREEN: cast `active` initially reached the permitted-mode path; `deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts` then passed `18/18` with the closed runtime set
- route adapter RED/GREEN: the new route test initially expected the internal unsupported-mode reason while the adapter correctly normalized it to fail-closed `runtime_mode_disabled`; after aligning to the exposed contract, `deno test --no-lock supabase/functions/agent-work-items/index.test.ts` passed `33/33` with zero create calls
- focused Vitest: Ledger helper/UI/caller/security/retention selection passed `167/167`
- Deno core: policy, item service, runner, chaos, and sweeper selection passed `89/89` before the additional route test; generate-program-goals tests passed `33/33` with environment permission explicitly granted and no provider call
- `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed
- fresh `npm run agent-work:db:reset` applied all local migrations; security contract, Edge smoke, and queue/scheduler smoke passed
- `npm run test:agent-work:chaos` passed all `10/10` scenarios and seven deterministic crash points
- `npm run agent-work:shadow-parity` passed `7/7` positive and `7/7` negative cases with zero mismatches
- retention contract passed fail-closed with `365/90/30`, `deletedCount: 0`, and `policy_unapproved`; trace-index contract passed with 20,000 synthetic fixtures, eight indexes, and eleven plans
- `npx vitest run tests/agentWorkLedgerHostedShadowProof.test.ts tests/agentWorkLedgerRetentionPolicyEncodingMigration.test.ts` passed `43/43`
- `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local` passed before sealing in `355.2s` and again against the final hash-bound state in `356.8s`, including focused policy, lint, typecheck, the full Vitest/coverage suite, coverage verification, build, and Tier-0 browser gate `220/220`
- `npm run ci:playwright:env-readiness` exited normally and produced a sanitized `fail` readiness result because no hosted target, personas, or keys were supplied; the hosted-auth browser command was therefore intentionally not run

## Review Findings And Dispositions

- code review found no implementation defect and requested complete evidence; this handoff and verification card provide it
- security, architecture, and Supabase review found the missing manage-capability boundary; the control now defaults fail-closed and receives the existing server-backed `canManageProgramsGoals` capability
- Supabase review also found shadow/advisory wording conflated; new mutation control copy is mode-neutral
- test review requested route-level future-mode denial; the public adapter now proves a `403`, normalized disabled reason, and zero creation
- documentation review requested exact commands and outcomes; they are recorded above
- final exact-diff review sessions: code `019fd88c-289d-7523-8eb5-e5406fbb41f9`, security `019fd88c-29dd-72a3-be85-702d94a77367`, test `019fd88c-2b7a-79b0-a88e-4a314230965b`, Supabase `019fd88c-2dbc-7670-befc-c0e03ee0d200`, architecture `019fd88c-3126-75f1-868b-029e631775cb`, and documentation `019fd88c-3530-7662-a540-760fc668e41d`
- security, Supabase, architecture, and documentation returned PASS; code requested the expected manifest sealing, and test requested explicit required-but-blocked auth-browser evidence plus the complete allowed-file set; both corrections were incorporated and their final re-reviews also returned PASS

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: authenticated application caller, protected shared runtime policy, tests, engineering boundary documentation, and attestation evidence
- required checks: focused Vitest and Deno TDD commands; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `npm run test:routes:tier0`; `npm run ci:playwright`; fresh `npm run agent-work:db:reset`; security, Edge, queue/scheduler, chaos, parity, retention, and trace-index contracts; specialist review; `pr-hygiene`
- executed checks: all required local and secret-free commands listed above passed, including two complete `npm run verify:local` runs and `npm run test:routes:tier0` at `220/220`
- blocked checks: `npm run ci:playwright` was fail-closed by `npm run ci:playwright:env-readiness` because this local-only slice intentionally supplied no hosted URL, credentials, or personas
- result: `pass-with-blocked-checks`; this is not a claim that hosted auth-browser coverage ran, and hosted action remains unauthorized
- residual risk: application visibility uses the current manage-programs/goals capability while the Edge route independently revalidates tenant and workflow authority; any future capability-model or runtime-mode expansion requires a new critical-lane slice

## Local Review Readiness

- the diff is isolated to the bounded caller, closed runtime policy, focused tests, engineering documentation, handoff, and attestations
- `deno.lock`, the existing reliability-report drift, the retention branch, and both Task 9 recovery stashes remain outside this change
- GitHub push, PR creation, merge, deployment, hosted migration, hosted function update, and runtime activation are not authorized and were not performed
- PR hygiene: `pr-ready: yes` for local review; `lane: critical`; branch, Linear linkage, single-purpose scope, change summary, verification card, handoff, and six specialist reviews are ready; unrelated changes and generated drift are absent; protected-path changes are expected and hash-bound
- external PR handoff remains intentionally unperformed; a normal-hook local commit and local-stack teardown are the remaining local closure steps

## Local Operator And Responsive Observer Addendum

### Scope And Route

- issue: `WIN-275`
- branch: `codex/local-operator-responsive-observer`
- route: `classification: high-risk human-reviewed`; `lane: critical`
- commits: design/plan `8a24345f`, implementation `71a6a517`, and security/reliability hardening `59cbc580`
- boundaries: local-only synthetic verification; no migration, Edge Function, RPC, RLS/grant, queue semantic, runtime policy, hosted action, provider call, `.env*` read, PHI/customer fixture, `active` mode, or generic engineering-task Ledger authority

### Implementation

- `npm run agent-work:local:operator` is a no-argument wrapper over the existing Phase 2 harness. It rejects caller-selected scope, requires the exact 12-check manifest and cleanup matrix, rereads the persisted manifest, and fails unless it exactly matches the in-memory result.
- `npm run test:ui:responsive -- --base-url=http://127.0.0.1:<port> --route=/affected-route` requires an explicit loopback HTTP port and explicit routes, then observes desktop `1440x900` and mobile `390x844` in ephemeral Chromium contexts.
- the observer blocks non-read methods and external origins, records no storage/HAR/trace/video or network bodies, persists only opaque SHA-256 route identities, and applies layout redaction after measurement and before screenshot capture so text, carets, media, SVG/canvas content, and background imagery cannot enter retained images
- visible changes under `src/components/**`, `src/pages/**`, or shared styling/config now require observer evidence before `verify-change`; Computer inspection remains supplemental and non-gating

### TDD And Local Evidence

- RED: both initial contract suites failed import resolution because the operator and observer modules did not exist
- GREEN: focused unit and real-browser suites pass `31/31`, including local URL/port rejection, traversal rejection, dynamic-route collision resistance, persisted-manifest mismatch denial, both fixed viewports, non-interactive label exclusion, artifact writes, and same-origin mutation blocking
- first real observer run exposed an esbuild helper inside `page.evaluate`; the closure-free browser function fixed it, and a serialization guard plus real-browser test now cover the path
- final synthetic observer command passed both viewports with opaque route ID `sha256:3273d98374f4350996fba67c4ca60b59443ce929bbcdcaba0f11406c06c3aed9`
- redacted desktop screenshot hash: `sha256:e39f5cd16a12e96b0b0157ddc9920741acb317eba2a163bebe3a4349e097c670`
- redacted mobile screenshot hash: `sha256:be98ac31e75b35b1eefc03bd6abc1be96c33e8e466981c0047165f85623ec666`
- exact-head operator run `20260806T222344Z-1200d5` passed all 12 checks and cleanup from commit `59cbc580ac63d4a14700af7244ef453fc9d6378e` in `612455ms`; image `sha256:5e7b2edbdb5ef0c5f1237194d33dfb1a1120f4cb0d9a5f933477b77914cb7979`; summary hash `1de2f4c29b4ead32eb09e2369ad9b1d31c3f1299f15bd13e43b88063e8744810`; check-evidence hash `1822ea4d6cf7e9f00a48413b152cde9751999b0df38d5eee2893092ca0d59be2`
- policy, lint, typecheck, build, and focused verification pass; the first full `test:ci` run reached `4074` passes and failed only the two expected protected-doc hash checks pending this additive attestation refresh

### Review Dispositions

- initial code/test/Supabase reviews found generic labeled containers incorrectly counted as touch targets and missing runner-level proof; selectors now include only semantic interactive controls and the real loopback browser suite covers both viewports, request blocking, and artifact emission
- architecture/security reviews found raw screenshots, raw route text, possible redacted-path collision, and in-memory-only operator validation; screenshots are now layout-redacted, route identity is hash-only, paths are collision-resistant, fatal output is schema-stable, and the persisted manifest must exactly match
- the existing adoption, retention, and hosted-shadow attestations remain predecessor evidence; this addendum uses a new supplemental local-operator/observer attestation and only refreshes the rolling protected-surface pointers required by existing contract tests
