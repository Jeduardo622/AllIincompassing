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

## Integrated Stack Summary

- Task 1 foundation established the default-disabled payroll schema, tenant-safe RLS/grants/RPC boundary, append-only source records, and generated-type contract.
- Task 2E-B and 2E-C1 added protected payroll day/session-context transport plus fail-closed session lifecycle orchestration before the broader Task 2 capture closure.
- Task 2 capture delivered the `/time` payroll clock, separate session attendance, offline replay, and protected capture transport without letting session close end paid time.
- Task 3 derivation delivered California ordinary nonexempt calculation, immutable timesheet snapshots, protected `payroll-timesheets` transport, additive `/time` review UI, and the exact-head UTC and tenant-safety workflow repairs needed to keep the slice green at current `main`.
- Task 4 delivered approval workflow authority, protected approval transport, payroll administration/read models, `/payroll` and `/time/review` UI, and the bounded migration dependency governance follow-through.
- Task 5 delivered provider-neutral export, immutable CSV/export ledger behavior, cumulative adjustments, protected export transport, and explicit manual deploy governance while keeping hosted migration, deployment, activation, and merge out of scope.
- Local evidence across the integrated stack includes focused Vitest/Deno suites, loopback SQL/RPC/RLS proof, responsive `/time` `/schedule` `/time/review` `/payroll` evidence, aggregate `test:ci`/coverage/build/tier-0 reruns where documented, and exact local blocked-check caveats for missing credentialed `ci:playwright`.
- Hosted deployment, hosted activation, and production rollout were not performed; activation remains a separate explicit manual dispatch after critical-lane human review, CI, and payroll/legal approval.

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

### Exact-Head Tenant-Safety Capacity Repair

- Live failure evidence: GitHub Actions run `31591082941` failed twice in `tenant-safety` only after tenant validation, lint, and typecheck passed; the unmasked full test process exhausted the configured 6144 MB V8 heap.
- Bounded repair: only `.github/workflows/tenant-safety.yml` changes from 6144 MB to 8192 MB for `Run tests`; `ci.yml` and `supabase-validate.yml` remain at 6144 MB.
- Contract coverage: `tests/workflows/ci-test-memory.test.ts` now pins the explicit per-workflow values and prevents accidental global heap drift.
- Witnessed TDD: the workflow contract failed while tenant-safety remained at 6144 MB, then passed after the one-line workflow repair.
- Focused verification: workflow/policy regression suite passed 4 files and 154 tests; `npm run ci:check-focused`, `npm run lint`, and `npm run typecheck` passed.
- Aggregate verification: process-local 8 GB `npm run verify:local` passed end to end in 477.7 seconds, including policy, lint, typecheck, full coverage tests, build, and 228/228 tier-0 routes.
- Independent review: code, security, and DevOps reviewers returned `APPROVED` with no findings.
- Tracking: existing issue `WIN-219` remains authoritative; its linkage plus status/comment updates satisfies the critical-lane Linear requirement, and no new issue creation will be attempted.
- Residual risk: exact-head GitHub `tenant-safety` must prove that the hosted runner has sufficient total memory headroom; human critical-lane review remains mandatory.

#### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: CI/workflow/policy capacity repair
- files touched: `.github/workflows/tenant-safety.yml`, `tests/workflows/ci-test-memory.test.ts`, and the existing Task 3 tracking artifacts
- required agents: specification, architecture, test, implementation, code review, security review, and DevOps review
- required checks: direct workflow contract test; focused CI-policy tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`
- executed checks: witnessed workflow-contract RED then GREEN; focused CI-policy suite 154/154; policy, lint, and typecheck passed; the 477.7-second `verify:local` run passed full tests, coverage, build, and 228/228 tier-0 routes
- blocked checks: none for this heap-only workflow repair; the broader Task 3 credentialed `ci:playwright` block remains separately disclosed above
- reviewer: independent code, security, and DevOps reviews completed with `APPROVED`
- result: `pass`
- residual risk: only exact-head hosted runner execution can prove total runner memory headroom

#### PR Hygiene

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; isolated `codex/payroll-timekeeping-derivation` branch and existing PR #926
- linear-ready: yes; existing `WIN-219` linkage plus status/comment updates
- single-purpose: yes; one failing workflow receives a bounded capacity increase with an explicit regression contract
- unrelated changes: none
- generated artifact drift: none; the transient reliability timestamp was removed
- protected-path drift: expected `.github/workflows/tenant-safety.yml` change only, with the critical lane retained
- change summary: present
- verification summary: present
- pr handoff: ready after commit and push; exact-head required checks must rerun
- reviewer: completed
- required follow-up: commit, push, update WIN-219, poll exact-head checks on the bounded schedule, and stop for human review without merging or activating

### Exact-Head UTC Timezone Repair

- Hosted evidence: tenant-safety run `31593685514` completed the full suite at 8192 MB without OOM, proving the capacity repair, then reported 4423 passed, 32 skipped, and one failed `/time` assertion.
- Root cause: the page described timestamps as employment-local but `formatTimestamp` omitted the `Intl` `timeZone`, so the same `2026-08-11T16:00:00Z` event rendered as `9:00 AM` on a Pacific machine and `4:00 PM` on the UTC GitHub runner.
- Reproduction: `Time.test.tsx` failed 1/13 with `TZ=UTC` and passed 13/13 with `TZ=America/Los_Angeles` before the fix.
- Bounded repair: day/current/history timestamps use protected-bootstrap `employmentTimezone`; period-review timestamps use event timezone with period timezone fallback.
- Focused verification: post-fix `TZ=UTC` and `TZ=America/Los_Angeles` runs both passed 13/13; full lint, typecheck, and build passed.
- Responsive verification: the fixed PHI-free `payroll-time` scenario passed `/time` at desktop `1440x900` and mobile `390x844` with no failure codes.
- Independent review: code and security reviewers returned `APPROVED` with no blocking findings.
- Aggregate verification: fresh 8 GB `verify:local` passed policy, lint, typecheck, the full 4424-test coverage suite, 92.87% line coverage, and build. Tier-0 was interrupted only by a verified orphan Vite preview from this worktree on port 4173; after stopping that exact listener, the isolated gate passed 228/228.
- verification result: `pass`; exact-head hosted tenant-safety remains the final runner gate after push.
- tracking: `WIN-219` remains the issue of record; no new Linear issue will be created.

### Migration Dependency Governance

- A Task 4 Supabase audit found that the snapshot migration header named `20260812113000_payroll_session_lifecycle_context_disabled_state.sql`, which sorts after the snapshot migration and cannot be a valid replay dependency.
- The snapshot SQL consumes attendance and correction tables established by `20260811214856_payroll_timekeeping_capture_read_model.sql` and does not consume objects added by either later session-context migration.
- The dependency header now names the capture read-model migration. No runtime SQL, migration filename, hosted state, or activation behavior changed.
### Task 4 Approval Authority Checkpoint

- Branch: `codex/payroll-timekeeping-approval`; database head: `ca0bc55b`.
- Authority: immutable canonical snapshot hashes, append-only employee submission/manager decision/payroll lock transitions, append-only blocker resolutions, exact effective manager assignment, explicit payroll grants, no self approval, and actor-bound authenticated RPCs.
- Locking: current per-employee approval state is authoritative; shared `pay_periods.locked_at` is not mutated. Existing `exported_at` remains a fail-closed compatibility guard until Task 5 owns export authority.
- Verification: clean local reset/typegen; 46/46 real loopback, migration, and RLS contracts; policy, tenant validation, typecheck, build; 8 GB aggregate `test:ci` with 507 files and 4,436 tests passed, 37 environment-gated skips.
- Review: code, security, Supabase, test, and performance reviewers approved the fix range after one complete critical finding batch.
- State: database checkpoint complete; protected approval transport is the next bounded checkpoint. No hosted migration, deploy, activation, merge, or export work occurred.

### Task 4 Protected Approval Transport

- Head: `45827440`; exact API: `POST /api/payroll-approvals`.
- Actions: employee submit, assigned-manager approve/return, payroll-admin lock/reopen, and payroll-admin snapshot-bound blocker resolution.
- Boundary: caller JWT only; recursive authority-field rejection; strict request and response schemas; exact authoritative idempotency echo; equivalent Node/Edge typed errors; direct Edge actor rate limiting; no raw compensation fields.
- Verification: client/server/static 55/55, Edge 15/15, approval RPC 15/15, snapshot RPC 21/21, policy, lint, typecheck, tenant validation, build, and tier-0 routes 228/228.
- Review: code, security, and DevOps reviewers approved after three bounded fix rounds.
- State: transport checkpoint complete. Manager/payroll-administration read models and UI remain Task 4 work. Credentialed `ci:playwright` remains locally blocked; no hosted migration, deployment, activation, merge, PHI, customer data, secrets, or `.env*` access occurred.

### Task 4 Approval, Administration, And Review Closure

- Branch: `codex/payroll-timekeeping-approval`; local head: `42b6e4e3` before this handoff-only commit.
- Workflow: employee submission, assigned-manager approve/return, payroll-admin blocker resolution, lock, and reopen are bound to immutable current snapshots with proactive invalidation on reviewable source changes.
- Administration: effective-dated organization settings, weekly/biweekly pay groups, California monthly fail-closed behavior, one base hourly rate, employment/manager assignment, sanitized audit history, and explicit compensation visibility are exposed through protected read/write contracts.
- UI: `/time/review` provides employee and assigned-manager review; `/payroll` provides payroll administration without export controls until Task 5. `/payroll` is routed only to `admin` and `super_admin`.
- Contract repair: additive migration `20260812212854_payroll_timesheet_period_contract_repair.sql` restores the canonical nested period response while preserving selected-date settings, deterministic organization-first policy precedence, `SECURITY DEFINER`, empty `search_path`, and tenant-scoped source reads.
- Local database proof: clean migration stack; administration RPC 19/19; approval workflow RPC 24/24; review read models RPC 13/13; migration/static contract 20/20. Database-backed suites were run as isolated processes because they intentionally share one local Supabase database.
- Aggregate proof: 8 GB `npm run verify:local` passed policy, lint, typecheck, full coverage tests, coverage thresholds, build, and 244/244 Tier-0 routes. `npm run validate:tenant` passed. Coverage summary: 92.96% lines/statements, 98.75% functions, and 84.75% branches.
- Responsive proof: `/payroll`, `/time`, and `/time/review` passed the read-only observer at desktop `1440x900` and mobile `390x844`; all six evidence cards have empty failure-code lists and matching on-disk hashes.
- Blocked check: `npm run ci:playwright` stops at the fail-closed preflight because neither `PW_SUPERADMIN_*` nor `PW_ADMIN_*` credential pair is available locally. This remains a required CI/human environment gate.
- Review: code, security, Supabase, UI, test-isolation, and responsive specialists approved the final bounded behavior after policy-precedence and missing-settings classification fixes.
- Final protected-path review: commit `32c26097` adds `payroll-approvals` to auth-parity and manual deploy governance, verifies remote `verify_jwt=true`, requires live immutable-current-main attestation before credentials and immediately before deploy, and returns the shared typed Netlify `internal_error` envelope. DevOps, security, and code re-review found no remaining issue.
- Tracking: existing issue `WIN-219` remains authoritative and was updated with commit and verification evidence. No new issue creation was attempted.
- Boundary: no hosted migration, deployment, activation, merge, production data, PHI, secrets, `.env*` access, taxes, deductions, payments, full payroll engine, or CSV export occurred. Task 5 owns provider-neutral export.

#### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: UI/page; auth/routing; server/API/Edge; database/RLS/migration/tenant isolation
- required checks: focused payroll unit/Edge/RPC tests; clean local migration replay; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; responsive observer for `/payroll`, `/time`, and `/time/review`; `npm run verify:local`
- executed checks: all required local and secret-free checks passed, including the isolated database counts above, six responsive cards, the complete 493.6-second approval gate, and a fresh 485.7-second `verify:local` rerun after the final protected workflow/adapter repair; final coverage is 92.96% lines/statements, 98.75% functions, and 84.75% branches
- blocked checks: `npm run ci:playwright` -> required credential pairs are unavailable; preflight failed closed before browser execution
- result: `pass-with-blocked-checks`
- residual risk: human critical-lane review, exact-head hosted checks, credentialed browser smoke, payroll/legal review, and explicit migration/deploy activation remain mandatory; no merge or activation is authorized

### Task 5 Provider-Neutral Payroll Export

- Branch: `codex/payroll-timekeeping-export`; base: `codex/payroll-timekeeping-approval`; issue: existing `WIN-219`.
- Scope: immutable provider-neutral v1 CSV exports from the complete locked current snapshot population, deterministic SHA-256 checksums, exact persisted emitted rows, idempotent replay, and cumulative delta-only adjustment exports against the immediately prior run.
- Authority: actor and organization derive from `auth.uid()`; create/download require `payroll.export_period`; export-only authority cannot open the broader payroll administration model; ledger tables are forced-RLS and append-only, with direct authenticated and service-role mutations denied.
- Contract: POST returns reconciled totals, checksum, source count, adjustment parent, and export timestamp. The administration read model restores the latest immutable export after reload, while `/time` exposes only initial/adjustment status and timestamp. Session/audit time remains separate and never ends paid time.
- Delivery: strict Node, Netlify, and Supabase Edge adapters; RFC 4180 CRLF CSV with fixed 17-column schema and formula/control-character rejection; deploy workflow remains explicit manual activation, default false, immutable-current-main attested, and remote `verify_jwt=true` checked. No deployment or activation occurred.
- Jurisdiction boundary: California derivation is the only active calculation policy. Existing Texas and Arizona documents remain research-only and inactive. Taxes, deductions, payments, provider-specific formats, and a full payroll engine remain out of scope.
- Database proof: final clean `npx supabase db reset` passed; `tests/payroll-export-ledger-rpc.test.ts` passed 7/7 after reset, including replay, exact CSV persistence, cumulative adjustments, population/blocker/formula/tenant denials, append-only enforcement, full administration payload preservation, export-only administration denial, latest adjustment projection, and employee-safe status.
- Focused proof: 364 transport/UI/deploy-policy tests, 8 canonical adapter tests, 6 Edge tests, final 121 read-model/UI repair tests, full lint/typecheck, tenant validation, policy suite, production build, coverage threshold 92.96%, and Tier-0 routes 244/244 passed.
- Responsive proof: `/payroll` and `/time` passed the sanitized observer at desktop `1440x900` and mobile `390x844`; all final evidence cards have empty failure-code lists. The read-only responsive harness contract passed 2/2 after keeping export mutations fail closed in that fixture.
- Aggregate note: the first default-heap `verify:local` attempt OOMed during full coverage. The 8 GB rerun completed 4,733 passing tests with one Task 5 responsive-harness fixture failure; that fixture was repaired and passed in isolation, after which coverage verification, build, Tier-0, policy, tenant, lint, typecheck, and all Task 5 focused/runtime suites passed. The aggregate result is therefore `pass-with-isolated-rerun`, not a claim that the original umbrella command exited zero.
- Blocked check: `npm run ci:playwright` requires unavailable `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials and remains a required exact-head CI/human-environment gate.
- Review: code, security, Supabase, test, and DevOps specialists reviewed the critical surfaces. Administration payload, latest-adjustment, export-only access, and RPC grant findings were repaired; final code and Supabase re-review returned no findings.
- Boundary: no hosted migration, production deploy, activation, merge, PHI, customer data, secrets, or `.env*` access occurred.

