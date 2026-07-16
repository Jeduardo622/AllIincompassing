# WIN-217 BCBA Session Auth Recovery Handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- Linear: `WIN-217`
- branch: `codex/bcba-session-auth-recovery`
- files touched:
  - `src/lib/authContext.tsx`
  - `src/lib/__tests__/authContext.initializeAuth.test.tsx`
  - `src/features/scheduling/domain/sessionStart.ts`
  - `src/features/scheduling/domain/__tests__/sessionStart.test.ts`
  - planning and handoff documentation for WIN-217
- required agents: specification-engineer -> software-architect -> implementation-engineer -> code-review-engineer -> test-engineer -> security-engineer

## Change summary

- Supabase profile and role query results now preserve deterministic HTTP 401 status. Confirmed unauthorized auth queries use the existing fail-closed state, storage, sign-out, and query-cache cleanup path.
- Auth generations prevent delayed bootstrap or refresh responses from clearing or overwriting a newer valid session.
- Session start treats only HTTP 409 plus `rpcCode: "ALREADY_STARTED"` as idempotent success. `INVALID_STATUS` and all other conflicts remain errors.
- No role, tenant, RLS, grant, migration, Edge Function, server authority, billing, or runtime-config behavior changed.

## Verification card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: auth/session lifecycle; UI-to-server API integration
- required checks:
  - focused Vitest regression tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - focused Vitest regression tests -> pass, 2 files / 12 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run test:routes:tier0` -> pass, 7 specs / 220 tests
  - `npm run build` -> pass
  - `npm run test:ci` with synthetic non-secret Supabase configuration -> fail outside the changed files: `AddSessionNoteModal.test.tsx` cannot find the `Default Goal` checkbox in `locks BT session metadata and goal structure while leaving data collection editable`; the isolated file reproduces 1 failure / 20 passes
  - `npm run ci:playwright` -> blocked at preflight because no `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials are available
- blocked checks:
  - `npm run verify:local` -> its `test:ci` stage deterministically reaches the unrelated AddSessionNoteModal failure above; remaining constituent checks were run separately
  - secret-backed Playwright smoke -> required in CI
- reviewer: code-review-engineer approved after auth-generation race fix; security-engineer approved with no remaining findings
- result: `pass-with-blocked-checks`
- residual risk: hosted confirmation still depends on CI credentials and a fresh BCBA browser session; human review remains mandatory before merge

## PR hygiene inputs

- single purpose: yes
- unrelated changes: none in this isolated worktree
- protected-path drift: `src/lib/authContext.tsx` is intentionally protected and remains critical-lane
- human merge blocker: required review and CI, including credential-backed auth/session smoke

## PR #761 CI follow-up

- After `main` was merged into the PR branch, both the CI `unit-tests` job and the separate `tenant-safety` workflow failed on the same assertion in `AddSessionNoteModal.test.tsx`.
- Root cause: the BT locking test queried the `Default Goal` checkbox synchronously while the modal's sessions/programs/goals queries were still rendering the `Loading sessions...` state.
- Fix: await the existing accessible checkbox boundary with `findByRole`, matching the established pattern used by the surrounding asynchronous goal-loading tests.
- Focused verification: `npm run test -- src/components/__tests__/AddSessionNoteModal.test.tsx --run` -> pass, 21 tests.
- Full verification after the fix:
  - `npm run test:ci` with synthetic non-secret Supabase configuration -> pass, 373 files / 2476 tests, 1 integration test skipped for unavailable `WIN211_POSTGRES_URL`
  - `npm run validate:tenant` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
- Test/code review approved the one-line condition-based wait with no findings.

## Post-merge production booking authorization follow-up

- branch: `codex/win-217-bcba-booking-scope`
- classification: `high-risk human-reviewed`
- lane: `critical`
- production failure: the dedicated BCBA acceptance actor reached the legacy booking boundary with a persisted `bcba` role, but booking returned 403 because the scheduling resolver recognized only therapist, admin, org-admin, org-member, and super-admin roles.
- bounded fix:
  - resolve exact BCBA authority through `user_has_role_for_org` for the already-resolved organization
  - allow that explicit capability to book an in-organization therapist row without treating BCBA as an admin or therapist globally
  - preserve super-admin-only service-role fallback and fail closed on BCBA role RPC outages
- non-goals: no role hierarchy changes, metadata fallback, migration, grant, RLS, workflow, or synthetic-role changes

### Verification card

- required checks:
  - focused booking and role-resolution contract tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run test:routes:tier0`
  - `npm run build`
  - credential-backed hosted BCBA acceptance
- executed checks:
  - red proof: focused booking test returned 403 before the production change
  - focused Vitest regression and contract tests -> pass, 2 files / 43 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run test:routes:tier0` -> first run had one unrelated client-root redirect timing failure; bounded rerun passed, 7 specs / 220 tests
  - `npm run build` -> pass
  - `npm run test:ci` -> changed booking and edge authorization tests pass; latest aggregate local run reached 382 passed files / 2671 passed tests and failed only the existing Windows CRLF-sensitive workflow-text assertion in `check-e2e-reliability-gates.test.ts`
- blocked checks:
  - `npm run verify:local` -> not repeated because its `test:ci` stage deterministically reaches the unrelated Windows-only CRLF assertion above
  - credential-backed Playwright proof -> required on the hosted main workflow after human review and merge
- reviewer: security/code review completed with no blocking authorization findings
- result: `pass-with-blocked-checks`
- residual risk: the booking path performs one additional fail-closed exact-role RPC when BCBA authority may be needed; final production proof remains pending until the PR is reviewed, merged, deployed, and the dedicated BCBA lifecycle and measurement checks pass with zero-residue cleanup

### PR #774 review follow-up

- P1 downstream edge authorization: `sessions-hold` and `sessions-confirm` both use the shared target-therapist authorization helper, which still omitted exact `bcba`; the helper now includes persisted BCBA without changing the target therapist or organization scope.
- P2 therapist self-booking availability: exact BCBA authority is now queried in the Node booking boundary only when base roles do not authorize the caller or a therapist is booking another therapist row. Therapist self-booking no longer depends on the BCBA RPC.
- cancellation non-goal: `sessions-cancel` also imports the shared helper, but its earlier explicit cancellation-role gate still excludes BCBA-only callers, so cancellation authority is unchanged.
- red proof:
  - exact BCBA returned 403 from the shared edge authorization helper
  - therapist self-booking returned 502 when the unnecessary BCBA RPC returned 503
- focused green proof:
  - Node booking, role payload, edge authorization, and hold/confirm shared-helper contract tests -> pass, 5 files / 49 tests
- deployment requirement: the shared edge bundle deploys only on a push to `main`; PR checks cannot serve as final production evidence. After human merge, require `deploy-session-edge`, dedicated BCBA lifecycle, measurement roundtrip, and zero-residue cleanup to pass on the main workflow.

### PR #775 main-proof database follow-up

- main run: `29265715986` on merge commit `44a3f92ad08650cf098dde6142e74e58216cc7ad`
- passed before the decisive failure:
  - main-only `deploy-session-edge`, including new `sessions-hold` and `sessions-confirm` bundles
  - ordinary auth smoke and the full session browser smoke gate
  - synthetic BCBA provision and both cleanup steps
- decisive failure: the dedicated BCBA lifecycle repeatedly received 403 from `sessions-hold` and timed out in `book-session`; hosted edge logs confirmed the 403 responses.
- root cause: the edge helper accepted exact persisted `bcba`, but the privileged seven-argument `acquire_session_hold` RPC repeated the role check with only therapist, admin, and super-admin.
- bounded fix: one forward migration adds exact `bcba` to that existing target-therapist-scoped role check, fails closed unless the therapist, client, and optional session share the same active organization boundary, and preserves the remaining hold/conflict behavior plus service-role-only execution.
- non-goals: no `confirm_session_hold` rewrite, RLS/grant widening, role aliases, edge-function changes, or generated type changes.
- red/green proof:
  - red: focused migration contract failed because the forward migration was absent
  - green: migration contract plus shared edge authorization tests passed, 2 files / 7 tests
