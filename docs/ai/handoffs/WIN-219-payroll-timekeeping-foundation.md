# WIN-219 Payroll Timekeeping Foundation Handoff

- Date: 2026-08-11
- Linear issue: `WIN-219` (reused and updated per owner direction)
- Branch: `codex/payroll-timekeeping-design`
- Plan: `docs/superpowers/plans/2026-08-11-payroll-grade-timekeeping.md`

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: this slice adds tenant-scoped payroll tables, RLS, grants, security-definer RPCs, append-only source records, and generated database types.
- triggering paths: `supabase/migrations/**`, payroll RPC/RLS surfaces, and `src/lib/generated/database.types.ts`

## Scope

- task intent: establish the default-disabled, provider-neutral payroll timekeeping foundation with separate payroll and insurance/audit attendance clocks.
- allowed behavior: self payroll clocking; assigned session attendance by the employee or an explicitly capable scheduler/admin; self correction requests; manager review visibility; explicit payroll-admin compensation access.
- non-goals: UI, automatic payroll time from sessions, automatic clock-out, payroll calculation/export execution, hosted activation, deployment, or merge.
- single-purpose diff: yes

## Required Agents

- required sequence: specification, architecture, implementation, code review, test, security, and Supabase review
- agents used: all required roles, including scoped fix re-reviews
- reviewer: completed; final code, security, Supabase, and test verdicts have no open Critical or Important finding

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation, RPC exposure, TypeScript contracts, generated database types, and local security harness
- required checks:
  - focused payroll contract tests
  - exact-loopback Postgres security contract
  - fresh local Supabase reset
  - `npm run ci:check-focused`
  - `npm run lint -- --quiet`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - focused payroll Vitest set: pass, 6 files / 37 tests
  - exact-loopback `PAYROLL_LOCAL_DATABASE_URL` with `node scripts/payroll-timekeeping-security-contract.mjs`: pass
  - `npx supabase db reset --local`: pass; exact-loopback security contract also passed immediately after reset
  - `npm run ci:check-focused`: pass
  - `npm run lint -- --quiet`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass; line-ending notices only
  - `npm run test:ci`: fail outside the payroll slice during AI transcription tests and aggregate coverage execution
  - `npm run verify:local`: fail because its `test:ci` phase hits the same unrelated failures
  - post-rebase focused payroll Vitest set, exact-loopback security contract, `npm run ci:check-focused`, `npm run validate:tenant`, and `npm run build`: pass on rebased head
- blocked checks:
  - `npm run test:ci`: unrelated AI documentation transcription attempts receive `ECONNREFUSED`; a coverage worker then exhausts a 4 GB heap and closes its IPC channel
  - `npm run verify:local`: blocked by the same `test:ci` failure before later umbrella steps run
- checks not applicable:
  - `npm run test:routes:tier0`: no UI, auth, routing, login, or user-facing route behavior changed
  - `npm run ci:playwright`: no browser/auth/session route behavior changed
  - responsive UI observer: no visible UI files changed
- result: `pass-with-blocked-checks`
- residual risk: repository-wide coverage remains unstable locally; critical-lane human review and required CI are still mandatory before merge.

## PR Hygiene

- branch-ready: yes; four focused commits are rebased onto current `origin/main`
- linear-ready: yes; `WIN-219` is In Progress with current scope, review, and verification comments
- protected-path drift: expected migration/RLS/RPC changes only
- unrelated changes: none identified
- generated artifact drift: none; database types were regenerated from the clean local schema
- verification summary: present
- pr-ready: yes, with the repository-wide `test:ci` / `verify:local` failure disclosed as a blocked unrelated check
- required follow-up: push and open a critical-lane PR, require human review and CI, and do not merge while required checks or approval are outstanding

## Handoff Summary

Task 1 establishes a default-disabled payroll timekeeping schema and stable RPC boundary while keeping payroll time separate from insurance/audit session attendance. It includes event-effective employment binding, pay-group-scoped locks, append-only corrections, tenant-safe RLS, explicit delegated-attendance authority, and compensation privacy. Focused tests, clean reset, executable local security proof, policy, lint, typecheck, tenant validation, and build pass; the unrelated repository-wide coverage failure remains explicitly blocked for CI/human review.

## Task 2E-B Progress