#### Task 5 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: visible UI; server/API/Edge; database/RLS/RPC/migration/tenant isolation; Netlify; CI/workflow policy
- required checks: focused unit/Edge/RPC/workflow tests; clean migration replay; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; responsive `/payroll` and `/time`; `npm run verify:local`
- executed checks: all secret-free checks passed directly or through the documented isolated aggregate repair; final database, tenant, policy, lint, typecheck, build, coverage, Tier-0, Edge, focused, and responsive evidence is green
- blocked checks: `npm run ci:playwright` -> credential pairs unavailable locally; hosted migration/deploy -> intentionally not authorized
- result: `pass-with-blocked-checks`
- residual risk: exact-head hosted CI, credentialed browser smoke, independent human critical-lane review, and payroll/legal review remain mandatory before any merge or explicit activation

### Main Integration Closure

- Branch: `codex/win-219-payroll-main-integration`; base: `origin/main` at `7ddc2ad0`; integration source: `origin/codex/payroll-timekeeping-derivation` at `cffddd5e`; issue: existing `WIN-219`.
- Integrated scope: the complete California-first payroll-grade timekeeping stack, including universal paid shifts, separate optional session/audit attendance, employee and manager review, immutable approvals, payroll administration, provider-neutral CSV export, and inactive Texas/Arizona readiness documentation.
- Final security repairs: `payroll.configure_settings` is enforced through SQL and every transport vocabulary; pay-period generation requires that capability; export generation uses settings effective for the full period and serializes same-key replay; export-only authority remains unable to open the broader administration model. Export totals and `latestExport` are returned only with `payroll.export_period`, including for administrators who can resolve exceptions but cannot export.
- Protected dispatch: manual payroll deployment requires current `main`, exact repository-owner login and numeric identity, personal-owner repository context, the literal approval acknowledgement, full migration parity through `20260813103000_payroll_security_repair`, and successful `auth_browser_smoke` before any payroll deploy job can start.
- Hosted parity bootstrap: production auth parity continues to cover every currently deployed Edge function. The four new payroll functions are listed separately in the policy-restricted pending parity scope because protected deployment is forbidden before merge. Each payroll function must appear exactly once across deployed and pending scopes; unrelated pending entries and duplicates fail policy. After the separate owner activation verifies remote `verify_jwt=true`, a follow-up PR must promote the four entries into `SUPABASE_FUNCTION_PARITY_SCOPE` and clear the pending scope.
- Database proof: two independent clean local resets passed. The administration RPC suite passed 19/19, the export RPC suite passed 9/9, the synthetic payroll security contract passed, and `npm run validate:tenant` passed.
- Aggregate proof: the exact `npm run verify:local` wrapper exited zero before the final export-total redaction repair. On the final state, the same secret-free gates passed serially: the coverage-enabled suite passed 536 files and 4,857 tests with 99 environment-gated skips using inherited `NODE_OPTIONS=--max-old-space-size=12288` and four workers; line coverage is 92.96%; production build passed; and Tier-0 passed 244/244. The higher inherited heap was required because three earlier aggregate attempts exhausted Vitest's default 4 GB child-worker heap without an assertion failure. The five payroll Edge suites passed 68/68.
- Hosted CI capacity follow-through: exact PR head `22960973` passed policy, both tenant-safety jobs, lint/typecheck, startup/session contracts, Supabase Preview, and deployment-preview checks. Its unit job reached the checked-in 6 GB V8 old-space ceiling in one Vitest fork and exited with `FATAL ERROR: Ineffective mark-compacts near heap limit`; the later `ERR_IPC_CHANNEL_CLOSED` was a consequence of that OOM, not an assertion failure. TDD now pins the unit job to the repository's established 8 GB full-suite ceiling; the focused protected workflow suite passes 244/244, followed by policy, lint, and typecheck. New exact-head hosted proof remains required.
- Unrelated hosted browser follow-through: on `22960973`, the first two IEHP import scenarios passed and the generated-DOCX parity scenario hit its 180-second wait boundary with the page closing. No IEHP application surface changed in this integration; the new head reruns that required gate unchanged and must pass before closure.
- Responsive proof: `/time`, `/time/review`, and `/payroll` passed the sanitized observer at desktop `1440x900` and mobile `390x844` with empty failure-code lists.
- Blocked local check: `npm run ci:playwright` failed closed in preflight because neither `PW_SUPERADMIN_*` nor `PW_ADMIN_*` credentials are available locally. No browser mutation ran; exact-head credentialed CI remains required.
- Baseline advisory: database-backed focused policy checking reports existing overlapping permissive policies on `public.profiles`; this integration does not change those policies. Static focused policy checks pass.
- Boundary: no hosted migration, Supabase function deployment, Netlify deployment, production activation, PHI, customer data, secret, or `.env*` access occurred. Human critical-lane review and a separate owner dispatch remain mandatory.