- cleanup proof from the failed main run: the BCBA auth actor was deleted with `profiles=0`, `user_roles=0`, and `user_therapist_links=0` residual rows.
- PR #776 hosted migration promotion:
  - the Supabase preview applied the migration, but the PR runtime-parity job correctly failed because the production ledger was still missing it
  - the exact reviewed migration was applied through the canonical Supabase migration API and recorded as `20260713180735_acquire_session_hold_bcba_authorization`
  - the repo filename was aligned to that canonical hosted version per migration-governance policy; no SQL body changed during the rename
  - hosted structural verification confirmed the exact BCBA role check, active same-org client/session guards, fixed `search_path`, and execute grants limited to `postgres` plus `service_role`
- remaining proof: merge the human-reviewed repo lineage, then require the dedicated BCBA lifecycle and measurement roundtrip to pass with another zero-residue cleanup.

### PR #776 active-status review follow-up

- Codex P2 finding: the first database boundary required non-deleted therapist/client rows in one organization but did not reject lifecycle statuses such as `inactive`, `on_hold`, or `discharged`.
- The first hosted migration remains immutable because production already recorded version `20260713180735`; changing only that file would create false version parity without updating the live function.
- A new forward migration redefines the same seven-argument RPC with exact `t.status = 'active'` and `c.status = 'active'` predicates while preserving same-organization reassignment and service-role-only execution.
- The forward migration was applied through the Supabase migration API and recorded canonically as `20260713183443_acquire_session_hold_active_status`.
- Hosted structural verification confirms both active-status predicates, `SECURITY DEFINER`, and fixed `search_path=public`.
- Focused migration, runtime-parity, and edge authorization tests pass, 3 files / 17 tests.
- Remaining proof: fresh PR CI and review, human merge, then the main-run dedicated BCBA lifecycle, measurement roundtrip, and zero-residue cleanup.

### Post-merge Supabase Validate fixture repair

- main run: Supabase Validate `29276383954`, job `86906395257`
- failure scope: five live RLS suites failed because their shared therapist fixture omitted the schema-required `first_name` and `last_name`; the security RLS suite also reused timestamp-only auth emails while the test environment freezes `Date`, causing `email_exists` on later runs.
- classification: `low-risk autonomous`
- lane: `standard`
- bounded fix:
  - seed the required therapist name fields in the shared live RLS harness and security RLS fixtures
  - derive shared harness record emails from fixture UUIDs
  - use `randomUUID()` for security-suite auth identities so repeated and parallel runs do not collide when time is frozen
  - add a source contract test covering the required therapist fields and run-unique identity inputs
- non-goals: no production schema, migration, RLS, grant, auth, runtime, workflow, or application behavior changes
- local verification:
  - red proof: the new fixture contract failed 5/5 assertions before the repair
  - focused fixture contract -> pass, 1 file / 6 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> fixture contract and 384 files passed; aggregate failed only the existing Windows CRLF-sensitive workflow-text assertion in `check-e2e-reliability-gates.test.ts` (2682 tests passed, 1 failed, 3 skipped)
- residual risk: the affected live database suites require hosted credentials, so the repair remains unproven until Supabase Validate reruns successfully on the focused PR.
- next proof: merge the fixture-only repair after hosted Supabase Validate passes, then require the fresh main workflow to pass the dedicated BCBA lifecycle, measurement roundtrip, and zero-residue cleanup.

#### Hosted validation trigger follow-up

- PR #777 initially could not launch the decisive database job: `Supabase Validate` watched only migration changes, and its credential-backed `test-main` job intentionally runs only on trusted pushes to `main`.
- reclassification: `high-risk human-reviewed`; lane: `critical` because `.github/workflows/supabase-validate.yml` is protected CI policy.
- bounded workflow fix: add only the three live-fixture/test files to the existing `push.paths` filter and declare `permissions: contents: read`.
- security boundary: fixture changes do not broaden `pull_request.paths`; service-role tests remain unavailable to PR-head code and execute only after a trusted main merge.
- contract proof: the fixture contract normalizes platform line endings, requires the three exact main-push paths, confirms they are absent from the PR filter, and preserves the push-only database job condition.
- merge proof requirement: the merge of PR #777 must start `Supabase Validate`; `Run application tests` must execute all six formerly failing suites with no `23502`, no `email_exists`, and no skipped live RLS suite.

#### Second hosted fixture drift repair

- merged PR #777 triggered Supabase Validate run `29280537187`; the trusted `Run application tests` job executed and failed six suites after the first fixture defects were cleared.
- remaining failure scope:
  - five shared-harness suites referenced synthetic organization UUIDs before inserting matching `organizations` rows, producing `23503 session_holds_organization_id_fkey`.
  - `src/tests/security/rls.spec.ts` called the retired two-argument `assign_therapist_role` shape; hosted PostgREST exposes `assign_therapist_role(p_therapist_id)`.
- classification: `low-risk autonomous`; lane: `standard`.
- bounded fix:
  - create UUID-scoped organization rows before dependent live RLS fixtures and delete them last.
  - use the current unary therapist-role RPC argument in both security fixtures.
  - make shared-harness setup failure-safe with tracked auth users, reverse-dependency cleanup, surfaced cleanup errors, and UUID auth emails.
  - move security-suite session-hold cleanup ahead of parent tenant fixture deletion.
- non-goals: no migration, production schema, RLS, grant, application auth, runtime, or workflow changes.
- focused proof:
  - red contract: 2 new organization/cleanup assertions failed before implementation.
  - fixture schema contract -> pass, 1 file / 9 tests.
  - `npm run typecheck` -> pass.
  - `npm run ci:check-focused` -> pass.
  - `npm run lint` -> pass.
  - `npm run validate:tenant` -> pass.
  - `npm run build` -> pass.
  - `npm run test:ci` -> the fixture contract and 384 files passed; the aggregate failed only the pre-existing Windows CRLF-sensitive workflow-text assertion in `check-e2e-reliability-gates.test.ts` (2685 tests passed, 1 failed, 3 skipped). The same merged-main unit-test job passes on Linux.
- hosted proof requirement: after merge, Supabase Validate must execute all six affected suites with no `23503`, no `PGRST202`, and no skipped live RLS suite.

Verification card:

- lane: `standard`
- required checks: focused fixture contract, policy, lint, typecheck, tenant safety, build, full unit suite, reviewer
- executed checks: focused contract 9/9, policy pass, lint pass, typecheck pass, tenant safety pass, build pass, reviewer no P1/P2
- blocked checks: hosted database suites require trusted main credentials; local full suite has one unrelated Windows CRLF-sensitive workflow-text failure while merged-main Linux unit tests pass
- result: `review-ready`, pending PR CI and trusted post-merge Supabase Validate
- residual risk: hosted schema behavior is not proven until the trusted main run executes all six affected suites without skips

### Hosted ALREADY_STARTED modal proof repair

- main CI run `29280537191`, job `86921889442`, passed authentication, booking, session fallback start, hosted status polling, and explicit `409 ALREADY_STARTED` recovery before timing out in the proof harness.
- root cause: the lifecycle locator matched both `Edit Session` and `Live session`, then waited for that combined locator to become hidden. The successful recovery correctly transitioned the same visible dialog from edit mode to live mode, so the assertion could never finish.
- classification: `low-risk autonomous`; lane: `standard`.
- bounded fix:
  - scope the hidden-state wait to `[data-session-modal-mode="edit"]`.
  - accept either a visible live modal or a closed modal after recovery.
  - continue rejecting a stale edit modal or visible session-start failure alert.