- Date: 2026-08-12
- Slice: protected session-context transport for `payroll-time-events`
- Scope: `supabase/functions/payroll-time-events/index.ts`, `src/server/api/payroll-time-events.ts`, `src/features/payroll/api.ts`, focused tests, and this handoff/progress note
- Behavior added:
  - extends the action union with only `{ action: 'get_session_context', sessionId: uuid }`
  - invokes `get_session_payroll_context(session_id)` under the authenticated caller in both the Edge function and the local caller-JWT server path
  - rejects raw authority request fields such as organization, user, actor, employment, shift, timezone, and canonical location fields before schema stripping
  - validates the context response strictly and fails closed on drift
  - adds `fetchSessionPayrollContext(sessionId)` with request-body minimalism and exact nullable-field parsing
- Verification:
  - `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`: pass
  - `npx vitest run src/server/__tests__/payrollTimeEventsHandler.test.ts --reporter=dot`: pass
  - `npx vitest run src/features/payroll/__tests__/api.test.ts --reporter=dot`: pass
  - `npx vitest run tests/api-convergence-boundary-exceptions.test.ts tests/payroll-timekeeping-security-runner.test.ts tests/payroll-session-lifecycle-context-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts src/server/__tests__/payrollTimeEventsHandler.test.ts src/features/payroll/__tests__/api.test.ts --reporter=dot`: pass, 50 tests
  - `npm run ci:check-focused`: pass on 2026-08-12; DB/CI-backed probes skipped as documented by the script
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:ci`: blocked by repository-wide coverage heap exhaustion after broad suite progress; process terminates with Node out-of-memory and `ERR_IPC_CHANNEL_CLOSED`
  - `npm run verify:local`: blocked by the same `test:ci` heap exhaustion in its umbrella run
- Residual risk: the bounded payroll transport slice is green in focused coverage, but exact-head critical-lane closure still depends on CI or an environment-adjusted repo-wide coverage run that avoids the existing local heap failure.

## Task 2E-C1 Progress

- Date: 2026-08-12
- Slice: session attendance domain orchestration for payroll lifecycle capture
- Scope: `src/features/scheduling/domain/sessionPayrollLifecycle.ts`, `src/features/payroll/outbox.ts`, `src/features/payroll/usePayrollTime.ts`, `src/features/scheduling/domain/sessionStart.ts`, `src/features/scheduling/domain/sessionComplete.ts`, focused tests, and this handoff/progress note
- Behavior added:
  - fetches protected payroll session context before every start or close orchestration step and uses only canonical timezone/work-location fields from that context
  - discovers and reuses retained `session_started` and `session_ended` rows by exact scoped `sessionId` plus `eventType`, preserving the original `occurredAt` across retry or reload
  - returns an explicit `clock_choice_required` preparation only for the assigned employee without an active shift; delegated attendance never offers clock-in
  - keeps start execution fail-closed: `clock_in` records `shift_started` with its own stable key, confirms it, refetches context for the authoritative shift link, then records retained `session_started`; `active`, `delegated`, and `continue_without_clock_in` record retained attendance first and never invoke clinical start until attendance is confirmed
  - preserves retained attendance rows on clinical failure, clears the exact retained row only after compatible clinical success, and keeps `ALREADY_STARTED` compatible with existing clinical start behavior
  - adds org-scoped exact terminal-status revalidation for close orchestration so `ALREADY_TERMINAL` clears retained `session_ended` only when the stored session status exactly matches the requested `completed` or `no-show` outcome
  - never emits `shift_ended` from session start or close orchestration
- Verification:
  - `npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/outbox.test.ts src/features/payroll/__tests__/usePayrollTime.test.tsx src/features/scheduling/domain/__tests__/sessionStart.test.ts src/features/scheduling/domain/__tests__/sessionComplete.test.ts src/features/scheduling/domain/__tests__/sessionPayrollLifecycle.test.ts --reporter=dot`: pass, 61 tests
  - `npm run ci:check-focused`: pass on 2026-08-12; DB/CI-backed probes skipped as documented by the script
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: not run by explicit user instruction to avoid broad runs; still required for full critical-lane closure
  - `npm run test:routes:tier0`: not run by explicit user instruction to avoid browser runs; still required for full auth/session flow closure
  - `npm run ci:playwright`: not run by explicit user instruction to avoid browser runs; still required for full auth/session flow closure
  - `npm run verify:local`: not run because it would widen to blocked broad/browser checks for this bounded slice
- Residual risk: the bounded orchestration slice is green in focused coverage and non-browser verification, but critical-lane closure still depends on the broader `test:ci`, `test:routes:tier0`, `ci:playwright`, `verify:local`, reviewer, and human review gates outside this local implementation pass.

## Task 2 Capture Closure

- Date: 2026-08-12
- Branch: `codex/payroll-timekeeping-capture`
- Slice: employee payroll clock, session attendance integration, offline replay, and protected capture transport
- Linear issue: `WIN-219` reused per owner direction

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: UI/session lifecycle, server/API/Edge transport, tenant-scoped RPC integration, IndexedDB outbox, and local database contract proof
- required checks:
  - focused payroll API/outbox/lifecycle/server/browser tests
  - loopback PostgreSQL migration/RLS/runtime tests
  - Edge Deno tests
  - responsive observer at desktop `1440x900` and mobile `390x844` for `/time` and `/schedule`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
- executed checks:
  - focused payroll API/outbox/lifecycle/server tests: pass, 4 files / 91 tests
  - native IndexedDB offline/reconnect browser proof: pass, 2 tests
  - responsive observer runtime: pass, 15 tests; mutation actions remain fail-closed
  - loopback PostgreSQL migration/RLS/runtime contract: pass, 4 files / 45 tests, including minimal attendance payload with server-derived shift, timezone, and work location
  - `deno test --allow-env --allow-net supabase/functions/payroll-time-events/index.test.ts`: pass, 15 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: pass, 499 files / 4,346 tests; 11 environment-gated skips
  - `npm run ci:verify-coverage`: pass, 92.87% line coverage against 86% requirement
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 228/228
  - `/time` responsive observer: pass at `1440x900` and `390x844`
  - `/schedule` responsive observer: pass at `1440x900` and `390x844` on the warmed local server
  - `git diff --check`: pass; line-ending notices only
- blocked checks:
  - `npm run ci:playwright`: missing `PW_SUPERADMIN_*` or `PW_ADMIN_*` credential pair; no `.env` files were read
- result: `pass-with-blocked-checks`
- residual risk: critical-lane human review and CI remain mandatory; the credential-backed auth/session Playwright gate must run in CI or an approved credentialed environment before merge.

### PR Hygiene

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; dedicated `codex/` branch
- linear-ready: yes; existing `WIN-219` linkage is authoritative
- single-purpose: yes; capture, attendance, offline replay, and their protected transport contract
- unrelated changes: none
- generated artifact drift: none; transient `deno.lock` and reliability timestamp changes were excluded
- protected-path drift: expected `src/server/**` and `supabase/functions/**` changes only; no new migration or grant widening
- change summary: present
- verification summary: present
- reviewer: code, security, and Supabase re-reviews approve with no open findings
- required follow-up: push, open the critical-lane PR, run required CI, and obtain human review; do not merge or deploy autonomously

### Handoff Summary

Task 2 delivers separate payroll and insurance/audit clocks without allowing session close to end paid time. Live attendance transport is strict and minimal, server authority derives employment/shift/timezone/location, legacy outbox rows are canonicalized only during recovery, non-retryable events stop in `needs_attention`, and a pending attendance row is deferred until clock-in is confirmed. Full local coverage, build, tenant, route, Edge, responsive, browser-offline, and loopback database gates pass; only the credential-backed `ci:playwright` gate remains blocked locally.

## Task 3 Derivation Closeout

- Date: 2026-08-12
- Slice: California derivation, immutable timesheet snapshots, protected snapshot transport, and additive `/time` period review
- Status: `REVIEW_READY`

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: migration/RLS/RPC, protected server/Edge transport, generated database types, visible `/time` review UI, and protected CI/deploy policy
- required checks:
  - focused calculation, migration, client, UI, server, Edge, CI-policy, and loopback database tests
  - clean local database reset and local type generation
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - responsive `/time` observation at `1440x900` and `390x844`
  - `npm run verify:local`
- executed checks:
  - witnessed RED: `npm test -- --run tests/payroll-california-calculation.test.ts tests/payroll-timesheet-snapshot-migration.test.ts`
  - `deno test --no-check --allow-env supabase/functions/payroll-timesheets/index.test.ts`: pass, 5 tests
  - focused calculation, migration, client, UI, server, Edge-contract, and CI-policy suite: pass, 196 tests
  - exact-loopback `tests/payroll-timesheet-snapshot-rpc.test.ts`: pass, 21 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npx supabase db reset --local --yes`: pass after the Task 3 migration runtime fixes
  - `npm run typegen:local`: pass
  - rollback-only authenticated runtime/EXPLAIN sweep: pass at 0/50/200/500 rows; artifact `reports/evidence/payroll-timesheet-derive-contract-1f-2026-08-12T10-43-09-419Z.json`
  - final aggregate `npm run verify:local` with process-local 8 GB heap: pass end to end in 535 seconds
  - final aggregate `npm run test:ci`: pass, 506 files and 4424 tests; 32 environment-gated skips
  - final aggregate `npm run ci:verify-coverage`: pass, 92.87% line coverage
  - final aggregate `npm run build`: pass
  - final aggregate `npm run test:routes:tier0`: pass, 228 tests
  - refreshed responsive `/time` observation: pass at desktop `1440x900` and mobile `390x844`
  - six independent repaired-diff reviews: approved by code, architecture, security, Supabase, test, and DevOps specialists
  - prior failed aggregate diagnosis: stale report/artifact reference corrected; unrelated `ProgramsGoalsTab` timeout passed in isolation at 116/116 and in the final aggregate
- blocked checks:
  - `npm run ci:playwright`: blocked locally by missing approved `PW_SUPERADMIN_*` or `PW_ADMIN_*` credential pair; no `.env*` file was read
- result: `pass-with-blocked-checks`
- residual risk: credentialed auth/session browser coverage, hosted migration parity, and hosted deployment were not exercised; payroll/legal and human critical-lane review remain mandatory, and activation remains a separate explicit manual dispatch
- runtime defects fixed from local proof:
  - transport/SQL signature convergence on `selected_local_date` and `p_idempotency_key`
  - invalid nested window/aggregate SQL in worked-seconds calculation
  - server-owned pay-period resolution for non-Sunday weekly and biweekly groups
  - structured blocked derivation transport/UI handling
  - feature-disabled, unsupported-jurisdiction, and monthly fail-closed behavior
  - raw self-rate omission while preserving own gross review
  - transaction-level source/config locking and non-callable lock helpers
  - append-only snapshot supersession, short-shift open-meal integrity, and DST-safe boundaries

### PR Hygiene

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; `codex/payroll-timekeeping-derivation`
- linear-ready: yes; existing `WIN-219` linkage is reused and will be updated rather than creating another issue
- single-purpose: yes; California ordinary nonexempt derivation, immutable snapshots, protected transport, review UI, and its required deploy governance
- unrelated changes: none; transient `deno.lock` and reliability timestamp drift were excluded
- generated artifact drift: none; database types and the single sanitized performance artifact match their source contracts
- protected-path drift: expected migration, `src/server/**`, Edge, Netlify, and workflow changes; critical lane and mandatory human review are retained
- change summary: present
- verification summary: present
- pr handoff: ready for a stacked PR against the Task 2 capture branch
- reviewer: six independent specialist reviews approved the repaired live diff
- required follow-up: push, open the PR, update `WIN-219` to In Review, inspect live required checks, and stop for human/payroll/legal review; do not merge, deploy, or activate autonomously

### Handoff Summary

Task 3 adds the bounded California ordinary nonexempt derivation layer, immutable snapshot persistence, protected `payroll-timesheets` transport, and a self `/time` period-review surface that can create immutable review snapshots but cannot submit, approve, lock, or export. The repair round moved all pay-period and authority decisions to the database, preserved structured fail-closed outcomes, restored compensation privacy, serialized canonical snapshot inputs safely, and restricted deployment to a separate explicit manual activation. Clean local schema, focused, loopback, policy, tenant, type, performance, responsive, aggregate, and six-specialist review proofs pass. The slice is PR-ready with credentialed `ci:playwright` disclosed as the sole local blocked check; human critical-lane and payroll/legal review remain mandatory before merge or activation.