#### Main Integration Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: visible UI; auth/routing; server/API/Edge; database/RLS/RPC/migration/tenant isolation; Netlify; CI/workflow policy; documentation
- required checks: focused payroll and workflow tests; clean migration replay; database RPC suites; payroll security contract; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; responsive observer for `/time`, `/time/review`, and `/payroll`; `npm run verify:local`
- executed checks: all secret-free checks passed, including the clean database counts, the final 58-test export-redaction regression batch, 292 broader focused tests, 68 Edge tests, 4,857 aggregate tests, 92.96% line coverage, lint, typecheck, policy, tenant validation, production build, 244 Tier-0 routes, and six responsive observations. The final aggregate used inherited `NODE_OPTIONS=--max-old-space-size=12288` with four workers so the Vitest children received sufficient heap. The checked-in 8 GB workflow configuration contract was witnessed red/green through `tests/workflows/ci-test-memory.test.ts`; the five-file protected workflow batch passes 244/244, and policy, lint, and typecheck pass after the one-line workflow change. Exact-head hosted CI remains the runtime proof for the OOM repair.
- blocked checks: `npm run ci:playwright` -> required credential pairs are unavailable and preflight failed closed before browser execution; database-connected advisor and grant checks -> no local connection string was configured, while clean local RPC suites passed directly; hosted payroll function auth parity -> explicitly pending until post-merge owner activation; hosted migration/deploy/activation -> intentionally unauthorized
- result: `pass-with-blocked-checks`
- residual risk: exact-head hosted CI must confirm the 8 GB unit ceiling and rerun the credentialed browser gates, including the previously timed-out IEHP generated-DOCX parity scenario; independent human critical-lane review, payroll/legal review, a separate explicit owner activation action, and a post-activation parity-promotion PR remain mandatory

### Pre-Activation Session Lifecycle Compatibility

- Hosted root cause: the credentialed `playwright:session-no-show` gate reached the Start Session action, but the new payroll lifecycle correctly withheld `sessions-start` because protected payroll authority is not activated before merge. The live Edge gateway returned HTTP 404 with exact Supabase `NOT_FOUND` / `Requested function was not found`; the deploy-preview Netlify function used legacy PostgREST authority and returned HTTP 404 with exact `PGRST202` / missing `public.get_session_payroll_context(session_id)`. The production database still lacks the payroll foundation tables by design.
- Bounded repair: authenticated, organization-scoped `get_session_context` requests map only those two exact bootstrap-missing authority responses to the existing `feature_disabled` contract. Clinical start remains independently authorized by `sessions-start`. All other 404s, missing RPCs, malformed responses, authorization failures, and payroll errors continue to fail closed.
- TDD proof: each exact missing-authority test failed with 404 before its implementation. The payroll handler suite now passes 23/23, and the broader payroll API, lifecycle domain, and Playwright lifecycle helper batch passes 106/106. Policy, tenant validation, lint, typecheck, build, and Tier-0 routes passed; the earlier exact 12 GB/four-worker `npm run verify:local` wrapper exited zero in 605.2 seconds with 92.96 percent line coverage and 244/244 Tier-0 routes.
- Independent review: code and security reviewers approved the exact diff with no findings. The security review confirmed normal bearer, organization, and user resolution still precede the remap and that no service-role or cross-tenant data path was introduced.
- Boundary: no Playwright fallback was enabled, no session/audit semantics changed, and no hosted migration, Edge deployment, activation, or customer-data mutation occurred. Exact-head credentialed CI and independent human critical-lane review remain required before merge.

### Hosted Schema Promotion Checkpoint

- Date and authority: on 2026-08-14, the reviewed payroll migration chain from immutable `main` commit `f682c3d7fd0944e8f70d1237b1183fd52fe548d8` was promoted to Supabase project `wnnjeqheqxxyrgsjmygy` under the existing `WIN-219` critical lane. No source migration was edited.
- Hosted ledger: all 13 logical migrations are present exactly once, in dependency order, from `payroll_timekeeping_foundation` through `payroll_security_repair`. Every applied file was reconstructed without truncation and checked against its reviewed SHA-256 hash before submission.
- Fail-closed state: `payroll_timekeeping_v1` has one globally disabled flag; enabled organization overrides, payroll capability grants, active California policy versions, and operational payroll rows are all zero. The foundation seeded only one inactive global California policy version and one four-year retention-policy row for each of the two existing organizations.
- Tenant and privilege proof: all 27 expected payroll/timekeeping tables exist with RLS and forced RLS enabled and at least one policy. The 17 authenticated payroll/timekeeping RPCs are `SECURITY DEFINER` with an empty `search_path` and no anonymous/public execution. Export/admin RPCs deny `service_role`; the five reviewed service-role exceptions are `record_employee_time_event`, `request_time_correction`, `request_session_attendance_correction`, `get_payroll_day`, and `derive_timesheet_snapshot`. Export ledger tables expose no direct anonymous or service-role CRUD privileges.
- Security-repair proof: hosted definitions contain the `payroll.configure_settings` gate, export idempotency advisory lock, full-period effective-settings constraint, and export metadata redaction for actors without `payroll.export_period`.
- Edge boundary: the project contains no payroll, timekeeping, or timesheet Edge function. No production or payroll Netlify deployment, feature enablement, capability grant, workflow dispatch, credential access, PHI access, or customer operational-row mutation occurred; the evidence PR may create its normal docs-only deploy preview.
- Local verification: the focused migration/static suite passed 76 tests with 6 environment skips; `npm run ci:check-focused` and `npm run validate:tenant` passed. A clean local reset was not usable because the existing local Supabase Storage image failed before repository migrations with `StorageBackendError: Migration fix-optimized-search-function not found`; this was classified as local harness drift rather than payroll SQL evidence.
- Hosted advisors: security reported 17 expected authenticated `SECURITY DEFINER` exposure warnings for the intentionally callable RPC surface. Performance reported 80 unindexed payroll foreign keys, 5 RLS init-plan warnings, and 27 unused-index notices on the newly empty tables. The missing-FK-index and RLS-init-plan findings require a separately routed migration before activation; unused-index notices need workload evidence rather than immediate deletion.
- Result: `pass-with-follow-up`; hosted schema promotion is complete and remains inert. The next protected slice is advisor remediation and hosted synthetic tenant/RPC smoke. Edge deployment and owner activation remain separate, explicit authorization boundaries.

### Pre-Activation Manager Assignment Lookup Index

- Branch and scope: `codex/win-219-payroll-manager-index`; one additive index-only migration and one static migration contract test under the existing `WIN-219` critical lane.
- Hosted evidence: `public.employee_manager_assignments` is empty and has no covering btree for exact organization/manager/employment/effective-window authority checks. The existing primary, unique, and no-overlap GiST indexes remain unchanged.
- Index contract: `employee_manager_assignments_org_manager_employment_effective_idx` keys `(organization_id, manager_user_id, employment_profile_id, effective_from desc)` and includes `effective_through`. This optimizes the repeated exact employee-assignment checks and provides only the `(organization_id, manager_user_id)` prefix for the manager-wide capability probe; because that probe does not constrain `employment_profile_id`, its effective-time predicate is not a contiguous btree search condition. A second manager-wide index is deferred until representative workload evidence justifies it.
- TDD proof: the focused test failed 2/3 before the migration existed, then passed 3/3. The broader payroll migration and runtime-parity batch passed 32/32. Policy checks, lint, typecheck, tenant validation, and production build passed.
- Aggregate limitation: two direct `npm run test:ci` attempts and the `npm run verify:local` wrapper reached no reported assertion failure but terminated nonzero in Vitest worker infrastructure: default heap exhausted at about 4 GB, and the 8 GB rerun ended with `Timeout calling onTaskUpdate`. The wrapper independently reproduced the default-heap OOM after policy, lint, and typecheck passed. Exact-head hosted CI remains required.
- Runtime parity: the explicit WIN-219 activation baseline remains through `20260813103000_payroll_security_repair.sql`; the existing diff-based migration parity gate automatically governs this post-promotion performance migration.
- Boundary: no table, policy, RLS, grant, function, trigger, data, Edge function, feature flag, capability, hosted migration, deployment, or activation changed. The unrelated untracked `.codex-remote-attachments/` directory remains untouched.