- non-goals: no production modal, route, auth, workflow, database, or runtime behavior changes.
- verification card:
  - required checks: focused lifecycle regression, lint, typecheck, reviewer, hosted auth-browser-smoke.
  - executed checks: red proof 2/2 new assertions failed before implementation; focused regression 15/15 pass; lint pass; typecheck pass.
  - blocked checks: hosted auth-browser-smoke requires the trusted main workflow and synthetic credentials.
  - result: `review-ready`, pending PR checks and trusted post-merge acceptance.
  - residual risk: the full lifecycle and measurement roundtrip remain unproven until the merged-main hosted job passes both commands and cleanup.

PR validation also exposed saturated hosted booking data: run `29291802604` found eight authorized therapist-client pairs, but the first three had no conflict-free candidate window and the default three-pair bound stopped before the remaining candidates. The harness default now checks all eight already-bounded candidates while preserving the environment override, excluded-pair tracking, and the five-minute booking step timeout. Focused regression: 15/15 pass after a red default-bound assertion.

### Hosted Supabase RLS fixture stabilization

- main Supabase Validate run `29290517486` failed from deterministic test-fixture defects before its later Auth `429` cascade.
- classification: `low-risk autonomous`; lane: `standard`; production schema, policies, auth code, workflows, and shared Supabase helpers are non-goals.
- bounded repair in `src/tests/security/rls.spec.ts`:
  - cache one access token per synthetic actor and create isolated request clients with that actor's bearer token, avoiding repeated password endpoint calls without sharing identities.
  - replace unsupported post-insert conflict chaining with an error-checked role insert.
  - send date/time-only values to `ai_session_notes` date/time columns.
  - seed the retention transcript against its own tracked synthetic session to preserve the one-transcript-per-session constraint.
- tenant boundary: every actor remains bound to its own JWT and organization; all cross-organization assertions remain unchanged.
- verification card:
  - required checks: focused RLS test, lint, typecheck, policy, tenant validation, test suite, build, reviewer, trusted hosted Supabase Validate.
  - executed checks: focused local static path 121/121 pass; lint pass; typecheck pass; focused policy pass; tenant validation pass; build pass; independent tenant review found no P1/P2; the isolated Schedule close-readiness test passed 4/4 after one full-suite concurrency failure.
  - blocked checks: the live RLS path and Auth rate-limit proof require trusted hosted Supabase credentials; local `test:ci` retains the pre-existing Windows workflow-text parsing failure in `check-e2e-reliability-gates` (12/13 pass), while Linux CI is authoritative for that contract.
  - result: `review-ready` after remaining local gates and reviewer; hosted validation remains decisive.
  - residual risk: unrelated live integration suites in the same failed run may require a subsequent isolated fixture repair after these first causes are removed.

### Hosted Supabase Validate fixture hydration

- main run `29303205785` failed 47 live integration assertions across six files while runtime migration parity passed.
- shared evidence showed newly created actors resolving to default or stale hosted rows (including `test-session-1`), empty tenant reads, and `42501` authorization failures.
- classification: `high-risk human-reviewed`; lane: `critical`; the change is test-only but uses service-role fixture writes against hosted tenant-sensitive tables.
- bounded fix:
  - explicitly upsert active, tenant-bound profiles for synthetic therapist, client, and admin actors and fail on hydration errors.
  - add the authoritative active `user_roles` mapping for client actors instead of relying on `profiles.role` alone.
  - preserve a null-organization, unprivileged outsider profile for fail-closed assertions.
  - compare hosted timestamp values by instant rather than PostgreSQL's equivalent UTC offset formatting.
- non-goals: no RLS policy, migration, function, workflow, production auth, or tenant behavior changes.
- verification card:
  - required checks: focused fixture/RLS tests, lint, typecheck, policy, tenant validation, build, tenant-focused review, human review, trusted hosted Supabase Validate rerun.
  - executed checks: seven focused files 141/141 pass; lint pass; typecheck pass; focused policy pass; tenant validation pass; build pass; focused reviewer found no P1/P2.
  - blocked checks: `RUN_DB_IT=1` live assertions require trusted CI Supabase secrets.
  - result: `human-review-ready`; hosted CI remains decisive.
  - residual risk: fixture correctness against current hosted RLS cannot be proven locally and the critical lane requires human approval before merge.

### Synthetic BCBA authorization fixture

- trusted main CI run `29299849202` proved the five-script session suite, including note measurement create/edit roundtrip, and explicitly logged `verified hosted 409 ALREADY_STARTED UI recovery` for the synthetic BCBA.
- the final BCBA lifecycle then failed at `seed-session-goal-notes-for-no-show` because the actor's fixed therapist/client pair had no approved authorization.
- classification: `high-risk human-reviewed`; lane: `critical`; human review is required before merge because the provisioner uses service-role writes to authorization tables.
- bounded fix:
  - validate the existing fixed therapist, resolve a deterministic linked client through `client_therapist_links`, and ensure both remain active and in the expected organization.
  - create one run-owned approved authorization and service for that exact pair, with a broad synthetic date window.
  - identify all clinical fixtures by `created_by = synthetic actor user id`; cleanup notes, services, and authorization before identity mappings and Auth deletion.
  - include clinical tables in residual-row assertions.
- non-goals: no production authorization behavior, schema, policy, function, workflow, or real tenant data changes.
- verification card:
  - required checks: focused provisioner tests, lint, typecheck, policy, tenant validation, test suite, build, security/tenant review, human review, trusted-main BCBA acceptance.
  - executed checks: focused provisioner tests 10/10 pass; lint pass; typecheck pass; focused policy pass; tenant validation pass; build pass.
  - blocked checks: provision/cleanup against hosted Supabase and the final acceptance proof require trusted CI secrets and a merged main commit.
  - result: `human-review-ready`; focused reviewer found no P1/P2 after the client fixture was changed to resolve through the tenant-scoped therapist linkage.
  - residual risk: the authorization fixture is tenant-sensitive and must not be merged without human review; the final BCBA lifecycle and cleanup remain unproven until trusted main reruns.

### Hosted RLS profile-guard provisioning follow-up

- merged PR #781 triggered Supabase Validate run `29333204173`; runtime migration parity passed, but all six live RLS files stopped during setup with `42501 role is immutable for this role`.
- root cause: service-key PostgREST fixture upserts do not populate the request JWT role setting used by the profile immutability guard, so the explicit profile hydration added in PR #781 is rejected before any tenant assertion runs.
- classification: `high-risk human-reviewed`; lane: `critical`; the repair adds one service-only security-definer function and updates hosted tenant fixtures.
- bounded fix:
  - require a synthetic `@example.com` auth user carrying an unexpired service-authored app-metadata marker.
  - require exactly one active role across the complete authoritative `user_roles` set and reject unexpected or additional roles, including `super_admin`.
  - derive the organization from the non-deleted therapist/client record or admin auth metadata and require it to match the requested tenant.
  - use the existing transaction-local profile-guard bypass only inside the function, revoke execution from public/anon/authenticated, and grant it only to `service_role`.
  - call the function only after each fixture's authoritative role and tenant record exist; leave the no-organization outsider fail-closed.
- non-goals: no production RLS-policy relaxation, user-facing auth behavior, workflow change, real user/data mutation, or broader profile-guard bypass.
- verification card:
  - required checks: migration contract, focused live-RLS static paths, lint, typecheck, policy, tenant validation, build, security review, test review, human review, and trusted hosted Supabase Validate.
  - executed checks: red migration contract failed before the migration existed; eight focused files 146/146 passed; lint pass; typecheck pass; policy pass; tenant validation pass; build pass; security review identified and the patch closed an additional-role fail-closed gap; hosted-path tests now cover wrong-tenant, expired-marker, and authenticated-caller rejection.
  - blocked checks: applying the migration and running `RUN_DB_IT=1` require the trusted main Supabase workflow and secrets; the local full coverage suite timed out after 182 seconds in unrelated AI-documentation network/finalization tests before producing a result.
  - result: `human-review-ready`; final security/test review found no remaining P1/P2 after the additional-role and cleanup fixes.
  - residual risk: the service-only RPC and hosted fixture path remain unproven against the deployed schema until a trusted post-merge Supabase Validate run passes all six files.

