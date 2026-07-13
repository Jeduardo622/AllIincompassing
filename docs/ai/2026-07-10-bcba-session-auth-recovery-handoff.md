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