#### Manager Assignment Index Handoff Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: `supabase/migrations/**` is a protected schema surface; this slice changes a shared authorization lookup access path and requires human review even though it is index-only.
- triggering paths: `supabase/migrations/20260814153000_payroll_manager_assignment_lookup_index.sql`; `tests/payroll-manager-assignment-index-migration.test.ts`; `docs/ai/handoffs/WIN-219-payroll-timekeeping-foundation.md`
- task intent: add one tenant-prefixed covering btree for exact effective manager-assignment authority checks without changing authorization behavior.
- files touched: the three triggering paths above.
- single-purpose diff: `yes`
- linear required: `yes`; existing issue `WIN-219` reused and remains `In Review`.
- blocking conditions: scope widening into policies, RLS, grants, functions, data mutation, CI/workflow policy, hosted apply, Edge deployment, or feature activation; missing human critical-lane review; failing exact-head required CI.
- required agents: `specification-engineer -> software-architect -> security-engineer -> performance-engineer -> test-engineer -> implementation-engineer -> code-review-engineer -> supabase-reviewer`
- agents used: all required agents above; performance, implementation, security, and Supabase review converged on `effective_through` as an included column rather than a search key.
- reviewer: `completed`; code and Supabase re-review returned no findings after the performance-claim and handoff-card repairs.
- required checks: `npx vitest run tests/payroll-manager-assignment-index-migration.test.ts tests/payroll-timekeeping-foundation-migration.test.ts tests/payroll-approval-workflow-migration.test.ts tests/payroll-security-repair-migration.test.ts tests/ci/check-runtime-migration-parity.test.ts`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --cached --check`; exact-head hosted CI; independent human critical-lane review.
- executed checks: focused Vitest batch -> pass, 5 files and 32 tests; `npm run ci:check-focused` -> pass with database-connected checks skipped because no database URL is configured; `npm run lint` -> pass; `npm run typecheck` -> pass; `npm run validate:tenant` -> pass; `npm run build` -> pass; `git diff --cached --check` -> pass.
- blocked checks: `npm run test:ci` -> default worker exhausted the 4 GB heap without a reported assertion failure; `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm run test:ci` -> worker RPC timed out without a reported assertion failure; `npm run verify:local` -> reached `test:ci` and reproduced the default-heap OOM; database-connected focused policy checks -> no database URL configured; hosted migration application -> intentionally unauthorized.
- result: `pass-with-blocked-checks`
- residual risk: exact-head hosted CI, human critical-lane review, and a separately authorized hosted apply are mandatory; immediately before apply, verify the named index is absent or its `pg_indexes.indexdef` exactly matches this migration because `if not exists` can mask name drift, and confirm an acceptable write-blocking window for plain `create index`; planner benefit cannot be measured meaningfully while the hosted table is empty.
- branch-ready: `yes`
- linear-ready: `yes`
- protected-path drift: `none`; the intended migration path is the only protected surface changed.
- unrelated changes: untracked `.codex-remote-attachments/` is excluded and untouched.
- generated artifact drift: `none`
- verification summary: `present`
- pr-ready: `yes`; blocked local aggregate checks are explicit and must be resolved by exact-head CI before merge.
- pr handoff: `ready for commit, push, and WIN-219-linked PR creation; exact-head check status will be attached to the live PR`
- required follow-up: push the isolated branch, open a WIN-219-linked PR, and wait boundedly for required checks; do not merge or apply the hosted migration in this slice.

### Hosted Manager Assignment Index Application

- Date and authority: on 2026-08-14, after PR #947 merged at `db6adb1d07fe656244392652206c84cdc2ea8be3` with all required exact-head checks green, the user separately authorized the hosted apply to Supabase project `wnnjeqheqxxyrgsjmygy` under existing issue `WIN-219`.
- Preflight: the project was `ACTIVE_HEALTHY`; `payroll_security_repair` was present; the new logical migration and index were absent; `public.employee_manager_assignments` had zero rows, occupied 24,576 bytes, and retained enabled plus forced RLS. The empty table made the plain `create index` write-lock window acceptable.
- Apply result: Supabase `apply_migration` succeeded for logical name `payroll_manager_assignment_lookup_index`. The hosted ledger records exactly one row at generated version `20260814164939`.
- Catalog proof: the index is valid, ready, non-unique, non-primary, non-exclusion, non-partial, expression-free, and has four key attributes plus one included attribute. PostgreSQL truncated the overlength requested identifier to the 63-byte catalog name `employee_manager_assignments_org_manager_employment_effective_i`; its definition is `btree (organization_id, manager_user_id, employment_profile_id, effective_from desc) include (effective_through)`. The original overlength identifier remains self-consistent for PostgreSQL lookup and rollback because identifiers are truncated before resolution; no cosmetic rename was performed.
- Tenant and privilege proof: the table remained empty with enabled and forced RLS. The only policy remains `employee_manager_assignments_authenticated_select`; `anon` has no select, `authenticated` retains select, and `authenticated` has no insert, update, or delete privilege. The exact applied SQL was index-only and contained no RLS, policy, grant, RPC, function, feature-flag, or business-data statement.
- Advisor delta: the applying operator's targeted Supabase advisor snapshots returned no security lint for this table before or after apply. Performance results changed from three to two unindexed-FK notices: the organization FK notice cleared, while the composite employment-profile/organization and manager-user FK notices remained. The targeted post-apply snapshot also returned the existing RLS init-plan warning and an expected unused-index notice for the new empty-table index; these are recorded as observed advisor rows, not as a claim that the project-wide advisor surface is otherwise clean. Runtime benefit cannot yet be measured. See the Supabase linter references for [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS init-plan evaluation](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Result: `pass-with-follow-up`; the reviewed index is hosted and inert until manager-assignment rows exist. No Edge deployment, Netlify deployment, payroll feature activation, capability grant, PHI/customer-row access, secret access, or `.env*` access occurred.

#### Hosted Index Application Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering path: `supabase/migrations/20260814153000_payroll_manager_assignment_lookup_index.sql`
- executed checks: merged PR and exact-head CI confirmation; live migration-ledger preflight; exact row count and table-size check; pre/post catalog definition and `pg_index` flags; post-apply RLS, policy, and ACL snapshot; targeted security and performance advisor comparison.
- blocked checks: `explain analyze` as performance proof -> not meaningful on an empty table; representative workload measurement -> no hosted manager-assignment rows exist.
- reviewer: software architecture, security, Supabase, and test preflight agents approved the bounded apply; PR #947 supplied the merged human-reviewed source artifact.
- result: `pass-with-blocked-checks`
- residual risk: future representative workload should confirm planner use; separately route the remaining composite/manager FK notices and RLS init-plan warning rather than broadening this completed index slice.

## Manager Assignment Advisor Remediation PR

- Date: 2026-08-14
- Branch: `codex/win-219-manager-assignment-advisor-remediation`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: add the two exact missing FK-leading btree indexes on `public.employee_manager_assignments`, change only `manager_user_id = auth.uid()` to `manager_user_id = (select auth.uid())` in `employee_manager_assignments_authenticated_select`, and extend the existing WIN-219 runtime-migration parity contract with this migration.
- Non-goals: no hosted migration apply, merge, deployment, payroll activation, capability grant, data mutation, unused-index cleanup, other advisor remediation, PHI/customer-row access, or historical migration edit.

### Hosted Read-Only Preflight

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.
- Hosted migration `20260814164939/payroll_manager_assignment_lookup_index` was present.
- `public.employee_manager_assignments` had `0` rows, a `0`-byte heap, and `32768` total bytes; plain transactional index creation therefore has a small but nonzero write-lock risk.
- RLS was enabled and forced. The table retained one permissive `SELECT` policy for `authenticated`; ACLs remained `authenticated=SELECT` with no authenticated write or anon access.
- The performance advisor returned the two scoped unindexed-FK notices and the scoped `auth_rls_initplan` warning. Security advisors returned no notice for the target table.
- Hosted `pg_constraint`, `pg_index`, `pg_class`, and `pg_indexes` evidence showed no valid/ready index whose leading keys matched `(employment_profile_id, organization_id)` or `(manager_user_id)`. The existing organization-first index remained valid/ready and did not cover either sequence.
- The exact hosted policy predicate still contained the unchanged organization/capability branches and direct `manager_user_id = auth.uid()` evaluation.

### Implementation And Review

- New migration: `20260814172117_payroll_manager_assignment_advisor_remediation.sql`.
- Indexes: `employee_manager_assignments_employment_profile_org_idx` on `(employment_profile_id, organization_id)` and `employee_manager_assignments_manager_user_id_idx` on `(manager_user_id)`; both identifiers are under 63 bytes.
- Policy: one transactional `ALTER POLICY ... USING` preserves policy name, role, command, permissiveness, policy count, grants, enabled/forced RLS, organization gate, manager match, and the `time.review_assigned`, `time.approve_assigned`, and `payroll.configure_employment` branches.
- Runtime parity: the migration identifier is mirrored in `.github/workflows/ci.yml`, `check-runtime-migration-parity.mjs`, and the fail-closed session deploy safety contract without changing dispatch, activation, deployment, or secret behavior.
- Independent specification, architecture, code, security, performance, test, Supabase, and DevOps reviews completed. One fix round added the atomic wrapper, executable rollback guidance, effective-policy tenant/RLS assertion, and explicit runtime-parity inclusion; scoped re-reviews approved every finding.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation and protected CI runtime-migration parity
- required checks:
  - focused manager-assignment advisor remediation migration test
  - existing payroll foundation, approval, security-repair, manager-index, tenant/RLS, and migration-parity tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
  - `git diff --check`
- executed checks:
  - focused RED: pass as test evidence; 3 expected failures proved the migration, two FK indexes, and scalar-subquery policy rewrite were absent
  - focused GREEN after review fixes: pass; 11 files / 303 tests
  - `npm run ci:check-focused`: pass; one new migration validated
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass
  - `npm run test:ci`: fail locally; two runs exhausted the default Node heap after broad test progress, and an 8 GB retry ended on Vitest worker `Timeout calling "onTaskUpdate"`; no application assertion failure was reported
  - `npm run verify:local`: fail at its embedded `npm run test:ci` step with the same local aggregate-runner failure; its preceding policy, lint, and typecheck steps passed
- blocked checks:
  - DB-backed sensitive-table overlap, privileged-function grant, and preview-drift subchecks -> local `SUPABASE_DB_URL`/`DATABASE_URL` was not configured; no `.env*` file was read
  - exact-head aggregate adjudication -> pending GitHub PR CI
- result: `fail` pending exact-head CI; local infrastructure failures are not treated as passes
- reviewer: code, security, performance, test, Supabase, and DevOps re-reviews approved the final diff; human critical-lane review remains mandatory
- residual risk: plain index creation briefly blocks writes and adds future write/storage overhead; the table must be rechecked immediately before any separately authorized hosted apply. Exact-head CI must resolve the local aggregate-runner failure before merge.
- hosted apply status: `not authorized`; the migration has not been applied to hosted Supabase.

### Exact-Head Session Lifecycle CI Repair

- Expanded scope: after PR #950 exact head `33652c14` passed every reported check except `auth-browser-smoke`, the owner authorized adding the blocking database slice to the same critical-lane PR. The branch remains `codex/win-219-manager-assignment-advisor-remediation`; no merge, deployment, payroll activation, capability grant, customer/PHI access, or `.env*` access is authorized by this expansion.
- Decisive evidence: the attempt-2 browser artifact left the Edit Session modal open with an enabled `Start Session` button and no clock-choice prompt. Hosted API logs for project `wnnjeqheqxxyrgsjmygy` then showed the synthetic super-admin caller receiving HTTP 403 from `POST /rest/v1/rpc/get_session_payroll_context` before any `sessions-start` request. The subsequent 90-second browser waiter was a downstream symptom, not a selector or click failure.
- Catalog root cause: hosted `public.get_session_payroll_context(uuid)` resolved the session therapist's exact-one active payroll employment before evaluating the globally disabled `payroll_timekeeping_v1` flag. The synthetic delegated-attendance flow intentionally has no payroll employment row, so it failed before reaching the existing typed `feature_disabled` response.
- Rejected design: a general move of the disabled return ahead of all payroll authority would have exposed same-org session/flag state to ordinary callers. Architecture, security, and Supabase review rejected that broader semantic change.
- Bounded migration: `20260814183500_payroll_session_context_disabled_precedence.sql` preserves authentication, canonical organization membership, org-scoped session lookup, `STABLE SECURITY DEFINER`, empty `search_path`, and authenticated-only execution. It derives self-attendance from the scoped `sessions.therapist_id = auth.uid()` check, preserves the existing delegated-attendance capability gate, and permits the early disabled response only after one of those authority paths succeeds. Ordinary same-org callers still fail closed before the disabled response, and enabled mode retains all employment, self-clock, delegated-attendance, jurisdiction, policy, and active-shift logic.
- TDD: RED failed because the forward migration was absent and the historical function resolved employment before disabled state. GREEN focused proof currently passes the session-context migration contract, the tenant/RLS contract, the manager-assignment advisor contract, the runtime-migration-parity contract, the payroll foundation/security/approval contracts, and the security-runner wrapper contract. The local database-backed runtime cases remain environment-gated because `PAYROLL_LOCAL_DATABASE_URL` is not set in this shell. Direct `vitest` for `tests/ci/check-session-deploy-safety.test.ts` executed 221/221 assertions but still exited nonzero with `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`; that worker infrastructure failure is tracked as blocked rather than a clean pass.
- Runtime parity: `20260814183500|payroll_session_context_disabled_precedence` is appended to every explicit WIN-219 activation-contract mirror. No dispatch guard, activation input, deployment behavior, or secret flow changed.
- Review status: architecture and Supabase review approved the capability-gated design. One Supabase test-gap finding was fixed by pinning the new migration's revoke/grant posture directly. Final code, security, performance, test, and Supabase re-review plus the full critical-lane verification remain required before the next push.
- Hosted apply and catalog catch: under the owner's explicit migration authorization, exact pushed commit `5c421e9a` migrations `payroll_manager_assignment_advisor_remediation` and `payroll_session_context_disabled_precedence` applied successfully as hosted versions `20260814190958` and `20260814191000`. Post-apply catalog proof confirmed the two indexes valid/ready, all three target advisor warnings cleared, the single RLS policy retained its role/command/capability branches with `(select auth.uid())`, RLS stayed enabled/forced, ACLs stayed unchanged, payroll stayed globally disabled, and operational/capability counts stayed zero.
- Forward authority repair: that same mandatory catalog comparison caught an enabled-mode regression in the committed `20260814183500` body before payroll could be activated: assigned identity had been derived from `sessions.therapist_id = auth.uid()` instead of the prior `employment_profiles.user_id = auth.uid()`. Payroll remained disabled and no operational rows existed. RED pins the employment-user source of truth and rejects the therapist-row comparison. `20260814191200_payroll_session_context_enabled_authority_repair.sql` is a new forward-only repair; applied migrations were not edited. After code, security, performance, test, architecture, and Supabase approval, exact pushed commit `0193ab2e` applied successfully as hosted version `20260814191616`.
- Final hosted proof: `get_session_payroll_context(uuid)` now contains the delegated capability gate and no therapist-row identity shortcut; enabled assigned identity is derived from `employment_profiles.user_id`. The function remains `STABLE SECURITY DEFINER` with empty `search_path` and only `postgres`/`authenticated` execute ACLs. The manager-assignment table still has one authenticated permissive SELECT policy, enabled plus forced RLS, authenticated read-only ACL, and zero rows. Both new btrees are valid/ready with exact definitions. Payroll remains globally disabled with zero enabled overrides, capability grants, employment profiles, employee time events, and session attendance events. The targeted performance advisor now reports only expected unused-index notices on the empty table; the two unindexed-FK notices and RLS init-plan notice are cleared.
- Exact-head fixture follow-up: commit `8d747bab` passed policy, lint/typecheck, unit/coverage, build, tenant safety, tier-0 browser, IEHP smoke, and the other reported checks, but `auth-browser-smoke` again timed out before `sessions-start`. The exact hosted Postgres error at `2026-08-14T19:41:31Z` was `organization scope mismatch`. The committed CI provisioner intentionally created the synthetic super-admin with null profile and metadata organization fields, while the payroll RPC correctly requires an active organization-scoped profile before capability or disabled-state evaluation. Security, Supabase, and debugging review rejected weakening the shared payroll tenant gate.
- Synthetic fixture repair: the auth-smoke provision step now supplies only the configured schedule-smoke email as a scope reference. `provision-ci-smoke-admin.ts` resolves that existing smoke identity's profile organization through its already-authorized service-role client, requires the scope for the auth-smoke job, fails closed on missing/null/invalid scope, and binds only the dedicated run-owned synthetic super-admin profile and auth metadata to that organization. Other provisioner call sites retain their existing behavior. No customer/PHI value is logged or committed, no capability is granted, and no payroll/RLS/function semantics change. Two RED cycles produced three expected failures each; focused GREEN passes 258 assertions across the provisioner, browser selection, and CI deployment-safety contracts, plus 41 targeted session/handler/reliability assertions. Exact-head hosted browser proof remains required after push.
- Fixture review: code, security, and test reviewers approved the final fail-closed fixture diff. Security specifically rejected an unscoped fallback or a global super-admin payroll exception; the remaining human-review question is whether `PW_SCHEDULE_EMAIL` is the intended tenant anchor for this hosted smoke.
- Exact-head fixture recheck: run `31835386027` proved the tenant anchor was resolved and booking succeeded, but `get_session_payroll_context` still returned 403 before `sessions-start`. The browser artifact showed an enabled Start Session button; hosted API/Postgres logs pinned the failure to the payroll preflight rather than click interception. A proposed fourth RPC migration was rejected because replacing capability authority with generic role authority would change the payroll contract.
- Run-owned fixture reassertion: immediately after booking, and only when the authenticated token subject equals `PW_SUPERADMIN_USER_ID` for a dedicated `playwright.ci.*@example.com` account, the lifecycle harness derives the organization from the exact booked session, reasserts the existing synthetic `super_admin` profile/role mapping, and reads the profile back fail-closed. Non-synthetic admin credentials skip this repair. No capability grant, policy, RPC, RLS, migration, feature flag, or production role semantics change.
- Cleanup hardening: the harness binds a newly booked session with null `created_by` to the exact run-owned synthetic actor before recording its UUID in a run/job/attempt-scoped runner-temp file. Cleanup re-queries every tracked UUID and refuses service-role deletion unless every session is bound to that exact actor. This closes the observed residual-session gap without accepting arbitrary UUIDs as delete authority.
- Follow-up TDD: RED produced the expected missing-helper and missing-call failures. GREEN passes 44 focused lifecycle/provisioner assertions, including non-synthetic credential behavior, tenant-binding persistence, tracked-session ownership acceptance/rejection, and booking-before-reassertion-before-start ordering. Policy, lint, typecheck, focused deployment-safety tests, build, tenant validation, and fresh exact-head hosted browser proof remain the completion gate.
- Insert-guard root cause: exact-head run `31838087718` failed during provisioning, before browser execution. Hosted readback for the dedicated run-owned auth user showed a non-null metadata organization, `super_admin` profile/role state, and a null `profiles.organization_id`; no hosted organization identifier is committed here. The hosted catalog proved `public.sync_user_profile()` sets transaction-local `app.bypass_profile_role_guard=on` around its profile upsert, but `app.normalize_profile_insert_authz_fields()` ignored that bypass and nulled the insert organization before `ON CONFLICT` handling. The update immutability guard already honors the same bypass.
- Fresh critical routing: specification, architecture, security, test, and Supabase review agreed the correct bounded fix is the production auth-trigger consistency repair, not a new CI-only RPC or a payroll tenant-gate relaxation. Insert RLS remains enabled and still requires self-ID, client role, null organization, and active state for authenticated self-service inserts.
- Forward insert-guard repair: `20260814205000_profile_insert_sync_bypass.sql` redefines only `app.normalize_profile_insert_authz_fields()`, preserving `SECURITY DEFINER`, `search_path`, service-role/super-admin branches, and unprivileged normalization while adding one early return for the existing transaction-local bypass. It contains no policy, grant, ACL, trigger, table, data, capability, payroll, or activation statements. Rollback is a compensating migration restoring the prior function body.
- Fixture ownership correction: the synthetic provisioner no longer performs a second direct profile upsert that would re-enter the normalizer without the trusted trigger context. Auth metadata plus `sync_user_profile()` own profile organization propagation; the fixture retains the exact `user_roles` upsert and now verifies email, organization, active state, and role by readback. RED proved the old direct profile write; GREEN currently passes 88 focused migration, sync, fixture, lifecycle, RLS-fixture, and runtime-parity assertions.
- Review fixes: final code review required an explicit null-profile readback guard and inclusion of `20260814205000|profile_insert_sync_bypass` in every existing WIN-219 runtime-parity/deploy-safety mirror. Both were added with a null-row test and an omission regression. The focused combined run executed 265/265 assertions successfully, including 222 deployment-safety assertions, but Vitest still exited nonzero on the known worker `Timeout calling "onTaskUpdate"`; this is recorded as blocked local infrastructure rather than a pass.
- Fresh verification: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run build`, and `git diff --check` pass after the parity fix. Local DB-backed grant/overlap/drift subchecks remain skipped because no loopback database URL is configured. Prior full `test:ci` and `verify:local` aggregate failures remain infrastructure-blocked and are not converted to passes; exact-head GitHub CI is the aggregate adjudicator.
- Authorized hosted apply: after independent implementation, code, security, test, and Supabase review, the owner-authorized `profile_insert_sync_bypass` migration applied as hosted version `20260814205910`. Catalog readback shows the exact bypass-first function body, `SECURITY DEFINER`, `SET search_path TO public, auth`, owner `postgres`, null function ACL, and the existing enabled trigger. `public.profiles` remains RLS-enabled/not-forced with unchanged ACLs and the same single authenticated INSERT policy requiring self-ID, client role, null organization, and active state. Payroll remains default-disabled with zero enabled overrides, employment profiles, employee time events, session attendance events, and manager assignments.
- Remaining gate: push the exact reviewed diff and require the credentialed `auth-browser-smoke` to prove auth-trigger organization propagation plus the full session lifecycle and cleanup on that exact head. Human owner review/merge remains mandatory; no deploy, payroll activation, or capability grant is authorized.
- Null-scope fixture correction: exact-head run `31840580377` reached the hosted profile verification but the IEHP job failed before browser execution. Read-only lookup of that exact `playwright.ci.iehp_assessment_import_smoke.*@example.com` actor showed null organization metadata and a non-null profile organization assigned by the existing auth-sync fallback. The verifier had incorrectly required the persisted profile organization to equal the requested `null` scope. TDD now permits the sync-owned fallback only when the caller requested no tenant scope; explicit tenant requests still require exact equality and retain their mismatch regression. Identity, email, active-state, and role checks remain fail-closed. Focused verification passes 64 tests, and policy, lint, typecheck, tenant validation, build, and `git diff --check` pass. Exact-head CI remains the adjudicator for the locally blocked aggregate runner and credentialed browser jobs.
- Session audit trigger drift repair: exact-head run `31841140044` proved the null-scope fix by passing IEHP provisioning/import/cleanup, unit coverage, tenant safety, build, and tier-0. Its credentialed session lifecycle then failed while binding the newly booked synthetic session to the exact run-owned actor: hosted `public.set_sessions_audit_fields()` referenced nonexistent `new_created_by` in its final UPDATE fallback. The repository's historical source correctly uses `new.created_by`. Fresh critical architecture, security, Supabase, and test design selected a single forward `CREATE OR REPLACE FUNCTION` repair with no trigger, policy, RLS, grant, ACL, table, or data change. RED produced two expected missing-migration failures; GREEN passes 258 focused migration, parity, deploy-safety, provisioner, and lifecycle assertions. Under the owner's migration authorization, hosted migration `20260814213754/session_audit_created_by_typo_repair` applied successfully. Catalog readback confirms the canonical branch, unchanged `postgres` owner, `SECURITY DEFINER`, `search_path=public`, `postgres/service_role` ACL, volatility/parallel/leakproof properties, exactly one enabled sessions trigger, and unchanged sessions RLS/ACL/policy count. Payroll remains default-disabled with zero enabled overrides, employment profiles, employee time events, session attendance events, and manager assignments. Exact-head CI must now rerun the full credentialed session lifecycle and cleanup before owner review/merge.
- Exact-head lifecycle result and browser reliability blocker: run `31843771997` on `0d4284d4` passed policy, both tenant gates, lint/typecheck, unit/coverage, runtime contract, build, tier-0, IEHP, Supabase validation, and both no-show/completed hosted session lifecycle flows. The trigger repair therefore executed successfully in the credentialed path. The aggregate browser job failed on three different attempts at three different `/schedule` navigation sites, each waiting for global `networkidle`: blocked-close modal opening, measurement-roundtrip refresh, and no-show modal reopening. The variation and exact stack traces established a shared harness readiness defect rather than a deterministic migration regression.
- Browser-navigation scope expansion: fresh routing keeps the PR in `high-risk human-reviewed` / `critical` because this is a required auth/session gate inside the protected migration slice. The bounded change replaces only hard `/schedule` `goto(... waitUntil: "networkidle")` waits with `domcontentloaded` in the shared booking/modal helpers and their required lifecycle, measurement, and ad-hoc capture entry points. Existing route checks, calendar controls, schedule filters, exact session-card targeting, dialog visibility, lifecycle/RPC/database assertions, cleanup ownership, and fail-closed error paths remain unchanged. No workflow, credential, production app, auth, RLS, grant, migration, hosted state, timeout budget, or skip behavior changed.
- Browser-navigation TDD and review: RED produced three expected failures: two shared-helper option assertions and the cross-script hard-network-idle contract. GREEN passes 36/36 focused assertions. `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run build`, and `npm run test:routes:tier0` (244/244) pass. The final local `npm run test:ci` again made broad assertion progress but failed on the known local runner limits: AI documentation network refusal was followed by a roughly 4 GiB Node heap exhaustion and closed worker IPC; this is blocked infrastructure, not a pass. `npm run verify:local` passed its policy, lint, and typecheck stages, then stopped at the embedded `test:ci` with the same heap/IPC failure; later wrapper stages were not executed in that command, although build and tier-0 passed separately. Independent code and security review approve the bounded diff; test review requires the new exact-head credentialed `auth-browser-smoke` and aggregate `ci-gate` before merge. Human owner review and merge remain mandatory.