### Trusted-main IEHP generation test synchronization

- trusted main CI run `29339215591` stopped in `unit-tests` before build and the hosted BCBA acceptance job could run.
- root cause: both IEHP DOCX tests synchronized on the assessment document row, then synchronously queried a button whose label is updated by a later selected-assessment effect. Under full coverage load, the query could race that state update.
- classification: `low-risk autonomous`; lane: `standard`.
- bounded fix:
  - await the existing accessible `Generate completed IEHP DOCX` button in both equivalent tests.
  - preserve the existing enabled-state wait and all production component behavior.
- non-goals: no component, route, auth, workflow, database, or runtime behavior changes.
- verification card:
  - required checks: focused repeated regressions, full component test file, policy, lint, typecheck, full unit coverage, build, reviewer, PR CI.
  - executed checks: both focused IEHP tests passed five consecutive runs; full component file passed 98/98; policy, lint, typecheck, and build passed; tier-0 routes passed 220/220; full coverage reached 2691 passing tests with the IEHP tests green; focused reviewer found no P1/P2.
  - blocked checks: local Windows full coverage has one unrelated CRLF-sensitive workflow-text assertion in `check-e2e-reliability-gates`; the same contract passes in Linux CI, which is authoritative for PR closure.
  - result: `pass-with-blocked-checks`, pending PR CI.
  - residual risk: trusted-main BCBA acceptance remains blocked until this unit gate fix merges and main reruns; Linux CI must confirm the complete coverage suite.

### Hosted RLS Auth marker hydration follow-up

- trusted main Supabase Validate run `29340501370` passed runtime migration parity but all six live RLS files stopped at the first synthetic actor with `42501 One active synthetic RLS role is required`.
- a rollback-only production database probe proved the deployed RPC succeeds when the actor has `marker=true`, an unexpired marker timestamp, and exactly one active `admin` role; the probe deliberately raised at completion so all synthetic rows rolled back.
- classification: `high-risk human-reviewed`; lane: `critical`; the bounded repair remains test-only but mutates hosted Auth app metadata with the service role.
- bounded fix:
  - explicitly persist the expiring `ci_rls_fixture` app-metadata marker after each hosted Auth actor is created.
  - read the actor back through the Admin API and fail before role/profile provisioning unless the marker is present and unexpired.
  - keep the existing service-only RPC, complete role-cardinality check, tenant derivation, grants, and fail-closed assertions unchanged.
- non-goals: no migration, RLS policy, function, grant, workflow, production auth behavior, role taxonomy, or real tenant data change.
- verification card:
  - required checks: red/green marker helper contract, lint, typecheck, focused RLS paths, policy, tenant validation, build, security/test review, human review, and trusted hosted Supabase Validate.
  - executed checks: the helper contract failed before implementation and passed 3/3 afterward; seven focused files passed 145/145; lint passed; typecheck passed; policy passed; tenant validation passed; build passed; rollback-only hosted RPC probe passed with `{admin}` and the exact marker preconditions; independent code and security review found no remaining P1/P2.
  - blocked checks: the six live RLS suites require trusted CI secrets and remain decisive; local Windows full coverage reached 2697 passing tests with two unrelated failures in the CRLF-sensitive workflow parser and the Node Blob test implementation.
  - result: `human-review-ready`; pending PR checks, human review, and trusted hosted validation.
  - residual risk: Admin API create behavior is the only prerequisite not directly observable after failed-run cleanup; explicit update plus readback makes that prerequisite deterministic and observable on the next hosted run.

### Hosted RLS authoritative-role reconciliation follow-up

- trusted main Supabase Validate run `29343649846` proved Auth marker update/readback was not sufficient: all six live RLS files still failed the composite role guard after 2557 other tests passed.
- classification: `high-risk human-reviewed`; lane: `critical`; the change remains test-only but uses service-role writes to authoritative `user_roles` rows for newly created synthetic actors.
- bounded fix:
  - require a just-created dotted `@example.com` actor with a true, unexpired Auth app-metadata marker before any role mutation.
  - deactivate role rows only for that synthetic user ID, upsert the explicitly expected `admin`, `therapist`, or `client` role as active/non-expiring, and read back the complete active set.
  - fail closed unless the active set is the exact expected singleton before calling the unchanged service-only profile RPC.
  - route all normal provisioning paths through the shared marker -> role -> RPC preflight; keep wrong-tenant, expired-marker, and authenticated-caller guardrail calls raw.
- non-goals: no migration, function, RLS policy, grant, workflow, production auth/role behavior, real user mutation, or tenant derivation change.
- verification card:
  - required checks: red/green role-reconciliation contract, focused hosted-RLS static paths, lint, typecheck, policy, tenant validation, build, code/security/test review, human review, and trusted hosted Supabase Validate.
  - executed checks: the role-reconciliation contract failed before implementation and passed 4/4 afterward, including explicit actor scoping on the destructive update and verification read; nine focused hosted-RLS files passed 158/158; lint, typecheck, policy, tenant validation, and build passed; independent code review found one scoping-assertion test gap and the final contract closes it; final security review found no P1/P2.
  - blocked checks: trusted live suites require CI secrets and remain decisive.
  - result: `human-review-ready`; pending PR CI, human merge, and trusted hosted validation.
  - residual risk: the previous RPC error combines multiple predicates, so only the trusted run can confirm authoritative role state was the remaining failed precondition.

### Hosted RLS profile-guard predicate diagnostics

- trusted main Supabase Validate run `29345329595` passed 2558 tests after PR #786 reconciled and read back each synthetic actor's exact authoritative role, but the same six hosted suites still failed with the RPC's composite `42501`.
- live `pg_get_functiondef` inspection confirmed production matches the committed function; Auth audit evidence confirms dotted synthetic emails, and the harness confirms the expected active/non-expiring role singleton before the RPC. The remaining unobserved boundary is the database view of `auth.users.raw_app_meta_data` marker/expiry.
- classification: `high-risk human-reviewed`; lane: `critical`; the forward migration replaces only the existing service-only function body with staged fail-closed checks.
- bounded change:
  - preserve the function signature, `SECURITY DEFINER`, empty search path, service-role-only ACL, existing role allowlist/cardinality, authoritative tenant derivation, profile update, bypass reset, and return semantics.
  - separate actor existence, dotted email, raw marker, parseable/future expiry, active role cardinality, and allowed-role checks.
  - return only stage-specific generic `42501` messages plus boolean/count detail; never include actor IDs, emails, metadata, role values, or tenant IDs.
- non-goals: no policy, RLS, table, role taxonomy, caller grant, workflow, production-user mutation, or acceptance-criteria relaxation; this diagnostic migration does not yet claim to repair the hidden actor-state defect.
- verification card:
  - required checks: RED/green migration contract; focused hosted-RLS tests; policy; lint; typecheck; `test:ci`; tenant validation; build; independent code/test/security review; human review; exact migration promotion; live ACL/function-definition verification; trusted Supabase Validate.
  - executed checks: the generated empty migration failed 4/4 contract tests before implementation and passed 4/4 after; nine focused files passed 159/159; the 14 server contracts affected by the missing local public test configuration pass with explicit synthetic values; policy and migration governance passed; tenant validation passed; lint passed; typecheck passed; build passed; live production definition/ACL inspection confirmed the predecessor function is deployed and service-role-only; final specification, architecture, code, test, and security review found no remaining P1/P2 after the tenant-read and contract-strengthening fixes.
  - blocked checks: local `test:ci` reached the unrelated server contract group but 15 assertions failed because this isolated worktree has no `VITE_SUPABASE_URL`; trusted Linux PR CI is authoritative. Runtime compilation, exact migration application, ACL readback, and the six live suites require the protected hosted project and human-reviewed promotion.
  - result: `human-review-ready-with-blocked-checks`; pending PR CI, human merge, migration promotion, and trusted hosted evidence.
  - residual risk: the next hosted failure will identify the rejected database predicate but may require one more contained repair; no BCBA lifecycle proof is complete until hosted RLS validation and the final production-style acceptance both pass.

