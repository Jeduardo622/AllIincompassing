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

## Task 6 Employee Rate Versions FK Coverage

- Date: 2026-08-16
- Branch: `codex/win-219-employee-rate-versions-fk-indexes`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: cover the remaining `public.employee_rate_versions` advisor surface with exact-order FK-leading indexes only
- Live hosted baseline:
  - project `wnnjeqheqxxyrgsjmygy` is `ACTIVE_HEALTHY`
  - `public.employee_rate_versions` is empty (`0` live rows, `0 bytes` table size, `32 kB` total size)
  - RLS is enabled and forced; ACL remains `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`
  - constraints are `created_by -> auth.users(id)`, `(employment_profile_id, organization_id) -> employment_profiles(id, organization_id)`, and `organization_id -> organizations(id)`
  - existing index coverage is `employee_rate_versions_history_lookup_idx (organization_id, employment_profile_id, effective_from desc, created_at desc, id desc)`, which does not cover the exact FK column order for `(employment_profile_id, organization_id)`
- Non-goals: no policy rewrite, no grant change, no data mutation, no function/trigger change, no capability activation
- Implementation:
  - `employee_rate_versions_created_by_idx` covers `(created_by)`
  - `employee_rate_versions_employment_profile_org_idx` covers `(employment_profile_id, organization_id)`
  - migration `20260816033808_payroll_employee_rate_versions_fk_indexes` is included in every explicit WIN-219 runtime-parity mirror
- TDD evidence:
  - RED: focused contract reported `3 failed, 2 passed` for the missing migration, both absent exact index definitions, and missing parity version
  - GREEN: focused migration plus runtime-parity contracts reported `9 passed`; deploy-safety omission regression reported `1 passed`; broader payroll/tenant/parity contract bundle reported `302 passed`
- Verification card:
  - required checks: focused migration and payroll contracts, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, `npm run verify:local`, `git diff --check`
  - passed: focused and broader contracts, `ci:check-focused`, `lint`, `typecheck`, `validate:tenant`, `build`, local migration inventory, `git diff --check`
  - blocked locally: the first `test:ci` attempt exhausted Node's default 4 GB heap; an 8 GB retry completed `545` files and `4,944` tests but four unrelated `ProgramsGoalsTab` tests plus a Vitest worker RPC timed out under aggregate load; the isolated file then passed `120/120`. `verify:local` cannot complete past the same aggregate gate, and coverage verification has no completed aggregate summary.
  - result: `pass-with-blocked-checks`, pending exact-head CI
  - residual risk: plain `CREATE INDEX` briefly blocks writes; recheck the empty/small table and lock window before any separately authorized hosted apply
- Independent reviews: specification, architecture, implementation, code, security, performance, test, and Supabase reviews approved with no actionable findings
- Hosted apply status: not authorized and not applied in this slice
- Next action: finish independent review and exact diff hygiene, open the WIN-219 PR, and use exact-head CI plus human critical-lane review as the merge gate

### Hosted Employee Rate Versions FK Index Apply Evidence