### PR #790 exact lifecycle goal-note coverage follow-up

- branch: `codex/win-217-no-show-lifecycle`
- classification: `low-risk autonomous`
- lane: `standard`
- hosted failure: CI run `29352677270`, job `87153978141`, passed preflight and no-show, then the completed lifecycle timed out without observing `sessions-complete` while the modal remained open.
- root cause: the harness asserted only that at least one `session_goals` row and one `client_session_notes` row existed. Production close readiness requires a non-empty persisted `goal_notes` entry for every linked session goal; filling an unsaved modal textarea did not satisfy that contract.
- bounded fix:
  - guarantee the specifically booked goal is linked without removing unrelated existing session goals.
  - seed one synthetic note payload covering every unique linked goal.
  - validate exact persisted per-goal coverage across all note rows before and after terminal close.
  - remove the UI-only textarea filler introduced by the first PR #790 attempt.
- non-goals: no production UI, Schedule readiness, API/server, auth, workflow, migration, RLS, tenant-policy, timeout, or fallback-policy changes.

Verification card:

- required checks: focused lifecycle tests; policy; lint; typecheck; `test:ci`; build; tier-0 routes; `verify:local`; independent review; hosted auth browser smoke.
- executed checks:
  - RED proof: the two helper suites produced 6 failures / 2 passes against the old count-only and single-goal behavior.
  - focused lifecycle tests -> pass, 3 files / 23 tests.
  - `npm run ci:check-focused` -> pass.
  - `npm run lint` -> pass.
  - `npm run typecheck` -> pass.
  - `npm run build` -> pass.
  - `npm run test:routes:tier0` -> pass, 7 specs / 220 tests.
  - independent code review -> no actionable findings; strict CI remains fail-closed.
- blocked checks:
  - `npm run verify:local` reaches unrelated local `test:ci` failures before coverage/build/browser stages: the existing Windows workflow-text parser assertion receives an empty provision step, and Schedule event tests exhibit suite-order duplicate-modal state. The Schedule event file passes alone, 5/5; build and tier-0 were run separately and pass. The prior Linux PR unit job passed on the unchanged workflow state.
  - secret-backed `playwright:session-complete` and full auth browser smoke require hosted CI credentials.
- result: `review-ready-with-blocked-checks`, pending fresh PR #790 hosted CI.
- residual risk: only the hosted strict lifecycle can prove the modal now emits and receives `sessions-complete`; if exact persisted coverage is logged before click but no request is emitted, stop and add bounded request/readiness diagnostics rather than increasing timeouts.

### WIN-217 BCBA provisioning and trusted RLS transport repair

- branch: `codex/win-217-bcba-rls-validation-repair`
- classification: `high-risk human-reviewed`
- lane: `critical`
- root causes:
  - main CI assumed the fixed BCBA therapist already had a `client_therapist_links` row, while the hosted fixture instead has one client shared by same-tenant sessions and approved authorizations.
  - the trusted `admin_actions` test omitted the organization required by the deployed tenant-scoped policy.
  - MSW wildcard handlers intercepted marked live Supabase REST/Auth requests, and jsdom `Blob` uploads stalled all six Storage policy tests.
- bounded fix:
  - deterministically resolve exactly one client from the intersection of same-org therapist sessions and approved authorizations, then retain the existing active-client tenant checks.
  - include and assert `organization_id` in the admin action fixture.
  - require `RUN_DB_IT`, the configured Supabase host, and an exact internal test marker before MSW passthrough; run live RLS files under Node and upload `Uint8Array` bodies.
- non-goals: no migration, production policy, grant, workflow, runtime auth, tenant model, timeout, or real customer-data change.

Verification card:

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: CI smoke fixture plus database/RLS/Storage integration-test harness
- required checks: focused RED/GREEN tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; independent code, security, and Supabase review; trusted hosted Supabase Validate; main auth browser smoke.
- executed checks:
  - RED proof: 2 files / 7 tests failed before implementation for the missing resolver and permissive unmarked bypass.
  - focused GREEN tests: 3 files / 28 tests passed.
  - secretless RLS load paths: 124 security tests and 16 integration tests passed.
  - `npm run ci:check-focused`, `npm run lint -- --quiet`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed.
  - `npm run test:ci` reached 2710 passing tests; focused reruns reproduce only the two unrelated Windows baseline failures described below.
  - tier-0 routes reached 212 passes; one spec had two preview-server 404 session-setup failures while the other six specs passed.
  - independent code, security, and Supabase reviews found no actionable findings.
- blocked checks:
  - local Windows `test:ci` remains blocked by the existing CRLF-sensitive workflow-text assertion and jsdom `Blob.text()` mismatch; neither affected file changed.
  - local tier-0 completion is blocked by transient preview-server 404s during `routes_client.cy.ts` session setup.
  - trusted Supabase Auth/REST/Storage validation and the production-style BCBA lifecycle require protected CI credentials.
- result: `human-review-ready-with-blocked-checks`; pending PR CI, human review, merge, trusted Supabase Validate, and main auth browser smoke.
- residual risk: local tests cannot prove actual hosted Auth/REST/Storage transit or the fixed hosted BCBA fixture; those two trusted post-merge checks remain decisive.

PR #791 follow-up:

- first PR unit run `29372715973` exposed that CI supplies Supabase secrets even when `RUN_DB_IT` is absent. Routing the RLS suites through Node unconditionally changed the ordinary mocked unit contract and produced 27 failures; this was a test-environment containment defect, not new hosted policy evidence.
- the first containment correction restored jsdom without `RUN_DB_IT`, but rerun `29373376848` proved ordinary CI still entered the hosted fixture lifecycle because `CI=true` independently enabled the suite; the real secret-backed run again produced 27 mixed live/mock failures.
- suite execution, Node routing, and MSW passthrough now all require explicit `RUN_DB_IT`. Ordinary CI keeps static contracts but does not create hosted fixtures; the trusted main-only Supabase workflow already sets `RUN_DB_IT: '1'` and therefore retains real Node Auth/REST/Storage transport.
- the workflow/config contract asserts all three gates share the explicit trust predicate. The four focused helper/contract files pass 38/38; lint, typecheck, and policy pass. Trusted hosted proof remains pending.
- the PR `auth-browser-smoke` job was green only because change-scope deliberately skipped provisioning and acceptance. It is not counted as BCBA proof; the main push job remains decisive after human merge.

### WIN-217 trusted RLS authorization-boundary follow-up

- branch: `codex/win-217-trusted-rls-followup`
- classification: `high-risk human-reviewed`
- lane: `critical`
- current hosted evidence: main CI run `29374337742` is green but scope-skipped BCBA provision/acceptance/cleanup; Supabase Validate run `29374337756` exposed fixture drift plus real client-authorization and session-CPT tenant leaks after the original admin-action and Storage timeout failures were repaired.
- bounded fix:
  - bind client authorization reads to the requested client and add client-owned document create-and-read access only for the caller's canonical client path; overwrite remains out of scope.
  - replace every permissive `session_cpt_entries` policy with organization/session-scoped admin, super-admin, therapist, and service-role policies.
  - restore the checked-in therapist-certification contract: same-org admins and the owning active therapist may manage a certification; cross-org actors remain denied.
  - repair live fixture foreign keys, program/goal links, guardian/observer profiles, stale service-only expectations, Edge error status assertions, and marked live transport.
  - update `assign-therapist-user` to use the deployed therapist `status`/`deleted_at` schema and server-controlled caller/target profiles instead of nonexistent `is_active` and mutable auth metadata.
  - classify `assign-therapist-user` changes as an admin/auth browser surface so the trusted main workflow executes BCBA provision, acceptance, and cleanup instead of scope-skipping them.
- non-goals: no workflow job changes, generic authenticated storage access, broad role-helper rewrite, production data backfill, or weakening of the unresolved cross-org `manage_admin_users` denial contract.

Verification card:

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation, Edge integration, and trusted hosted test harness
- required checks: focused contracts; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; `npm run verify:local`; independent critical-lane review; fresh hosted Supabase Validate; non-skipped main BCBA acceptance.
- executed checks:
  - focused contracts -> pass, 5 files / 41 tests, including active-role, assigned-therapist, client create/read, session/org consistency, canonical-profile assertions, and exact BCBA auth-smoke selector coverage.
  - `npm run ci:check-focused` -> pass, with DB-URL-backed advisor/grant checks explicitly skipped locally.
  - `npm run lint` -> pass.
  - `npm run typecheck` -> pass.
  - `npm run validate:tenant` -> pass.
  - `npm run build` -> pass.
  - `npm run test:ci` -> fail locally after 2,721 passes on two unchanged Windows/Node 24 portability assertions: CRLF-sensitive workflow step extraction and jsdom Blob without `text()`.
  - `npm run test:routes:tier0` -> fail locally after 212 passes because the preview server returned transient 404 responses during two `routes_client.cy.ts` session setup visits; the other six specs passed.
- live PR evidence: PR #792 CI run `29376998559` correctly failed `runtime-migration-parity` because migration `20260714230523_repair_trusted_rls_authorization_boundaries` has not yet been promoted to the hosted migration ledger; the exact reviewed migration must be promoted before that required PR gate can pass.
- blocked checks: `npm run ci:playwright`, trusted Supabase validation, migration/runtime parity, deployed Edge parity, and non-skipped BCBA acceptance require protected hosted CI. Full `verify:local` remains failed because it includes the two recorded `test:ci` failures. The Edge Function is not in the automatic session bundle and requires reviewed post-merge deployment with `verify_jwt=true` readback.
- result: `pass-with-blocked-checks` for the bounded local implementation; PR CI, human approval, hosted promotion, fresh green Supabase Validate, and non-skipped BCBA acceptance remain required before completion.
- residual risk: the forward migration changes live tenant boundaries and the Edge repair is not proven until reviewed code is deployed; `manage_admin_users` remains strict in the test because neither checked-in nor live SQL supports weakening the cross-org denial contract.

### WIN-217 post-merge trusted validation repair

- branch: `codex/win-217-post-merge-trusted-rls`
- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering evidence: PR #792 merged and deployed successfully, but main Supabase Validate run `29418796988` failed one cross-org admin RPC assertion, two unbounded Edge invocations, three overlapping session fixtures, one equivalent-timestamp assertion, two tenantless note-template reads, and guardian profile setup.
- bounded fix:
  - derive `assign_admin_role` and `manage_admin_users` authority from the current JWT plus active canonical profiles; keep `assign_admin_role` service-only, keep `manage_admin_users` authenticated/service-role callable, and preserve same-org denial.
  - use signup-generated guardian profile state without mutating protected auth fields.
  - isolate session time ranges, write template `organization_id`, normalize equivalent UTC output, and bound/correlate Edge requests at 15 seconds.
- local verification:
  - focused contracts: 3 files / 20 tests passed.
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed.
  - `npm run test:ci` still has the unchanged local Node/jsdom `Blob.text()` failure; the affected live-fixture contract was updated and passes focused.
- required hosted sequence: human review -> apply the exact reviewed migration through Supabase -> read back functions/grants/ledger -> green PR runtime parity -> merge -> fresh main Supabase Validate with `RUN_DB_IT=1` -> inspect correlated same-org/cross-org Edge outcomes and zero fixture residue.
- residual risk: no production migration promotion is authorized until human review; the fresh hosted suite remains the only decisive proof for live RPC, Edge transport, and cleanup behavior.

### WIN-217 BCBA session-note authorization follow-up

- branch: `codex/win-217-bcba-session-note-auth`
- classification: `high-risk human-reviewed`
- lane: `critical`
- hosted failure: main CI run `29418796830` passed synthetic BCBA provisioning, auth, session smoke, lifecycle acceptance, and cleanup, then the measurement roundtrip received HTTP 403 from `POST /api/session-notes/upsert`.
- root cause: the endpoint's initial authorization gate recognized therapist, admin, super-admin, and org-member roles but omitted the canonical exact `bcba` role. The downstream production `current_user_can_capture_trial_event` RPC already admits exact BCBA actors for the active organization.
- bounded fix:
  - only when the existing role gate has no match, call the canonical organization-scoped BCBA helper.
  - admit only an exact positive BCBA result; preserve 403 for other roles and fail closed with 502 when BCBA role resolution is unavailable.
  - keep organization, authorization, client, billing, session, therapist, goal, trial-event, and caller-JWT enforcement unchanged.
- non-goals: no migration, global role-resolver change, role alias, workflow/provisioner change, service-role bypass, or relaxation of tenant/data checks.

Verification card:

- required checks: RED/GREEN handler tests; generic role-resolution contracts; policy; lint; typecheck; `test:ci`; build; tenant validation; independent code/test/security review; human review; hosted main BCBA acceptance.
- executed checks: two focused authorization tests failed with the original 403 behavior before implementation; focused handler and role contracts pass, 2 files / 61 tests; policy, lint, typecheck, tenant validation, build, and tier-0 routes (7 specs / 220 tests) pass; independent code/security review found no remaining actionable findings; production Supabase definition readback confirms the downstream capture RPC grants exact BCBA authority through the canonical organization-scoped role helper.
- blocked checks: local `test:ci` reaches the same two unrelated Windows baseline failures recorded above: jsdom `Blob.text()` and CRLF-sensitive workflow-step extraction. Hosted acceptance requires protected main-only CI credentials and intentionally cannot execute on the PR event.
- result: `human-review-ready-with-blocked-checks`; the protected server change is not complete until the PR is human-reviewed/merged and a fresh main run passes the measurement roundtrip plus zero-residue cleanup.
- residual risk: local mocks cannot prove the deployed API adapter and production caller JWT traverse the same path; the trusted main-only BCBA acceptance remains decisive.

### WIN-217 post-merge admin fixture bootstrap repair