- Date and authority: PR #958 was owner-merged to `main` as `dce93cdb9b66516f6a801186f3200d81430856d8`. On 2026-08-15, the owner separately authorized applying only the merged `payroll_employee_rate_versions_fk_indexes` migration to Supabase project `wnnjeqheqxxyrgsjmygy`.
- Post-merge cleanup: the squash-merge patch matched the PR head patch (`98a66dada256e0ba9ce3dbf88e37949fdf251663`), local `main` was fast-forwarded to the merge commit, and only the dedicated merged local and remote feature branches were removed. Unrelated worktrees plus `.codex-remote-attachments/` and `.codex-tmp/` were preserved.
- Immediate preflight: the project remained `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029 and the migration was absent. `public.employee_rate_versions` still had zero rows, a zero-byte heap, 32,768 index bytes, and 32,768 total bytes. The only observed lock was the preflight query's granted `AccessShareLock`; no competing lock was present.
- Advisor and index baseline: the performance advisor still reported exactly the two targeted `unindexed_foreign_keys` notices for `employee_rate_versions_created_by_fkey` and `employee_rate_versions_employment_profile_id_organization__fkey`; the security advisor reported zero scoped notices. No valid/ready btree led on `(created_by)` or `(employment_profile_id, organization_id)`.
- Apply result: Supabase `apply_migration` succeeded once with logical name `payroll_employee_rate_versions_fk_indexes`. The hosted migration ledger records generated version `20260816044607`. Its normalized-LF statement SHA-256 is `93444ff79bae062a0ab24d449b897b012aa3dea25ab1922db1b91d15d11d273f`, exactly matching the merged migration after checkout newline normalization.
- Index proof: `employee_rate_versions_created_by_idx` is a valid, ready, non-unique btree on `(created_by)`. `employee_rate_versions_employment_profile_org_idx` is a valid, ready, non-unique btree on `(employment_profile_id, organization_id)`. The existing organization-first history index, exclusion index, unique indexes, and primary key remain present; no organization-first duplicate was added.
- Authorization invariants: RLS remains enabled and forced. The only policy remains permissive authenticated `SELECT` policy `employee_rate_versions_authenticated_select` with `app.payroll_actor_has_capability(organization_id, 'payroll.view_compensation'::text)` and null `WITH CHECK`. ACL remains `{postgres=arwdDxtm/postgres,authenticated=r/postgres}` and the existing enabled timesheet-derivation guard trigger is unchanged.
- Advisor delta: both scoped unindexed-FK notices cleared and the scoped security advisor remains empty. The performance advisor now reports expected `unused_index` informational notices for the two new indexes plus the two pre-existing unused indexes because the target table is empty; unused-index deletion remains out of scope. See the Supabase guidance for [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Synthetic smoke: read-only, rolled-back `authenticated` plans used only synthetic UUID `00000000-0000-4000-8000-000000000219`. With sequential scans disabled only for plan proof, PostgreSQL selected `employee_rate_versions_created_by_idx` and `employee_rate_versions_employment_profile_org_idx` and retained the compensation-capability RLS filter. No fixture, operational row, or data mutation was created.
- Payroll invariants: payroll remains globally default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee rate versions, employee time events, session attendance events, or mutation receipts. No Edge/Netlify deployment, payroll activation, capability grant, customer/PHI access, secret access, or `.env*` access occurred.
- Hosted verification card: classification `high-risk human-reviewed`; lane `critical`; required checks were merged-SQL identity, migration-absence proof, live catalog/advisor/security/payroll preflight, one authorized apply, migration-ledger and exact index validity/readiness readback, targeted advisor comparison, invariant comparison, and PHI-free rolled-back synthetic plan proof. Executed checks: all required checks passed. Blocked checks: none. Result: `pass`. Residual risk: the empty table cannot provide representative workload benefit, and the new unused-index notices are expected until legitimate payroll traffic exists.
- Hosted apply status: `applied` as hosted version `20260816044607`. This separate docs-only evidence update does not authorize deployment, payroll activation, capability grants, rollback, or future hosted migrations.

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

## Payroll Mutation Receipts InitPlan Remediation

- Date: 2026-08-14
- Branch: `codex/win-219-payroll-mutation-receipts-initplan`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: replace only the direct `actor_user_id = auth.uid()` evaluation in `payroll_mutation_receipts_authenticated_select` with the semantically equivalent `actor_user_id = (select auth.uid())`, add focused contract coverage, and append the migration to every required WIN-219 runtime-parity mirror.
- Non-goals: no other advisor remediation, index, function, trigger, grant, ACL, capability, table, data, payroll activation, deployment, historical migration edit, hosted apply, customer/PHI access, secret access, or `.env*` access.

### Hosted Read-Only Baseline

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029.
- The performance advisor reported the scoped `auth_rls_initplan` notice for `public.payroll_mutation_receipts`; the security advisor reported no scoped notice.
- The table had zero rows and occupied 32,768 bytes. RLS was enabled and forced.
- The only scoped policy was permissive `SELECT` for `authenticated` with exact expression `((app.payroll_actor_in_organization(organization_id) AND (actor_user_id = auth.uid())) OR app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions'::text))`.
- ACLs were `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`. Existing indexes were unchanged and already included the primary key, `(id, organization_id)`, and `(organization_id, actor_user_id, operation, idempotency_key)` uniqueness contracts; this slice adds no index.

### Implementation And TDD

- RED: the focused test failed three expected assertions because the migration was absent, the optimized policy body was absent, and runtime parity omitted the new version. Foundation and forbidden-statement assertions already passed.
- GREEN: `20260815002241_payroll_mutation_receipts_initplan.sql` uses one transactional `ALTER POLICY ... USING` statement. It preserves the organization predicate, actor comparison, `payroll.resolve_exceptions` capability branch, policy name, table, command, and role while changing only `auth.uid()` to `(select auth.uid())`.
- The contract rejects grants, revokes, functions, triggers, tables, indexes, data mutation, feature activation, and added capability branches. Tenant/RLS coverage pins both the historical direct form and the effective optimized form. Runtime migration parity is updated in the workflow, policy scripts, and their regression tests.
- Rollback: a compensating forward migration can restore the same policy expression with `actor_user_id = auth.uid()`. `ALTER POLICY` takes a brief catalog lock; the zero-row baseline limits practical risk, but hosted state must be refreshed immediately before any separately authorized apply.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `database/RLS/migrations/tenant isolation` and `CI/workflow/policy`
- required checks: focused mutation-receipts migration test; payroll foundation, approval, security-repair, manager-index/advisor, tenant/RLS, and runtime-parity tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - focused mutation-receipts and required payroll/security/parity batches: pass; 313 assertions across 13 files in the broad targeted batch
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass
  - `npm run test:ci`: fail locally after broad assertion progress; the default run exhausted the approximately 4 GiB Node heap, and a process-local 12 GiB retry avoided OOM but failed on an unrelated Vitest worker `onTaskUpdate` timeout after the AI-documentation test received `ECONNREFUSED`
  - `npm run verify:local`: fail at its embedded default-heap `npm run test:ci`; its preceding policy, lint, and typecheck stages passed
- blocked checks:
  - DB-backed sensitive-table overlap, privileged-function grant, and preview-drift subchecks -> no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication -> pending GitHub PR CI
- result: `fail` pending exact-head CI; local infrastructure failures are not converted to passes
- residual risk: exact-head CI and human critical-lane review are mandatory before merge. Hosted application remains a separate owner-authorized action and has not occurred.
- hosted apply status: `not authorized for this new migration`; no hosted state was changed.
- independent review: code, security, performance, test, and Supabase reviewers found no actionable implementation defects. Code review keeps merge readiness blocked until exact-head aggregate CI resolves the documented local runner failures; all reviewers retain mandatory human critical-lane review and fresh hosted pre-apply catalog checks.

### Hosted Mutation Receipts InitPlan Application

- Date and authority: PR #951 merged to `main` as `cece7641c8c86783308cf79550da9c633efa8adb` after all seven required exact-head checks passed. On 2026-08-14, the owner separately authorized applying only the merged `payroll_mutation_receipts_initplan` migration to Supabase project `wnnjeqheqxxyrgsjmygy`.
- Immediate preflight: the project remained `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029; the migration was absent; `public.payroll_mutation_receipts` had zero rows, a zero-byte heap, and 32,768 total bytes. The table retained enabled plus forced RLS, one permissive authenticated `SELECT` policy, null `WITH CHECK`, ACLs `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`, and the direct `actor_user_id = auth.uid()` expression. The empty table made the brief `ALTER POLICY` catalog-lock window acceptable.
- Apply result: Supabase `apply_migration` succeeded for logical name `payroll_mutation_receipts_initplan`. The hosted ledger records exactly one row at generated version `20260815044944`.
- Policy and tenant proof: hosted `pg_policy` now renders `actor_user_id = ( SELECT auth.uid() AS uid)`. The organization predicate and `payroll.resolve_exceptions` capability branch are unchanged. Policy name/count, authenticated role, `SELECT` command, permissive mode, null `WITH CHECK`, enabled/forced RLS, and ACLs are unchanged.
- Schema-scope proof: the same three valid, ready unique indexes remain; no non-internal trigger exists. The migration added no index, function, trigger, table, grant, ACL, data, capability, or activation statement.
- Advisor delta: targeted performance notices changed from two to one. The `auth_rls_initplan` warning cleared; the separate pre-existing `payroll_mutation_receipts_actor_user_id_fkey` unindexed-FK notice remains and is outside this slice. Targeted security notices remain zero. See the Supabase guidance for [RLS performance and initPlans](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) and [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- Synthetic smoke: a read-only transaction under `authenticated` used only synthetic UUID `00000000-0000-4000-8000-000000000219`; it returned zero visible receipts and rolled back. `EXPLAIN (FORMAT JSON)` showed `InitPlan 1` for `auth.uid()` while retaining the organization and capability policy filter. No fixture or operational row was created.
- Payroll invariants: payroll remains default-disabled with zero enabled organization overrides, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts. No Edge/Netlify deployment, payroll activation, customer/PHI access, secret access, or `.env*` access occurred.
- Result: `pass`. The reviewed RLS optimization is hosted and the intended advisor warning is cleared without authorization-semantic drift.
- Residual risk and next slice: representative performance cannot be measured while the table is empty. Separately route the remaining `payroll_mutation_receipts_actor_user_id_fkey` notice; do not fold it into this completed apply.

## Payroll Mutation Receipts Actor FK Index Remediation

- Date: 2026-08-15
- Branch: `codex/win-219-mutation-receipts-actor-index`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: add the minimum nonredundant btree index whose leading column exactly covers `public.payroll_mutation_receipts_actor_user_id_fkey`, add a focused migration contract, and append the migration to every required WIN-219 runtime-parity mirror.
- Non-goals: no policy, RLS, ACL, grant, function, trigger, table, data, capability, feature flag, payroll activation, deployment, historical migration edit, customer/PHI access, secret access, `.env*` access, hosted apply, or other advisor remediation.

### Hosted Read-Only Baseline

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029. Hosted migrations included `20260814164939/payroll_manager_assignment_lookup_index`, `20260814190958/payroll_manager_assignment_advisor_remediation`, and `20260815044944/payroll_mutation_receipts_initplan`.
- The performance advisor reported exactly one scoped notice: `unindexed_foreign_keys` for `payroll_mutation_receipts_actor_user_id_fkey`. The security advisor reported no scoped notice.
- The target table had zero rows, a zero-byte heap in the primary catalog query, 24,576 index bytes, and 32,768 total bytes. RLS was enabled and forced. ACLs were `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`; there were no non-internal triggers.
- The FK column order is exactly `(actor_user_id)`. The three existing valid and ready indexes lead on `(id)`, `(id, organization_id)`, and `(organization_id, actor_user_id, operation, idempotency_key)`. None covers the FK with matching leading-column order.
- The single permissive authenticated `SELECT` policy remained `((app.payroll_actor_in_organization(organization_id) AND (actor_user_id = ( SELECT auth.uid() AS uid))) OR app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions'::text))`.
- Stop conditions for a later apply: the index or equivalent leading-column coverage appears, the table grows beyond the accepted plain-index lock window, or policy/RLS/ACL/advisor state drifts materially.

### Implementation And TDD

- RED: the focused contract executed five assertions and failed the expected three because the generated migration body was empty, the exact actor-leading index was absent, and runtime parity omitted the new migration. The historical policy/tenant assertions already passed.
- GREEN: `20260815191838_payroll_mutation_receipts_actor_user_id_index.sql` adds only `payroll_mutation_receipts_actor_user_id_idx` using btree `(actor_user_id)` inside one transaction. The deterministic name is below PostgreSQL's 63-byte identifier limit and does not duplicate the existing organization-first unique index.
- The focused contract rejects policy, RLS, ACL, grant, function, trigger, table, type, data, capability, activation, and organization-first duplicate-index drift. It also pins the existing `(select auth.uid())` policy form and every explicit WIN-219 runtime-parity mirror.
- Rollback: a compensating forward migration can `drop index if exists public.payroll_mutation_receipts_actor_user_id_idx`. Plain `CREATE INDEX` briefly blocks writes; the zero-row baseline makes that strategy acceptable only if the hosted pre-apply recheck remains materially unchanged.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `database/migration/tenant isolation` and `CI/workflow/policy`
- required checks: focused actor-index contract; payroll foundation, approval, security-repair, manager-index/advisor, mutation-receipts initplan, tenant/RLS, and runtime-parity tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - focused migration, runtime-parity, and deploy-safety batch: pass; 234 assertions across 3 files
  - broader targeted payroll/security/parity batch: pass; 326 assertions across 14 files
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass
  - `npm run test:ci`: blocked locally after broad passing assertion progress; the default run exhausted the approximately 4 GiB Node heap and closed worker IPC
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: blocked after completing the assertion phase when Vitest coverage collation could not read temporary shard `coverage/.tmp/coverage-96.json`
  - `npm run verify:local`: blocked at its embedded default-heap `test:ci`; its preceding policy, lint, and typecheck stages passed
- blocked checks:
  - DB-backed privileged-function grant, sensitive-table overlap, and preview-drift subchecks -> no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication -> pending GitHub PR CI
- result: `blocked` pending exact-head CI; neither local infrastructure failure is converted to a pass
- independent review: code review found the missing handoff entry and approved the code path subject to this fix; security, performance, test, and Supabase reviews found no actionable implementation defect. Reviewers confirmed the exact FK-leading key, nonredundancy, unchanged tenant/authz surfaces, and required hosted recheck. Human critical-lane review remains mandatory.
- hosted apply status: `not authorized and not applied` for `20260815191838_payroll_mutation_receipts_actor_user_id_index`.
- residual risk: exact-head CI must adjudicate the locally blocked aggregate runner. A later plain hosted index build is safe only if a fresh row-count/size/write-window check still supports it. `CREATE INDEX IF NOT EXISTS` also requires exact post-apply definition/validity proof so an unexpected same-name object cannot be mistaken for success.
- next action: push the isolated diff, open the WIN-219-linked PR for human review, wait boundedly for exact-head required checks, and stop without merging or applying the migration hosted.

### Hosted Actor FK Index Apply Evidence

- Date and authority: PR #954 merged to `main` as `a24221e1f890f92bd46762d6adb609d30755ea1f`. On 2026-08-15, the owner separately authorized applying only the merged `payroll_mutation_receipts_actor_user_id_index` migration to Supabase project `wnnjeqheqxxyrgsjmygy`.
- Immediate preflight: the project remained `ACTIVE_HEALTHY` on PostgreSQL 17.6. The migration was absent. `public.payroll_mutation_receipts` had zero rows, a zero-byte heap, 24,576 index bytes, and 32,768 total bytes. Only one granted `AccessShareLock` from the preflight query was present. No existing index led on `(actor_user_id)`; the existing organization-first unique index remained non-covering for the single-column FK.
- Security baseline: enabled and forced RLS, the single permissive authenticated `SELECT` policy, null `WITH CHECK`, ACLs `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`, and zero non-internal triggers were unchanged. The policy retained the organization predicate, `(select auth.uid())` actor match, and `payroll.resolve_exceptions` capability branch.
- Advisor baseline: the performance advisor reported exactly one scoped `unindexed_foreign_keys` notice for `payroll_mutation_receipts_actor_user_id_fkey`; the security advisor reported zero scoped notices. See the Supabase guidance for [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- Apply result: Supabase `apply_migration` succeeded once with the exact merged SQL and logical name `payroll_mutation_receipts_actor_user_id_index`. The hosted migration ledger records generated version `20260815213756`.
- Index proof: `payroll_mutation_receipts_actor_user_id_idx` is valid, ready, non-unique, and exactly `CREATE INDEX payroll_mutation_receipts_actor_user_id_idx ON public.payroll_mutation_receipts USING btree (actor_user_id)`. Catalog readback identifies `actor_user_id` as its leading attribute. The original organization-first unique index remains present and no duplicate of it was introduced.
- Post-apply invariants: the table still has zero rows and a zero-byte heap; index bytes increased from 24,576 to 32,768 and total bytes from 32,768 to 40,960. Policy name/count, role, command, permissive mode, predicate, null `WITH CHECK`, enabled/forced RLS, ACLs, privileges, and zero-trigger state are unchanged.
- Advisor delta: the scoped unindexed-FK notice cleared. The security advisor remains at zero scoped notices. The performance advisor now reports the expected `unused_index` informational notice for the new index because the target table is empty; unused-index deletion is out of scope.
- Synthetic smoke: a read-only transaction under `authenticated` used only synthetic UUID `00000000-0000-4000-8000-000000000219` and rolled back. `EXPLAIN (FORMAT JSON)` selected `payroll_mutation_receipts_actor_user_id_idx`, retained `InitPlan 1` for `auth.uid()`, and retained both organization and capability policy branches. No fixture, operational row, or data mutation was created.
- Payroll invariants: payroll remains default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts. No Edge/Netlify deployment, payroll activation, customer/PHI access, secret access, or `.env*` access occurred.
- Evidence provenance: this subsection is the retrospective system-of-record entry for live Supabase MCP results captured during the separately authorized post-merge dispatch; it does not replace the migration's critical-lane tests or exact-head review. PR #954 supplies the immutable merged SQL and exact-head CI history, and WIN-219 records the hosted preflight, apply, postflight, advisor delta, and next action. The docs-only evidence branch archives those completed results without reapplying or re-proving the migration.
- Rollback and residual risk: if a reviewed compensating migration is ever required, it can `drop index if exists public.payroll_mutation_receipts_actor_user_id_idx`. Representative production benefit cannot be measured while the table is empty, so the new unused-index notice is expected until legitimate payroll traffic exists; do not delete it as unused in the meantime.
- Hosted verification card: classification `high-risk human-reviewed`; lane `critical`; required checks were exact merged-SQL identity, migration-absence proof, live catalog/advisor/security/payroll preflight, one authorized apply, migration-ledger and index validity/readiness readback, targeted advisor comparison, invariant comparison, and PHI-free rolled-back synthetic smoke. All required checks passed; blocked checks: none; result: `pass`; residual risk: empty-table conditions preclude representative workload measurement.
- Hosted apply status: `applied` as hosted version `20260815213756`. This evidence update remains a separate human-reviewed PR and does not authorize deployment, payroll activation, capability grants, or future hosted migrations.

## Employee Time Events FK Index Remediation

- Date: 2026-08-15
- Branch: `codex/win-219-employee-time-events-fk-indexes`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: add only the three minimum nonredundant btree indexes whose leading columns exactly cover the remaining foreign-key advisor notices on `public.employee_time_events`, add a focused migration contract, and append the migration to every required WIN-219 runtime-parity mirror.
- Non-goals: no policy, RLS, ACL, grant, function, trigger, table, data, capability, feature flag, payroll activation, deployment, historical migration edit, unused-index deletion, other advisor remediation, customer/PHI access, secret access, `.env*` access, or hosted apply.

### Hosted Read-Only Baseline

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029. The prior actor-index migration remained hosted as version `20260815213756`.
- The performance advisor reported exactly three scoped `unindexed_foreign_keys` notices: `employee_time_events_actor_user_id_fkey` on `(actor_user_id)`, `employee_time_events_employment_profile_id_organization_id_fkey` on `(employment_profile_id, organization_id)`, and `employee_time_events_replacement_for_event_id_organization_fkey` on `(replacement_for_event_id, organization_id)`. The security advisor reported zero scoped notices.
- The target table had zero rows, a zero-byte heap, 32,768 index bytes, and 40,960 total bytes. Only the preflight query's granted `AccessShareLock` was present. The empty table supports a plain transactional index strategy only while a later pre-apply refresh remains materially unchanged.
- Existing valid and ready indexes led on `(id)`, `(id, organization_id)`, `(id, organization_id, employment_profile_id)`, and `(organization_id, employment_profile_id, event_at, created_at, id)`. None covered any of the three target FK sequences in leading-column order. The separate organization FK was already covered and remains out of scope.
- RLS was enabled and forced. The single permissive authenticated `SELECT` policy remained `app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)`. ACLs were `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`; authenticated retained only `SELECT`. The three existing enabled application triggers were unchanged.
- Payroll remained default-disabled with zero organization overrides, active policy versions, capability grants, employment profiles, employee time events, or session attendance events. The existing unused-index notice for `employee_time_events_org_employment_event_at_idx` is informational and out of scope.

### Implementation And TDD

- RED: after removing premature implementation drift, the focused contract ran five assertions and failed the expected three because the migration was absent, the exact index definitions were absent, and runtime parity omitted the new version. Policy/RLS/ACL and forbidden-statement assertions already passed.
- GREEN: `20260816014726_payroll_employee_time_events_fk_indexes.sql` creates only `employee_time_events_actor_user_id_idx` on `(actor_user_id)`, `employee_time_events_employment_profile_org_idx` on `(employment_profile_id, organization_id)`, and `employee_time_events_replacement_event_org_idx` on `(replacement_for_event_id, organization_id)`, all btree and inside one transaction. Each deterministic identifier is below PostgreSQL's 63-byte limit.
- The contract proves exact FK-leading key order, rejects an organization-first duplicate, pins the existing helper-only policy plus enabled/forced RLS and ACL semantics, and rejects grants, revokes, functions, triggers, tables, policy changes, data mutation, capability changes, and activation statements. Runtime parity includes the version in the workflow, both policy scripts, and their tests, with a fail-closed omission regression.
- Rollback: a compensating forward migration can drop the three named indexes. Plain `CREATE INDEX` briefly blocks writes; the zero-row baseline makes that strategy acceptable only if a fresh hosted pre-apply size and lock-window check remains materially unchanged.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `database/migration/tenant isolation` and `CI/workflow/policy`
- required checks: focused employee-time-events migration test; payroll foundation, approval, security-repair, manager-index/advisor, mutation-receipts initplan/index, tenant/RLS, runtime-parity, and deploy-safety tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - focused migration and runtime-parity batch: pass; 9/9 assertions across 2 files
  - focused deploy-safety omission regression: pass; 1/1 selected assertion
  - broader targeted payroll/security/parity batch: pass; 85/85 assertions across 11 files
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - isolated rerun of the only timed-out aggregate assertion: pass in 2.1 seconds
  - `npm run test:ci`: blocked locally after broad passing assertion progress; one unrelated SessionModal assertion timed out under aggregate contention, then the default run exhausted the approximately 4 GiB Node heap and closed worker IPC
  - `npm run verify:local`: blocked at its embedded default-heap `npm run test:ci`; policy, lint, and typecheck passed before the test runner exhausted the approximately 4 GiB Node heap and closed worker IPC, so later wrapper stages did not run
  - `git diff --check`: pass on the final pre-commit diff
- blocked checks:
  - DB-backed privileged-function grant, sensitive-table overlap, and preview-drift subchecks -> no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication -> pending GitHub PR CI
- result: `blocked` pending exact-head CI; local infrastructure failures are not converted to passes
- independent review: specification, architecture, security, performance, test, and Supabase design reviews approved the index-only boundary. Post-implementation security, performance, and test reviews found no defect; Supabase review approved the index/RLS boundary and retained the fresh empty-table plus pre-apply lock-window gate. Code review requested only completion of this verification card and the PR-hygiene artifact, both now resolved.
- hosted apply status: `not authorized and not applied` for `20260816014726_payroll_employee_time_events_fk_indexes`.
- residual risk: exact-head CI and human critical-lane review remain mandatory. A later plain hosted index build is safe only if a fresh row-count, size, lock, advisor, and index-coverage check remains materially unchanged. Empty-table conditions preclude representative performance measurement and can produce expected unused-index notices until legitimate payroll traffic exists.
- next action: wait boundedly for exact-head required checks on PR #956, resolve only in-scope findings, and stop for human review without merging or applying the migration hosted.

### PR Hygiene Verdict

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; isolated `codex/win-219-employee-time-events-fk-indexes`
- linear-ready: yes; WIN-219 contains the scoped hosted baseline, branch, verification plan, and next action
- single-purpose: yes; three exact FK-leading indexes, their focused contract, required runtime-parity mirrors, and this handoff only
- unrelated changes: none; `.codex-remote-attachments/` and `.codex-tmp/` remain untracked and excluded
- generated artifact drift: none
- protected-path drift: none beyond the routed migration and required parity workflow/policy mirrors
- change summary: present
- verification summary: present, with local aggregate infrastructure failure disclosed rather than converted to a pass
- pr handoff: ready; [PR #956](https://github.com/Jeduardo622/AllIincompassing/pull/956) targets `main`
- reviewer: code, security, performance, test, and Supabase reviews completed
- required follow-up: finalize review and diff checks, commit/push, open the WIN-219-linked PR, require exact-head CI and human critical-lane review, and do not merge or apply hosted
- handoff summary: adds only the three minimum FK-leading indexes for `public.employee_time_events` and pins unchanged RLS/ACL/tenant behavior. Focused and tenant suites pass; the default local aggregate remains infrastructure-blocked, so exact-head CI and human review are mandatory.

### Hosted Employee Time Events FK Index Apply Evidence

- Date and authority: PR #956 merged to `main` as `c21d53e21074de9a53d45cbd723603b283895e95`. On 2026-08-15, the owner separately authorized applying only the merged `payroll_employee_time_events_fk_indexes` migration to Supabase project `wnnjeqheqxxyrgsjmygy`.
- Immediate preflight: the project remained `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029 and the migration was absent. `public.employee_time_events` still had zero rows, a zero-byte heap, 32,768 index bytes, and 40,960 total bytes, with no competing locks. No valid/ready index led on `(actor_user_id)`, `(employment_profile_id, organization_id)`, or `(replacement_for_event_id, organization_id)`.
- Advisor and security baseline: the performance advisor still reported exactly the three scoped `unindexed_foreign_keys` notices targeted by PR #956, while the security advisor reported zero scoped notices. Enabled and forced RLS, the single permissive authenticated `SELECT` policy, helper-only policy expression, null `WITH CHECK`, ACLs, privileges, and the three enabled application triggers matched the reviewed baseline.
- Apply result: Supabase `apply_migration` succeeded once with the exact SQL from merged `main` and logical name `payroll_employee_time_events_fk_indexes`. The hosted migration ledger records generated version `20260816031108`.
- Index proof: `employee_time_events_actor_user_id_idx`, `employee_time_events_employment_profile_org_idx`, and `employee_time_events_replacement_event_org_idx` are valid, ready, non-unique btrees with exact leading columns `(actor_user_id)`, `(employment_profile_id, organization_id)`, and `(replacement_for_event_id, organization_id)`. The existing organization-first read index remains unchanged and no duplicate was added.
- Post-apply invariants: the table remains empty with a zero-byte heap; index bytes increased to 57,344 and total bytes to 65,536. The policy remains `employee_time_events_authenticated_select`, permissive authenticated `SELECT`, with `app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)` and null `WITH CHECK`. RLS remains enabled and forced; ACLs, privileges, and all three enabled triggers are unchanged.
- Advisor delta: all three scoped unindexed-FK notices cleared and the scoped security advisor remains empty. The performance advisor now reports the expected unused-index informational notices for the three new indexes, plus the pre-existing unused organization-first index notice, because the table is empty; unused-index deletion remains out of scope.
- Synthetic smoke: a read-only transaction under `authenticated` used only synthetic UUID `00000000-0000-4000-8000-000000000219` and rolled back. With sequential scans disabled only for plan proof, `EXPLAIN (FORMAT JSON)` selected `employee_time_events_actor_user_id_idx` and retained the tenant policy filter `app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)`. No fixture or operational row was created.
- Payroll invariants: payroll remains globally default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts. No Edge/Netlify deployment, payroll activation, capability grant, customer/PHI access, secret access, or `.env*` access occurred.
- Review and provenance: fresh hosted-gate Supabase and security reviews approved the apply after the empty-table, no-lock, exact-advisor, and unchanged-authz preflight. PR #956 supplies the immutable merged SQL and exact-head CI history; WIN-219 and this separate docs-only evidence PR record the authorized hosted action without reopening implementation scope.
- Rollback and residual risk: if a separately reviewed compensating migration is ever required, it can drop the three named indexes. Representative production benefit cannot be measured while the table is empty, so the unused-index notices are expected until legitimate payroll traffic exists and must not trigger deletion in this slice.
- Hosted verification card: classification `high-risk human-reviewed`; lane `critical`; required checks were merged-SQL identity, migration-absence proof, live catalog/advisor/security/payroll preflight, one authorized apply, migration-ledger and exact index validity/readiness readback, targeted advisor comparison, invariant comparison, and PHI-free rolled-back synthetic smoke. Executed checks: all required checks passed. Blocked checks: none. Result: `pass`. Residual risk: empty-table conditions preclude representative workload measurement.
- Hosted apply status: `applied` as hosted version `20260816031108`. This evidence PR does not authorize deployment, payroll activation, capability grants, or future hosted migrations.

## Payroll Super-Admin Route Gate Alignment

- Date: 2026-08-15
- Branch: `codex/payroll-super-admin-route-gates`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: aligned shared payroll review route access through `hasPayrollReviewRouteAccess` plus `hasOrgPayrollAccess`; included export-only `canExportPeriod` in payroll admin route access; reconciled `Sidebar`, `TimeReview`, and details-query gating; repaired the Cypress fixture schema mismatch.
- Non-goals: no server, Supabase grant, migration, RLS, or deploy changes.
- Verification: focused 7 files / 121 tests passed; bounded aggregate `541` files / `4923` tests passed with `100` env skips using `NODE_OPTIONS=12288` and `--maxWorkers=4`; coverage `92.96%`; `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, and `npm run build` passed; `npm run test:routes:tier0` passed `244/244`; `npm run verify:local` reached all `4923` assertions but exited `1` on the known Vitest `onTaskUpdate` worker timeout; `npm run ci:playwright` was blocked preflight by missing `PW_*` credentials; responsive observer attempted `/time/review` and `/payroll` at desktop and mobile but was blocked by protected synthetic route/runtime-auth surfaces, with no overflow or clipped-control failures recorded.
- Review status: independent code, security, and test reviews approved the route-gating logic; the route fixture fix was re-reviewed after the exact-false contract was restored.
- Result: `pass-with-blocked-browser-checks`.
- Residual risk: exact-head CI and human critical-lane review remain required before merge or any downstream activation.

#### Route Gate Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- required checks: focused payroll route/capability tests; policy; lint; typecheck; aggregate coverage; coverage threshold; build; Tier-0 routes; credentialed Playwright; responsive desktop/mobile observation; independent code, security, and test review
- executed checks: focused `121/121`; bounded aggregate `4923/4923` with `100` environment-gated skips; `92.96%` line coverage; policy, lint, typecheck, build, and Tier-0 `244/244`; both responsive viewports attempted for both affected routes; code, security, test, and fixture re-reviews approved
- blocked checks: credentialed Playwright lacks the required local `PW_*` credential pair; protected responsive surfaces lack a local authenticated synthetic administration fixture; the exact default-pool `verify:local` wrapper exits on Vitest worker `onTaskUpdate` after all assertions complete, while the bounded four-worker aggregate exits zero
- result: `pass-with-blocked-browser-checks`
- residual risk: exact-head hosted CI must adjudicate the credentialed browser path and default-pool runner; human critical-lane review is mandatory

#### Route Gate PR Hygiene Verdict

- branch isolation: pass (`codex/payroll-super-admin-route-gates`, clean worktree, synchronized with `origin/main` at `33099fc2`)
- scope: pass; client capability predicates, their consumers, tests, Cypress fixture, design/plan, and handoff only
- protected-path drift: none; no `src/server/**`, Supabase, migration, RLS, grant, workflow, runtime-config, secret, or deploy change
- reviewability: pass; focused commits and independent specialist approvals recorded
- pr-ready: yes, with blocked local browser checks disclosed and exact-head CI plus human review required

## Pay-Cycle FK Index Remediation

- Date: 2026-08-15
- Branch: `codex/win-219-pay-cycle-fk-indexes`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: add only the six minimum nonredundant btree indexes whose leading columns exactly cover the remaining foreign-key advisor notices on `public.pay_groups`, `public.pay_group_assignments`, `public.pay_group_generation_versions`, and `public.pay_periods`; add one focused migration contract; and append the migration to every required WIN-219 runtime-parity mirror.
- Non-goals: no policy, RLS, ACL, grant, function, trigger, table, data, capability, feature flag, payroll activation, deployment, historical migration edit, unused-index deletion, other advisor remediation, customer/PHI access, secret access, `.env*` access, or hosted apply.

### Hosted Read-Only Baseline

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029. Hosted migrations included `20260816031108 payroll_employee_time_events_fk_indexes` and `20260816044607 payroll_employee_rate_versions_fk_indexes`.
- The performance advisor reported exactly six scoped `unindexed_foreign_keys` notices: `pay_groups_created_by_fkey` on `(created_by)`; `pay_group_assignments_employment_profile_id_organization_i_fkey` on `(employment_profile_id, organization_id)`; `pay_group_assignments_pay_group_id_organization_id_fkey` on `(pay_group_id, organization_id)`; `pay_group_generation_versions_created_by_fkey` on `(created_by)`; `pay_group_generation_versions_pay_group_id_organization_id_fkey` on `(pay_group_id, organization_id)`; and `pay_periods_pay_group_id_organization_id_fkey` on `(pay_group_id, organization_id)`. The security advisor reported zero scoped notices.
- All four target tables had zero rows and zero-byte heaps. `pay_group_assignments`, `pay_groups`, and `pay_periods` each had 32,768 index bytes; `pay_group_generation_versions` had 32,768 index bytes. Total sizes were 32,768, 40,960, 40,960, and 32,768 bytes respectively. No competing locks were present.
- Existing valid and ready indexes were id-first or organization-first. None covered any target FK sequence in leading-column order, and the proposed definitions do not duplicate the existing organization-first payroll read indexes.
- RLS was enabled and forced on all four tables. Each retained one permissive authenticated `SELECT` policy with its existing organization, employee-read, payroll-admin, and capability checks. ACLs remained authenticated `SELECT` only and postgres full privileges; existing triggers were captured unchanged.
- Payroll remained default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts. Existing scoped unused-index notices remain informational and out of scope.

### Implementation And TDD

- RED: the focused contract ran six assertions and failed the expected three because the migration was absent, the six exact definitions were absent, and runtime parity omitted the new version. Tenant/policy invariants and forbidden-statement assertions already passed.
- GREEN: `20260816063149_payroll_pay_cycle_fk_indexes.sql` creates only `pay_groups_created_by_idx` on `(created_by)`; `pay_group_assignments_employment_profile_org_idx` on `(employment_profile_id, organization_id)`; `pay_group_assignments_pay_group_org_idx` on `(pay_group_id, organization_id)`; `pay_group_generation_versions_created_by_idx` on `(created_by)`; `pay_group_generation_versions_pay_group_org_idx` on `(pay_group_id, organization_id)`; and `pay_periods_pay_group_org_idx` on `(pay_group_id, organization_id)`, all btree and inside one transaction. Every deterministic identifier is below PostgreSQL's 63-byte limit.
- The contract proves exact FK-leading key order, rejects organization-first duplicates, pins the existing policy expressions plus enabled/forced RLS and ACL semantics, and rejects grants, revokes, functions, triggers, tables, policy changes, data mutation, capability changes, and activation statements. Runtime parity includes the version in the workflow, both policy scripts, and their tests, with a fail-closed omission regression.
- Rollback: a compensating forward migration can drop the six named indexes. Plain `CREATE INDEX` briefly blocks writes; the zero-row baseline makes that strategy acceptable only if a fresh hosted pre-apply size and lock-window check remains materially unchanged.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `database/migration/tenant isolation` and `CI/workflow/policy`
- required checks: focused pay-cycle migration test; payroll foundation, approval, security-repair, manager-index/advisor, employee-time/rate-index, tenant/RLS, runtime-parity, and deploy-safety tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - focused migration and parity batch: pass; 237/237 assertions across 3 files
  - broader targeted payroll/security/parity batch: pass; 345/345 assertions across 16 files
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:ci`: blocked locally; the default run exhausted the approximately 4 GiB Node heap and closed worker IPC. An 8 GiB retry completed 547 runnable files and 4,954 tests successfully with 100 environment-gated skips, but exited nonzero on one Vitest worker RPC `onTaskUpdate` timeout.
  - `npm run verify:local`: blocked at its embedded default-heap `npm run test:ci`; policy, lint, and typecheck passed before the test runner exhausted the approximately 4 GiB Node heap and closed worker IPC, so later wrapper stages did not run
  - `git diff --check`: pass on the final pre-commit diff
- blocked checks:
  - DB-backed privileged-function grant, sensitive-table overlap, and preview-drift subchecks -> no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication -> pending GitHub PR CI
- result: `blocked` pending exact-head CI; local infrastructure failures are not converted to passes
- independent review: specification, architecture, security, performance, test, and Supabase design reviews approved the six-index boundary. Post-implementation code, security, performance, test, and Supabase reviews found no defect. Code review suggested and received a tighter table-anchored FK source assertion; the affected focused suite remained green.
- hosted apply status: `not authorized and not applied` for `20260816063149_payroll_pay_cycle_fk_indexes`.
- residual risk: exact-head CI and human critical-lane review remain mandatory. A later plain hosted index build is safe only if fresh row-count, size, lock, advisor, and index-coverage checks remain materially unchanged. Empty-table conditions preclude representative performance measurement and can produce expected unused-index notices until legitimate payroll traffic exists.
- next action: complete PR hygiene; push a WIN-219-linked PR; wait boundedly for exact-head checks; and stop for human review without merging or applying the migration hosted.

### PR Hygiene Verdict

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; isolated `codex/win-219-pay-cycle-fk-indexes`
- linear-ready: yes; WIN-219 contains the scoped hosted baseline, branch, verification plan, and next action
- single-purpose: yes; six exact FK-leading indexes, one focused contract, required runtime-parity mirrors, and this handoff only
- unrelated changes: none; `.codex-remote-attachments/` and `.codex-tmp/` remain untracked and excluded
- generated artifact drift: none
- protected-path drift: none beyond the routed migration and required parity workflow/policy mirrors
- change summary: present
- verification summary: present, with local aggregate infrastructure failures disclosed rather than converted to passes
- pr handoff: ready; [PR #960](https://github.com/Jeduardo622/AllIincompassing/pull/960) targets `main`
- reviewer: code, security, performance, test, and Supabase reviews completed
- required follow-up: require exact-head CI and human critical-lane review; do not merge or apply hosted
- handoff summary: adds only the six minimum FK-leading indexes across four pay-cycle configuration tables and pins unchanged RLS/ACL/tenant behavior. Focused and tenant suites pass; the default local aggregate remains infrastructure-blocked, so exact-head CI and human review are mandatory.

## Pay-Cycle FK Index Hosted Apply Evidence

- Date and authority: PR #960 merged to `main` as `0d1570e9b8dcaadd72507e8195fda273c96f2171`. On 2026-08-16, the owner separately authorized applying only merged migration `20260816063149_payroll_pay_cycle_fk_indexes.sql` to Supabase project `wnnjeqheqxxyrgsjmygy`.
- Immediate gate: the project remained `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029; the migration was absent; all four target tables remained at zero rows; no competing locks existed; and no valid/ready existing index covered any of the six foreign-key sequences in leading-column order. The performance advisor still reported exactly the six scoped unindexed-FK notices, so the approved plain-index strategy remained safe.
- Immediate security state: all four tables retained enabled and forced RLS, one permissive authenticated `SELECT` policy each, authenticated read-only ACLs, and their existing triggers. Payroll remained globally default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts.
- Apply result: Supabase `apply_migration` succeeded exactly once using the merged file contents and logical name `payroll_pay_cycle_fk_indexes`. The hosted migration ledger records one generated version, `20260816143529`; Supabase assigned this apply-time ledger version independently of the merged repository filename version `20260816063149`.
- Index proof: all six indexes are valid, ready, non-unique btrees with exact definitions: `pay_groups_created_by_idx (created_by)`; `pay_group_assignments_employment_profile_org_idx (employment_profile_id, organization_id)`; `pay_group_assignments_pay_group_org_idx (pay_group_id, organization_id)`; `pay_group_generation_versions_created_by_idx (created_by)`; `pay_group_generation_versions_pay_group_org_idx (pay_group_id, organization_id)`; and `pay_periods_pay_group_org_idx (pay_group_id, organization_id)`.
- Authorization parity: post-apply catalog readback retained enabled and forced RLS, one permissive authenticated `SELECT` policy per table, null `WITH CHECK`, and ACLs `{postgres=arwdDxtm/postgres,authenticated=r/postgres}`. Policy expressions and user-trigger counts remained unchanged. No policy, grant, ACL, function, trigger, feature flag, capability, or data mutation was part of the applied SQL.
- Advisor delta: all six targeted `unindexed_foreign_keys` notices cleared, and the scoped security advisor remained empty. New `unused_index` informational notices are expected while these configuration tables remain empty and are not authorization to remove the FK-supporting indexes. See the Supabase guidance for [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Synthetic plan smoke: read-only, rolled-back `EXPLAIN` transactions used only synthetic UUID `00000000-0000-4000-8000-000000000219`; no fixture or operational row was created. The new btrees are planner-usable. On empty tables PostgreSQL sometimes preferred an existing GiST exclusion index for equivalent equality predicates, which does not weaken the catalog FK coverage or make the btrees redundant.
- Discovered pre-existing issue: an authenticated plan against `pay_group_generation_versions` fails closed with `permission denied for function current_user_is_payroll_admin`. The table's authenticated RLS policy calls `app.current_user_is_payroll_admin(uuid)`, while [`20260812153628_payroll_administration.sql`](../../../supabase/migrations/20260812153628_payroll_administration.sql) explicitly revoked authenticated `EXECUTE` and hosted `has_function_privilege` is false. Security, Supabase, and test reviewers classified this as a separate medium functional authorization defect with low confidentiality risk; it predates and does not invalidate the index-only apply. Route its repair independently.
- Final invariants: all four target tables remain empty; payroll remains globally default-disabled; enabled overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, and mutation receipts remain zero. No Edge/Netlify deployment, payroll activation, capability grant, customer/PHI access, secret access, or `.env*` access occurred.
- Rollback and residual risk: no rollback is indicated. If a separately reviewed compensating migration is ever required, it can drop the six named indexes. Residual performance risk is limited to ordinary write amplification and the absence of representative workload evidence while the tables are empty.
- Hosted apply status: `applied` as hosted version `20260816143529`. This evidence-only PR does not authorize deployment, payroll activation, capability grants, rollback, or future hosted migrations.
- Evidence PR: [#961](https://github.com/Jeduardo622/AllIincompassing/pull/961) contains only this hosted verification record and remains human-reviewed.

### Hosted Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: hosted database migration and tenant-isolation verification; repository evidence update is docs-only
- required checks: immediate hosted health/migration/row/size/lock/index/advisor gate; exact applied SQL; hosted ledger readback; index validity/readiness/definitions; RLS/policy/ACL/trigger parity; targeted performance and security advisors; payroll fail-closed invariants; synthetic PHI-free rolled-back plan smoke; `git diff --check`; exact-head evidence-PR checks
- executed checks: all hosted checks passed for the six-index objective; focused migration contract `npm test -- --run tests/payroll-pay-cycle-fk-indexes-migration.test.ts` passed 6/6; `git diff --check` passed after the evidence edit
- blocked checks: full authenticated `pay_group_generation_versions` plan proof is blocked by the pre-existing helper `EXECUTE` mismatch described above; it is not converted to a pass
- result: `pass-with-blocked-checks`; the hosted index apply is complete and safe to retain, with the unrelated fail-closed RLS helper defect separately routed
- independent review: post-apply Supabase, security, performance, and test reviews approved the migration result and agreed the helper privilege mismatch is pre-existing and outside this apply
- residual risk: representative index benefit cannot be measured on empty tables; six btrees add normal write amplification; the separate authenticated generation-version read path remains fail-closed pending its own protected fix
- exact-head evidence-PR checks: pending PR creation and recorded in the final PR handoff; they are not treated as passed here
- next action: review and merge the linked evidence-only PR identified in the final PR handoff, then route the `app.current_user_is_payroll_admin(uuid)` policy/helper execute-contract repair as the next critical WIN-219 slice

## Payroll Admin Helper Execute Contract Repair

- Date: 2026-08-16
- Branch: `codex/win-219-payroll-admin-helper-execute`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: restore authenticated `EXECUTE` on `app.current_user_is_payroll_admin(uuid)` with one forward-only grant migration; add a focused migration/runtime contract; and append the migration to the WIN-219 runtime-parity mirrors.
- Protected paths: `supabase/migrations/**`, `scripts/ci/**`, and `.github/workflows/**`.
- Non-goals: no helper or policy rewrite, RLS/table ACL change, function or trigger creation, data mutation, capability grant, activation, deployment, customer/PHI access, secret access, `.env*` access, or hosted apply.
- Stop conditions: any hosted helper/policy/ACL drift, new dependent policy, broader grantee, changed tenant/capability semantics, or need for a policy rewrite.

### Hosted Read-Only Baseline

- Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.029 and included hosted migration `20260816143529 payroll_pay_cycle_fk_indexes`.
- `app.current_user_is_payroll_admin(uuid)` remained `STABLE SECURITY DEFINER` with `search_path = ''`, caller binding through `auth.uid()`, active `admin`/`super_admin` membership, and same-organization enforcement through `app.payroll_actor_in_organization(...)`.
- Hosted function ACL was `{postgres=X/postgres}`; `authenticated`, `anon`, and `service_role` lacked `EXECUTE`. Authenticated `EXPLAIN` on each dependent surface failed closed with SQLSTATE `42501 permission denied for function current_user_is_payroll_admin`.
- Exactly three authenticated `SELECT` policies depended on the helper: `pay_group_generation_versions_authenticated_select`, `payroll_export_runs_authenticated_select`, and `payroll_export_rows_authenticated_select`. Their organization and capability predicates remained unchanged.
- `pay_group_generation_versions`, `payroll_export_runs`, and `payroll_export_rows` each had zero rows and a zero-byte heap, enabled and forced RLS, and one permissive authenticated `SELECT` policy. Their ACLs and existing trigger counts were captured unchanged.
- Targeted security advisors were empty. Payroll remained globally default-disabled with zero enabled organization overrides, active policy versions, capability grants, employment profiles, employee time events, session attendance events, or mutation receipts.

### Implementation And TDD

- RED: before the migration existed, the focused contract failed three expected assertions: missing migration, missing authenticated helper grant, and missing runtime-parity entry.
- GREEN: [`20260816153226_payroll_admin_helper_authenticated_execute.sql`](../../../supabase/migrations/20260816153226_payroll_admin_helper_authenticated_execute.sql) contains one transactional statement: `grant execute on function app.current_user_is_payroll_admin(uuid) to authenticated;`.
- The focused contract requires exactly one grant in executable SQL, rejects any revoke or broader grantee, pins the unchanged helper and all three dependent policy/capability branches, preserves enabled/forced RLS and table-read scope, and rejects policy, function, table, data, capability, or activation drift.
- The synthetic local runtime contract asserts authenticated execute is true while `service_role`, `anon`, and `public` remain false; an in-scope admin returns true, while a cross-org admin check and same-org manager check return false. It remains environment-gated when the approved local database is unavailable.
- Runtime parity now requires `20260816153226|payroll_admin_helper_authenticated_execute` in the workflow, both CI policy scripts, and both contract suites, including a fail-closed omission regression.
- Rollback is a separate compensating forward migration: `revoke execute on function app.current_user_is_payroll_admin(uuid) from authenticated;`.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/grant/tenant isolation and CI/workflow policy
- required checks: focused migration and runtime-parity contracts; deploy-safety contract; existing payroll administration/foundation/export/security/tenant/RLS/parity suites; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - `npm ci`: pass
  - RED focused contract: expected fail, 3 failed / 2 passed before implementation
  - `npm test -- --run tests/payroll-admin-helper-authenticated-execute-migration.test.ts tests/ci/check-runtime-migration-parity.test.ts`: pass, 9/9
  - `npx vitest run tests/ci/check-session-deploy-safety.test.ts --pool=forks --maxWorkers=1`: pass, 228/228
  - targeted payroll foundation, administration, export, security, tenant/RLS, and parity suites: pass for all runnable assertions; database-backed RPC assertions remained environment-gated
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:ci`: blocked locally after broad passing progress; Vitest exhausted the default approximately 4 GiB Node heap and then closed worker IPC
  - `npm run verify:local`: blocked at its embedded `npm run test:ci` for the same default-heap/closed-IPC failure; its policy, lint, and typecheck stages passed, while later coverage, build, and route stages did not run inside the wrapper
  - `git diff --check`: pass on the final pre-commit diff
- blocked checks:
  - DB-backed privileged-function grant, sensitive-table overlap, preview drift, and local RPC runtime assertions: no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication: pending GitHub PR CI
- result: `pass-with-blocked-checks`; deterministic scoped checks pass, while local aggregate infrastructure failures are not converted to passes
- independent review: specification, architecture, implementation, code, security, performance, test, Supabase, and documentation specialists support the grant-only boundary. Code review's optional stricter grant-count assertion was implemented and the focused suite reran green.
- hosted apply status: `not authorized and not applied` for `20260816153226_payroll_admin_helper_authenticated_execute.sql`.
- residual risk: authenticated users can directly invoke this boolean helper, which is required by the existing policies; confidentiality remains bounded by caller identity, active admin/super-admin membership, same-org resolution, and unchanged capability predicates. Exact-head CI and human critical-lane review remain mandatory.
- next action: complete PR hygiene, push the WIN-219-linked PR, wait boundedly for exact-head required checks, and stop for owner review without merging or applying hosted.

## Payroll Export FK Index Advisor Remediation

- Date: 2026-08-16
- Branch: `codex/win-219-payroll-export-fk-indexes`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: one forward-only index migration for the remaining `public.payroll_export_runs` and `public.payroll_export_rows` unindexed-FK advisor notices; one focused contract; five explicit WIN-219 runtime-parity mirrors; and this handoff addendum.
- Hosted preflight baseline: project `wnnjeqheqxxyrgsjmygy` remained `ACTIVE_HEALTHY`; `20260816143529/payroll_pay_cycle_fk_indexes` and `20260816172750/payroll_admin_helper_authenticated_execute` were present; targeted advisors remained ten unindexed FKs on the two export tables; both tables stayed empty with zero-byte heaps; existing organization-first indexes did not lead with the FK column order and therefore did not satisfy the advisor.
- TDD: RED was proven before implementation by the focused contract with the migration absent, producing 3 failed / 3 passed assertions. GREEN is bounded to [`20260816201115_payroll_export_fk_indexes.sql`](../../../supabase/migrations/20260816201115_payroll_export_fk_indexes.sql), which adds exactly ten nonunique plain btree indexes for the advisor-reported FK column orders and no policy, grant, ACL, function, trigger, data, capability, or activation statements.
- Runtime parity: the explicit mirrors now require `20260816201115|payroll_export_fk_indexes`.
- Hosted apply status: `not authorized and not applied`.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/tenant isolation and CI/workflow policy
- required checks: focused export migration and parity contracts; existing payroll foundation, approval, export, security, tenant/RLS, and parity suites; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - `npm test -- --run tests/payroll-export-fk-indexes-migration.test.ts tests/ci/check-runtime-migration-parity.test.ts tests/ci/check-session-deploy-safety.test.ts tests/payroll-export-ledger-migration.test.ts tests/payroll-admin-helper-authenticated-execute-migration.test.ts`: pass, 253/253
  - `npm test -- --run tests/payroll-timekeeping-foundation-migration.test.ts tests/payroll-approval-workflow-migration.test.ts tests/payroll-approval-workflow-repair-migration.test.ts tests/payroll-security-repair-migration.test.ts tests/payroll-manager-assignment-advisor-remediation-migration.test.ts tests/payroll-export-ledger-migration.test.ts tests/payroll-admin-helper-authenticated-execute-migration.test.ts tests/payroll-pay-cycle-fk-indexes-migration.test.ts tests/payroll-export-fk-indexes-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/ci/check-runtime-migration-parity.test.ts tests/ci/check-session-deploy-safety.test.ts`: pass, 322/322
  - final focused export/foundation/administration/security/tenant/parity regression run with single-worker forks: pass, 305/305
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass
- blocked checks:
  - `npm run test:ci`: blocked after broad passing progress; two unrelated UI tests timed out (`TherapistOnboarding` at 20 seconds and `SessionModal` at 10 seconds), then Vitest exhausted the default approximately 4 GiB Node heap and closed worker IPC
  - `npm run verify:local`: blocked at its embedded `npm run test:ci` after policy, lint, and typecheck passed; Vitest again exhausted the default approximately 4 GiB Node heap and closed worker IPC, so its later coverage, build, and route stages did not run inside the wrapper
  - DB-backed privileged-function grant, sensitive-table overlap, preview-drift, and runtime assertions: no local `SUPABASE_DB_URL`/`DATABASE_URL`; no `.env*` file was read
  - exact-head aggregate adjudication: pending GitHub PR CI
- result: `pass-with-blocked-checks`; focused and targeted critical-lane checks passed and the bounded slice remains review-ready, while long-running local aggregate wrappers are reported as blocked instead of converted to passes
- independent review: inline code, security, performance, test, and Supabase boundary review found the diff stayed index-only plus required parity and handoff mirrors; RLS, grants, append-only triggers, capability gates, and tenant isolation were preserved
- residual risk: the ten new btrees add ordinary write amplification once export traffic exists; representative performance benefit cannot be measured while both hosted tables remain empty; exact-head CI and human critical-lane review remain mandatory before any merge or hosted apply
- next action: complete PR hygiene, push the WIN-219-linked PR, wait boundedly for exact-head checks, and stop for owner review without merging or applying hosted

## Payroll Export FK Hosted Apply Evidence

- Date: 2026-08-16
- Evidence branch: `codex/win-219-payroll-export-fk-hosted-evidence`
- Source review: PR #964 merged at `3ef01a33d34861c23ff9d2e34d4f9d6e14785343`; all required exact-head checks passed. The optional Supabase Preview check failed before the new migration on the inherited `profiles_organization_id_fkey` seed error.
- Authorization: the owner separately authorized applying merged file `20260816201115_payroll_export_fk_indexes.sql` to project `wnnjeqheqxxyrgsjmygy`.
- Pre-apply gate: project status `ACTIVE_HEALTHY` on PostgreSQL 17.6; hosted migration absent; exactly ten targeted unindexed-FK notices remained; neither export table had an existing index with the required FK-leading order; both tables had zero rows and zero-byte heaps.
- Apply result: success through Supabase `apply_migration`. The hosted migration ledger assigned `20260816215743 / payroll_export_fk_indexes` to the exact merged SQL.
- Index proof: all ten expected indexes exist with exact definitions and are valid, ready, nonunique, and nonpartial.
- Advisor delta: targeted unindexed-FK notices on `public.payroll_export_runs` and `public.payroll_export_rows` changed from ten to zero. Targeted security advisors remain empty. The expected unused-index notices remain because both tables are empty; no index deletion is authorized.
- Authorization proof: the two authenticated permissive `SELECT` policies retain the same `app.current_user_is_payroll_admin(organization_id)` and `app.payroll_actor_has_capability(organization_id, 'payroll.export_period')` predicates. RLS remains enabled and forced; ACLs remain `postgres=arwdDxtm/postgres` and `authenticated=r/postgres`; both append-only triggers remain unchanged.
- Data and activation proof: both export tables remain at zero rows with zero-byte heaps. `payroll_timekeeping_v1` remains default-disabled with zero enabled organization overrides, and capability grants, employment profiles, employee time events, session attendance events, and mutation receipts all remain zero.
- Residual risk: the ten indexes add expected storage and write amplification after export traffic begins. Representative usage cannot be measured while the tables remain empty.
- Hosted apply status: `applied and verified`; no other hosted mutation, deployment, capability grant, payroll activation, or customer/PHI access occurred.
- Next action: merge this evidence-only PR, perform merge-proven branch/worktree cleanup, and route any remaining advisor family as a new bounded slice.

## Payroll Blocker Resolutions Advisor Remediation

- Date: 2026-08-17
- Branch: `codex/win-219-payroll-blocker-resolution-advisor-remediation`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: one forward-only migration for the remaining `public.payroll_blocker_resolutions` unindexed-FK advisor surface plus the one scoped `auth.uid()` initplan rewrite; one focused contract; explicit WIN-219 runtime-parity mirrors; and this handoff addendum.
- Protected paths: `supabase/migrations/**`, `scripts/ci/**`, and `.github/workflows/**`.
- Non-goals: no hosted apply, no deployment, no payroll activation, no capability grants, no route/UI changes, no `.env*` access, no customer or PHI access, and no remediation outside `public.payroll_blocker_resolutions`.

### Hosted Read-Only Baseline

- On Monday, August 17, 2026, Supabase project `wnnjeqheqxxyrgsjmygy` was `ACTIVE_HEALTHY` on PostgreSQL `17.6.1.029` (`server_version = 17.6`, `server_version_num = 170006`).
- Hosted migration `20260816215743 / payroll_export_fk_indexes` was present; the new blocker-resolution remediation migration was absent before implementation.
- `public.payroll_blocker_resolutions` remained empty (`exact_row_count = 0`, `heap_bytes = 0`, `total_bytes = 40960`), with enabled and forced RLS and ACL `{postgres=arwdDxtm/postgres,authenticated=r/postgres}`.
- The live table had only four indexes: `payroll_blocker_resolutions_current_state_idx`, `payroll_blocker_resolutions_id_organization_id_key`, `payroll_blocker_resolutions_org_employment_period_idx`, and `payroll_blocker_resolutions_pkey`.
- Hosted FK coverage proved only `organization_id_fkey` already had leading-index coverage. The remaining seven FK sequences lacked a covering leading index: `(actor_user_id)`, `(employment_profile_id, organization_id)`, `(pay_period_id, organization_id)`, `(previous_resolution_id, organization_id)`, `(session_attendance_correction_request_id, organization_id)`, `(time_correction_request_id, organization_id)`, and `(timekeeping_exception_id, organization_id)`.
- The authenticated `SELECT` policy `payroll_blocker_resolutions_authenticated_select` still used direct `assignment_row.manager_user_id = auth.uid()` inside the exact-manager branch while preserving the employee self-read helper, effective-date assignment checks, and capability branches for `time.review_assigned`, `time.approve_assigned`, `payroll.lock_period`, `payroll.reopen_period`, and `payroll.resolve_exceptions`.
- Payroll remained fail-closed: feature flag `payroll_timekeeping_v1` default-enabled `false` with zero overrides, and capability grants remained zero.

### Implementation And TDD

- RED: before the migration existed, the focused contract failed on the missing migration, missing seven exact FK-leading indexes, missing policy rewrite, and missing parity entry.
- GREEN: [`20260817012347_payroll_blocker_resolutions_advisor_remediation.sql`](../../../supabase/migrations/20260817012347_payroll_blocker_resolutions_advisor_remediation.sql) adds exactly seven non-unique plain btree indexes and rewrites only `assignment_row.manager_user_id = auth.uid()` to `assignment_row.manager_user_id = (select auth.uid())` inside the existing `payroll_blocker_resolutions_authenticated_select` policy.
- The migration keeps the repo governance header, depends on `20260816215743_payroll_export_fk_indexes.sql`, stays transactional with `begin` / `commit`, uses `ALTER POLICY` rather than drop/create, and does not add an `organization_id`-only duplicate index.
- The focused contract in [`tests/payroll-blocker-resolutions-advisor-remediation-migration.test.ts`](../../../tests/payroll-blocker-resolutions-advisor-remediation-migration.test.ts) pins the exact seven index sequences, the one policy-expression change, unchanged policy metadata, forced RLS, read-only ACLs, and absence of any data/function/trigger/capability/activation drift.
- Runtime parity now requires `20260817012347|payroll_blocker_resolutions_advisor_remediation` in the workflow, both CI policy scripts, and both CI contract suites, including a fail-closed omission regression in `tests/ci/check-session-deploy-safety.test.ts`.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/tenant isolation and CI/workflow policy
- required checks: focused blocker-resolution and parity contracts; adjacent payroll migration and tenant/RLS suites; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`.
- executed checks:
  - `npm ci`: pass
  - RED focused contract before implementation: expected fail
  - `npm test -- --run tests/payroll-blocker-resolutions-advisor-remediation-migration.test.ts`: pass, `7/7`
  - `npm test -- --run tests/ci/check-runtime-migration-parity.test.ts tests/ci/check-session-deploy-safety.test.ts`: pass, `234` assertions
  - targeted payroll bundle including `tests/payroll-timekeeping-foundation-migration.test.ts`, `tests/payroll-approval-workflow-migration.test.ts`, `tests/payroll-approval-workflow-rpc.test.ts`, `tests/payroll-security-repair-migration.test.ts`, `tests/payroll-manager-assignment-index-migration.test.ts`, `tests/payroll-manager-assignment-advisor-remediation-migration.test.ts`, `tests/payroll-employee-time-events-fk-indexes-migration.test.ts`, `tests/payroll-employee-rate-versions-fk-indexes-migration.test.ts`, `tests/payroll-pay-cycle-fk-indexes-migration.test.ts`, `tests/payroll-export-fk-indexes-migration.test.ts`, `tests/payroll-blocker-resolutions-advisor-remediation-migration.test.ts`, and `tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts`: pass, `89 passed / 26 skipped`
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass; line-ending warnings only
- blocked checks:
  - `npm run test:ci`: blocked outside the touched slice on Monday, August 17, 2026. The run reached the new blocker-resolution contract and kept it green, but later hit an unrelated timeout in `src/components/__tests__/TherapistOnboarding.test.tsx`, an unrelated failure in `src/components/__tests__/ProgramsGoalsTab.test.tsx` (`lets a midtier edit an existing goal target through the goal-targets PATCH route`), and finally exhausted Node's default heap with `FATAL ERROR: Ineffective mark-compacts near heap limit` plus `ERR_IPC_CHANNEL_CLOSED`.
  - `npm run verify:local`: blocked by the same inherited aggregate failures inside its embedded `npm run test:ci`; earlier wrapper stages (`ci:check-focused`, `lint`, `typecheck`) passed before it reached the same unrelated failures.
  - exact-head aggregate adjudication: pending GitHub PR CI
- result: `pass-with-blocked-checks`
- independent review: specification, architecture, security, performance, test, and Supabase reviews completed. One Supabase review response partially anchored to the earlier `employee_manager_assignments` remediation instead of this blocker-resolution table; hosted preflight plus the exact local diff resolved that disagreement in favor of the blocker-resolution scope proven here.
- hosted apply status: `not authorized and not applied` for `20260817012347_payroll_blocker_resolutions_advisor_remediation.sql`.
- residual risk: the seven new btrees add normal write amplification once blocker-resolution traffic exists, and aggregate local test infrastructure remains unstable outside the touched slice. Exact-head CI and human critical-lane review remain mandatory before any merge or hosted apply.
- next action: push the WIN-219-linked PR, wait boundedly for exact-head checks, and stop for human review without merging or applying hosted.

### PR Hygiene Verdict

- pr-ready: yes
- lane: `critical`
- branch-ready: yes; isolated `codex/win-219-payroll-blocker-resolution-advisor-remediation`
- linear-ready: yes; WIN-219 contains the hosted baseline, scoped branch, and next action
- single-purpose: yes; seven exact FK-leading indexes, one policy-expression rewrite, required runtime-parity mirrors, one focused contract, and this handoff only
- unrelated changes: none; `.codex-remote-attachments/` and `.codex-tmp/` remain untracked and excluded
- generated artifact drift: none
- protected-path drift: none beyond the routed migration and required parity workflow/policy mirrors
- change summary: present
- verification summary: present, with inherited aggregate failures disclosed rather than converted to passes
- pr handoff: ready pending push and PR creation
- reviewer: code, security, performance, test, and Supabase reviews completed
- required follow-up: require exact-head CI and human critical-lane review; do not merge or apply hosted
- handoff summary: adds only the seven missing FK-leading indexes for `public.payroll_blocker_resolutions` and rewrites only the exact manager `auth.uid()` policy branch to the approved initplan-safe form. Focused and tenant checks pass, while inherited aggregate test instability outside the touched files remains explicitly blocked for exact-head CI and human review.