- branch: `codex/win-217-admin-fixture-bootstrap`
- classification: `high-risk human-reviewed`
- lane: `critical`
- hosted failure: post-merge Supabase Validate run `29424318934` passed runtime migration parity, then six live RLS suites failed during admin fixture setup with SQLSTATE `42501` and `Target user canonical organization mismatch`.
- root cause: trusted fixtures invoked `assign_admin_role` before the CI-only provisioner established the synthetic user's canonical profile organization. The repaired production RPC correctly rejects null or mismatched canonical tenant state.
- bounded fix: preserve production SQL and grants; reorder all three synthetic admin bootstrap paths to persist the expiring fixture marker, reconcile exactly one admin role, provision/read back the canonical profile, and only then invoke `assign_admin_role` as an idempotent authorization/audit smoke.
- regression proof: a new secret-free contract requires the complete bootstrap order and verifies that every call is present; focused fixture and migration contracts pass, 3 files / 23 tests.
- verification: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` pass. Local `npm run test:ci` reaches the two unchanged baseline failures: jsdom `Blob.text()` and CRLF-sensitive workflow-step extraction.
- required hosted sequence: human review -> merge the fixture-only follow-up -> fresh main Supabase Validate with all six suites collected and passing -> verify zero marked fixture users/roles remain.
- residual risk: the decisive live proof is main-only because protected Supabase credentials are unavailable to local and pull-request test jobs.

### WIN-217 hosted RLS validation serialization follow-up

- branch: `codex/win-217-serialize-hosted-rls`
- classification: `high-risk human-reviewed`
- lane: `critical`
- hosted evidence: main Supabase Validate run `29426261636` proved the canonical-profile ordering repair in four previously failing live RLS suites, then timed out at exactly 30 seconds in the fifth shared-harness setup, the large security-fixture setup, and one legacy anonymous schema probe.
- root cause: the main-only workflow ran all 390 test files with production Supabase credentials and `RUN_DB_IT=1`, allowing five full fixture graphs plus the security graph to write concurrently. Historical main runs contain the same unrelated exact-30-second timeout pattern; hosted logs showed no deadlock, lock timeout, statement timeout, cancellation, or Auth rate limit.
- bounded fix: run the ordinary suite without hosted credentials and explicitly exclude live database files; then run only the six trusted RLS/security files serially with one worker, a 120-second hook limit, a 60-second test limit, and a 180-second no-output watchdog. Exclude the flaky legacy `DatabaseIntegration` and dormant `multiTenantAccess` probes from production-backed execution.
- production authority: unchanged. No migration, RPC, RLS policy, grant, Edge Function, application runtime, or canonical tenant check changes.
- residue repair: the timed-out setup left two marked `@example.com` auth users, two UUID-scoped `live-rls-org-*` organizations, and one active fixture role. They were removed through the Supabase plugin using exact IDs selected by the combined fixture marker, synthetic domain, unexpired metadata, and known fixture organization constraints. Readback is zero fixture users, zero fixture organizations, and zero active fixture roles.
- local verification: the workflow contract was RED before the split and passes after it, 1 file / 14 tests. `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` pass. `npm run test:ci` reaches 2,730 passing tests and the same two unchanged Windows portability failures: jsdom `Blob.text()` and CRLF-sensitive workflow-step extraction.
- required hosted sequence: independent critical-lane review -> human review -> merge -> fresh main Supabase Validate -> runtime parity and all six serialized hosted files green -> zero-residue Supabase readback.
- residual risk: local execution cannot supply protected hosted credentials; the serialized main-only workflow and post-run residue query remain decisive.

### WIN-217 secret-free RPC contract isolation follow-up

- branch: `codex/win-217-isolate-unit-supabase-env`
- classification: `high-risk human-reviewed`
- lane: `critical`
- hosted evidence: after PR #796 merged, main Supabase Validate run `29430099521` passed runtime migration parity but failed 13 assertions in `orgRoleRpcEquivalence.contract.test.ts` before the serialized hosted phase began.
- root cause: the contract mocked the exported `getSupabaseConfig`, while functions inside the same module call its original lexical binding. Removing hosted credentials from the ordinary unit phase exposed that hidden ambient-environment dependency.
- bounded fix: replace the ineffective same-module mock with test-local `.invalid` Supabase URL and synthetic anon-key stubs; reject unexpected fetches by default. Keep the workflow split, production credentials, runtime code, database authority, and hosted test selection unchanged.
- RED/GREEN proof: with all Supabase URL/key variables removed and the env loader pointed at a nonexistent file, the target produced 13 failures before the fix and passes 14/14 after it.
- required hosted sequence: independent critical-lane review -> human review -> merge -> fresh main Supabase Validate -> secret-free ordinary suite green -> all six serialized hosted files green -> zero-residue Supabase readback.
- residual risk: the complete Windows unit suite retains two unrelated local portability failures already recorded above; Linux CI and the fresh main-only hosted phase remain decisive.

### WIN-217 Supabase Validate trigger closure

- branch: `codex/win-217-trigger-rpc-contract-validation`
- classification/lane: `high-risk human-reviewed` / `critical` because `.github/workflows/**` is protected.
- scope: add only the isolated RPC contract to the existing `main` push paths and pin that path in the workflow contract; do not change PR behavior, permissions, secrets, jobs, test selection, timeouts, or database authority.
- RED/GREEN proof: the workflow contract failed 1/14 before the trigger was added and passes 14/14 after it. Policy, lint, typecheck, tenant validation, and build pass.
- required hosted sequence: human review -> merge -> fresh main Supabase Validate -> secret-free ordinary suite green -> all six serialized hosted suites green -> zero-residue Supabase readback.
- residual risk: local checks cannot execute the protected hosted phase; the merge-triggered main run remains decisive.

### WIN-217 transcript tenant RLS repair

- branch: `codex/win-217-repair-transcript-rls`
- classification/lane: `high-risk human-reviewed` / `critical` because the fix changes production RLS in `supabase/migrations/**`.
- hosted evidence: main Supabase Validate run `29436047304` passed runtime parity and the secret-free unit phase, then failed 4 of 145 hosted assertions. Production policy readback confirmed that the legacy `consolidated_select_4c9184` policy grants every authenticated admin cross-organization transcript and transcript-segment reads; the matching update/delete policies also use the same globally scoped admin helper.
- bounded fix: add one forward migration limited to the two transcript tables. Deterministically replace legacy/duplicate select policies with one canonical tenant-scoped select policy per table, and replace update/delete policies with `app.user_has_role_for_org` checks that derive tenant authority from the referenced session. Do not change shared helpers, grants, tables, stored data, or service-role access.
- fixture/transport repair: provision guardian organization through the existing guarded CI-only RPC before strict readback; increase only the `assign-therapist-user` client abort from 15 to 45 seconds while preserving one attempt and the strict cross-org HTTP 403 assertion.
- regression proof: focused RED failed on the missing migration and guardian provisioner; focused GREEN passes 2 files / 19 tests. Hosted coverage asserts cross-org admin read/update/delete denial with service-role state readback, plus positive same-org admin and mapped-therapist update/delete behavior for both transcript tables. Static contracts pin exact role arguments, session-derived authority, canonical therapist mapping, policy roles, and update `USING`/`WITH CHECK` parity.
- tenant boundary: an organization admin may access transcript artifacts only when the referenced session resolves to that admin's canonical organization. Assigned therapists retain same-session access; service-role behavior is unchanged; cross-organization reads and writes must fail closed.
- required hosted sequence: independent critical-lane review -> human review -> apply the exact reviewed migration through the Supabase plugin -> policy/ledger readback -> merge -> fresh main Supabase Validate with the expected 149 hosted assertions green -> zero-residue readback.
- local verification: focused migration/fixture contracts pass 2 files / 19 tests; `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` pass. `npm run verify:local` reached `test:ci` and stopped with only the two known Windows-only portability failures (`Blob.text()` and CRLF workflow-step parsing): 2 failed, 2,739 passed, and 3 skipped out of 2,744 tests. An earlier full run's additional `AppNavigation` timeout passed immediately in isolation at 27/27 and is treated as transient rather than a product regression.
- residual risk: the migration and increased Edge timeout require live production proof; a second Edge timeout at 45 seconds is a function-runtime blocker, not grounds for another timeout increase.

### WIN-217 mapped therapist fixture follow-up

- fresh-main evidence: Supabase Validate run `29439128059` passed runtime migration parity and the secret-free unit phase. The serialized hosted phase then failed during `src/tests/security/rls.spec.ts` setup with `42501 Synthetic RLS actor organization mismatch`; 18 assertions from the other five hosted files passed and all 131 security assertions were skipped because setup did not complete.
- root cause: `createMappedTherapistFixture` invoked the guarded profile provisioner before creating the user's therapist link, while the service-only guard recognized only same-ID therapist rows and did not resolve linked therapist identities. This was new fixture setup, not stale hosted residue; Supabase readback after the failure was zero across fixture users, profiles, roles, therapist links, same-ID client/therapist rows, and fixture organizations.
- bounded follow-up: create `user_therapist_links` before guarded profile provisioning and add one forward migration limited to the service-role-only CI provisioner. Its therapist branch resolves exactly one non-deleted linked therapist and organization, rejects ambiguous mappings, retains same-ID fallback for existing fixtures, and preserves every marker, expiry, role, organization-equality, profile-guard, and EXECUTE restriction. No application RLS policy, shared runtime identity helper, table, grant, or stored-data behavior changes.
- RED/GREEN proof: all four initial migration guard contracts failed against the generated blank migration, and the fixture ordering contract rejected the prior shape. The completed migration, privileged-envelope hardening, and link-before-provision implementation pass 2 files / 20 tests.
- local verification: final focused Supabase contracts pass 3 files / 25 tests; `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` pass. `npm run verify:local` reaches `test:ci` with 2,745 passed and 3 skipped, then stops only on the two established Windows baselines: `Blob.text()` support and CRLF workflow-step parsing. Both owned newline-sensitive migration contracts now normalize CRLF before assertion.
- required hosted sequence: merge the follow-up -> fresh main Supabase Validate -> all 149 hosted assertions accounted for with zero failures -> zero-residue Supabase readback.

### WIN-217 bounded Edge authorization and guardian fixture follow-up

- fresh-main evidence: Supabase Validate run `29450379200` passed runtime parity and secret-free units, then ran all 149 hosted assertions. Two `assign-therapist-user` invocations reached the exact 45-second client boundary instead of returning the expected 200/403, and guardian setup failed with `42501 Synthetic RLS actor organization mismatch`. Hosted cleanup completed with zero fixture residue.
- root causes: the Edge function entered the generic sequential role-resolution middleware and then repeated an admin check; the guardian fixture invoked the guarded profile provisioner before its canonical `client_guardians` link existed.
- bounded fix: authenticate the Edge caller once, resolve the active server-controlled profile, and execute the existing organization-scoped role RPCs concurrently. Preserve active/expiry/org role semantics, JSON error envelopes, CORS, target-profile tenant checks, and `verify_jwt=true`. Insert the guardian link before provisioning and extend only the service-role CI provisioner to accept active, tenant-consistent client links while rejecting multi-organization ambiguity.
- non-goals: no timeout increase, no shared auth-middleware change, no application RLS/grant expansion, no production table or stored-data mutation, and no changes to the already-green storage/transcript policies.
- local verification: focused RED failed in the expected three places; focused GREEN passes 2 files / 22 tests. Policy, lint, typecheck, tenant validation, and build pass. `npm run verify:local` reaches `test:ci` with 2,752 passed and 3 skipped, stopping only on the two established local baselines (`Blob.text()` and CRLF workflow-step parsing).
- review response: independent reviewers caught and blocked a legacy unscoped role helper; the implementation now uses `current_user_is_super_admin` plus `user_has_role_for_org` for `bcba`, `org_super_admin`, `org_admin`, and `admin`, preserving active, expiry, and organization checks. Review also added guardian link/client tenant consistency, full privileged SQL envelope assertions, behavioral 401/403 tests, and explicit JSON auth envelopes.
- required hosted sequence: critical-lane review -> PR checks -> apply exact migration and deploy exact reviewed `assign-therapist-user` bundle with Supabase plugin -> ledger/function readback -> merge -> fresh-main Supabase Validate with all 149 assertions accounted for and zero failures -> zero-residue readback.

### WIN-217 hosted Edge test transport follow-up

- fresh-main evidence: Supabase Validate run `29459000082` attempts 1 and 2 each passed runtime parity, secret-free units, guardian coverage, admin-action RLS, storage RLS, and 147 of 149 hosted assertions. Only the two `assign-therapist-user` calls aborted at exactly 45 seconds; neither call appeared in the complete relevant Edge access-log window.
- rejected hypothesis: disabling gateway JWT verification on the exact deployed bundle did not change either timeout or produce a worker access log. The experiment was rolled back; production is active on version 19 with the original source hash and `verify_jwt=true`.
- bounded fix: keep the production handler, gateway authentication, tenant checks, permissions, and timeout unchanged. Replace only the hosted test's `supabase-js` `functions.invoke` wrapper with an explicit `fetch` using the signed-in session token, anon key, correlation ID, JSON body, and the existing 45-second abort. Preserve HTTP response status in the test error context so the same-org 200 and cross-org 403 assertions remain strict.
- RED/GREEN proof: the fixture contract failed before the transport change and passes 16/16 after it; typecheck passes. The decisive proof remains a fresh main hosted run because protected credentials are unavailable locally and in pull-request jobs.
- required hosted sequence: critical-lane review -> merge -> fresh-main Supabase Validate -> all 149 hosted assertions pass -> Edge access logs show both assignments reached the worker -> zero-residue Supabase readback.

### WIN-217 Edge authenticated network-hop follow-up

- transport hypothesis result: fresh-main Supabase Validate run `29460522334` used the explicit `fetch` transport and again passed 147 of 149 hosted assertions. The same-org and cross-org `assign-therapist-user` calls each stopped at exactly 45 seconds inside MSW passthrough, with no completed Edge access-log entry. This disproves both the `supabase-js` invoke wrapper and gateway JWT verification as causes.
- bounded root-cause fix: remove the handler's redundant GoTrue `auth.getUser()` network hop. Keep gateway `verify_jwt=true` explicit, extract only a UUID-shaped `sub` as the server-owned profile lookup key, and require the existing JWT-backed `current_user_is_super_admin` / `user_has_role_for_org` RPCs to authorize the caller before any mutation. Preserve caller/target profile activity, tenant equality, therapist status/tenant checks, CORS, JSON errors, and all service-role boundaries.
- diagnostic evidence: request-ID-only stage logs bracket profile lookup and JWT-backed role resolution. They contain no token, user, email, tenant, request body, or PHI.
- RED/GREEN proof: focused tests initially failed because the handler still imported and called `getUserOrThrow`; the implementation passes 2 files / 28 tests, including malformed/missing/non-UUID subject rejection, no pre-auth profile/RPC access, caller-sub profile lookup, organization-scoped role arguments, denial, RPC-error, and active-role cases. Independent security review found no blocker.
- local verification: policy, lint, typecheck, tenant validation, and build pass. `npm run verify:local` reaches `test:ci` with 2,758 passed and 3 skipped, then stops only on the two established Windows baselines: missing `Blob.text()` and CRLF workflow-step parsing.
- required hosted sequence: deploy the exact reviewed function with verified `verify_jwt=true` -> correlated same-org 200 and cross-org 403 under 45 seconds -> PR checks and human-reviewed merge -> fresh-main Supabase Validate with all 149 assertions accounted for and zero failures -> zero-residue Supabase readback.

### WIN-217 Edge server registration follow-up

- fresh-main evidence: Supabase Validate run `29463288918` passed runtime parity, secret-free units, and 147 of 149 hosted assertions. Both `assign-therapist-user` calls still aborted at exactly 45 seconds. Live Edge access logs contained zero matching requests or stage events, while all fixture, transcript, admin-action, and storage residue counts were exactly zero after teardown.
- root cause: `assign-therapist-user/index.ts` was the only repository Edge entrypoint that exported a request handler without registering it with `Deno.serve`. The runtime therefore never dispatched requests into the reviewed handler; client transport, gateway verification, GoTrue lookup, profile lookup, and role RPC changes could not affect the timeout.
- bounded fix: export the existing function as `handler`, register it once through the repository's guarded `Deno.serve(handler)` pattern, and preserve the default export for unit tests. No authorization, tenant, mutation, response, timeout, shared middleware, schema, grant, or workflow behavior changes.
- RED/GREEN proof: the live fixture contract failed specifically on missing server registration, then passes with the guarded registration. Final focused handler/contract verification passes 2 files / 28 tests; policy, lint, typecheck, tenant validation, and build pass. Independent review found no production or test-import blocker.
- required hosted sequence: deploy exact reviewed registration with `verify_jwt=true` -> Edge readback -> PR checks and merge -> fresh-main same-org 200 and cross-org 403 with all 149 assertions green -> zero-residue Supabase readback.
