# WIN-221: Mandatory BT ABA Session Note Closeout

Linear: [WIN-221](https://linear.app/winningedgeai/issue/WIN-221/add-mandatory-bt-aba-session-note-to-session-close-workflow)

## Routing and approved outcome

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering boundaries: session completion ordering, authenticated exact-role authorization, tenant-scoped Supabase storage/RLS/grants, privileged RPCs, clinical documentation, and browser session state.
- Required human review: Supabase/database and security review before merge.

An assigned exact BT now closes an in-progress session through two steps. Existing goal capture is persisted first, then the required ABA Session Note is completed and signed. The session remains `in_progress` until the database transaction stores the note and BT attestation, changes the session to `completed`, runs the existing goal-progression finalizer, writes the canonical completion audit event, and creates the idempotent supervision request. A failed transaction leaves the session in progress and its draft recoverable.

The existing supervising-admin Supervision Session Note is separate. Parent/guardian, midtier, and BCBA signatures are not writable by the BT and remain optional actor-owned follow-up attestations. Existing completed sessions are not reopened or backfilled.

## Implemented surfaces

- Contract and validation: `src/lib/bt-aba-session-note.ts`
- Tenant storage, template seed, attestations, RLS/grants, draft/finalize RPCs: `supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql`
- HTTP/client adapters: `src/server/api/session-notes-upsert.ts`, `src/lib/session-notes.ts`, `src/types/index.ts`
- Accessible form and bounded typed/drawn signature: `src/components/session-notes/**`
- Two-step modal/Schedule orchestration: `src/components/SessionModal.tsx`, `src/pages/Schedule.tsx`
- Static/RLS/SQL/component/server/orchestration coverage: corresponding tests under `tests/**` and `src/**/__tests__/**`
- Synthetic browser lifecycle: `scripts/playwright-bt-aba-session-note.ts`, exposed as `npm run playwright:bt-aba-session-note`
- Approved design and implementation plan: `docs/superpowers/specs/2026-07-16-bt-aba-session-note-design.md`, `docs/superpowers/plans/2026-07-16-bt-aba-session-note.md`

## Browser evidence contract

The dedicated script is destructive only on an explicitly acknowledged disposable Supabase project. It refuses the production project `wnnjeqheqxxyrgsjmygy`, refuses a runtime URL whose project ref differs from the acknowledgement, refuses credentials whose email is not visibly synthetic, and fails before Chromium or any database write when the environment contract is incomplete. It:

1. authenticates `PW_BT_EMAIL` / `PW_BT_PASSWORD`;
2. resolves the direct `/auth/v1/user` response, derives authoritative organization scope from the authenticated `current_user_organization_id` RPC, and requires the persisted profile to agree;
3. uses service-role reads to validate the explicit therapist, client, program, goal, authorization ID, and authorization service code are active/current/approved as applicable, same-organization, correctly linked, and associated with the marker-bearing disposable graph;
4. creates only one exact marked session on that validated graph, starts it, captures the explicit goal, and opens closeout;
5. proves incomplete validation, saves a draft, reloads, and proves restoration;
6. exercises drawn signature plus clear/retry, then uses the typed fallback;
7. asserts the closeout UI and persisted capture use the explicit service code and authorization ID, with no first-option fallback; and
8. finalizes through `/api/session-notes/upsert`, proves the modal closes, exactly one completion signal appears, the refreshed Schedule card reports `data-session-status="completed"`, the note is locked, and one actor-owned BT attestation exists.

The script performs **no cleanup mutation** after success or failure. It leaves the completed synthetic graph intact for evidence and prints the exact project ref/session ID plus a mandatory whole-branch deletion instruction. The orchestrator must delete the disposable Supabase branch after evidence capture; the script never cancels or deletes session rows.

Required runtime inputs are `PW_BASE_URL`, `PW_BT_EMAIL`, `PW_BT_PASSWORD`, explicit `PW_BT_CLIENT_ID`, `PW_BT_PROGRAM_ID`, `PW_BT_GOAL_ID`, `PW_BT_AUTHORIZATION_ID`, and `PW_BT_SERVICE_CODE`, a strong `PW_BT_FIXTURE_MARKER` present in every validated fixture identity field, `PW_BT_DISPOSABLE_PROJECT_REF`, `PW_BT_DISPOSABLE_ACK=I_ACKNOWLEDGE_DISPOSABLE_SUPABASE`, `PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK=delete-branch-after-run`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_ANON_KEY`), and `SUPABASE_SERVICE_ROLE_KEY`. No credential or customer identifier is embedded in the repository, and no arbitrary client/program/goal/authorization/service selection is permitted.

Authorized-reviewer browser visibility is **blocked**, not passed: the repository has no established safe synthetic reviewer credential/fixture path for this new note. Add that proof only after a dedicated reviewer persona and fixture contract are provisioned. Service-role artifact inspection in the script proves persistence, not reviewer UI authorization.

## Specialist review and corrections completed

- Specification review fixed the transaction boundary: session completion and all existing finalizer/audit/supervision side effects are atomic; signatures for other actors cannot be forged by the BT.
- Supabase/security review hardened exact active BT/RBT authority, linked-user ownership, tenant derivation, RLS plus explicit grants, authenticated direct-attestation denial, fixed search paths, execution revocations, canonical completed replay, and idempotent side effects.
- Database/API cross-layer review removed caller-controlled billing identity and routes assignment preflight through the protected RPC contract.
- UI review added exact shared labels/options, conditional Other rules, exclusive N/A behavior, accessible first-error focus, bounded multi-stroke drawing, typed fallback, and same-session unsaved-state preservation.
- Lifecycle review added durable draft auto-open, visible load/finalize failures, synchronous duplicate-finalize prevention, completion/refresh separation, canonical context derivation, and one completion callback/toast/reset.
- Test/documentation review corrected the browser boundary to require an explicit marker-validated fixture/billing graph and disposable-project teardown acknowledgement before any write, assert visible Schedule completion processing, preserve the completed graph for evidence with whole-branch teardown, and honestly defer reviewer visibility.

## Supabase compatibility and live-state boundary

Read-only Supabase documentation/advisor review confirmed that a `SECURITY DEFINER` function executable by `authenticated` is a privileged API: it must validate caller scope and inputs, use a fixed search path, and revoke default `PUBLIC`/`anon` execution. It also confirmed that RLS and table/function grants are independent controls. The migration follows those requirements with tenant-derived checks, explicit grants, and revocations.

No hosted migration or production write was performed for WIN-221. Static migration governance and RLS contracts pass, but executable PostgreSQL proof is still required. Local `npx supabase start` was bounded and timed out without starting the database, so `db reset`, SQL compilation, rollback semantics, live grants, and the synthetic SQL smoke were not proved locally.

## Mandatory command matrix

The parent agent must replace each `PENDING`/`BLOCKED` entry with exact final output before marking the PR ready.

| Check | Current evidence | Final requirement |
|---|---|---|
| Focused BT ABA contract/components/server/migration tests | Task-level focused suites passed; latest task totals include contract/components `30/30`, migration/RLS `142/142`, combined handler/migration/RLS `200/200`, and lifecycle/orchestration `131` tests | `PENDING` fresh cumulative run |
| `npm run ci:check-focused` | Fresh Task 6 pass; DB overlap, preview drift, privileged-function DB grants, and auth parity were skipped without DB/CI configuration | Parent should repeat after final review changes |
| `npm run lint` | Fresh Task 6 pass with zero warnings; the normally ignored script also passed a direct `eslint --no-ignore --max-warnings 0` run | Parent should repeat after final review changes |
| `npm run typecheck` | Fresh Task 6 pass | Parent should repeat after final review changes |
| `npm run test:ci` | Earlier bounded run timed out with unrelated baseline AI documentation localhost errors | `PENDING` fresh final run or exact failure evidence |
| `npm run validate:tenant` | Passed in database task | `PENDING` fresh final run |
| `npm run test:routes:tier0` | Not run in Task 6 implementation | `PENDING` |
| `npm run build` | Fresh Task 6 pass | Parent should repeat after final review changes |
| `npm run ci:playwright` | Not run with protected credentials in Task 6 implementation | `BLOCKED` until credentialed environment/CI |
| `npm run playwright:bt-aba-session-note` | Missing-env preflight names every absent fixture, exact billing, and teardown-ack input; separate no-network preflights refuse the production ref and a runtime/acknowledged project-ref mismatch before Chromium or writes | `BLOCKED` until a wrapper provisions the marker-validated migrated branch, runs proof, preserves evidence, and deletes the whole branch |
| `npm run verify:local` | Not run after integrated change | `PENDING`; preserve any DB/credential skips |
| `npx supabase db reset` + SQL smoke | Local Supabase startup timed out | `BLOCKED` executable DB runtime required |
| Hosted/preview migration replay and advisors | No hosted mutation performed | `BLOCKED` supervised disposable preview or approved hosted path required |

## Draft verification card

- Lane: `critical`
- Required checks: focused tests; policy; lint; typecheck; `test:ci`; tenant validation; Tier-0 routes; build; credentialed Playwright; `verify:local`; executable migration replay and SQL smoke.
- Executed checks: see command matrix; Task 6 freshly passed policy, lint, typecheck, and build, while task-level static/unit/integration suites and tenant validation passed at the indicated checkpoints.
- Blocked checks: local/preview PostgreSQL replay, credentialed exact-BT browser lifecycle, authorized-reviewer browser visibility, and DB-connected policy/advisor checks.
- Result: `NOT READY FOR MERGE` until fresh hard gates and executable DB proof complete.
- Residual risk: PL/pgSQL compilation/rollback and live RLS/grant behavior are not yet executable proof; reviewer UI visibility is not covered; protected environment browser behavior remains unproved.

## Draft PR-hygiene card

- Dedicated branch/worktree: `codex/win-221-bt-aba-session-note` — yes.
- Linear/design/plan/handoff: yes.
- Scope: one coherent BT ABA closeout feature; no supervisor-note redesign or completed-session backfill.
- Secrets/PHI: none added; browser data is marker-based synthetic content.
- Protected paths: expected migration and server API changes; critical lane retained.
- Required reviews: code, test, security, Supabase/database, and human product review.
- PR-ready: `NO` pending fresh verification, executable database replay, and mandatory human Supabase/security approval.

## Merge blockers and follow-up

1. Compile and replay the migration against a reset local or disposable Supabase database and run `tests/sql/bt_aba_session_note_closeout_smoke.sql` with `ON_ERROR_STOP=1`.
2. Add an orchestrator wrapper that provisions a migrated disposable branch, runs the exact-BT lifecycle, captures the emitted project ref/session ID evidence, and deletes the entire branch on both success and failure. The credentialed run remains blocked until that wrapper exists.
3. Obtain human Supabase/security review of migration, grants/RLS, fixed-search-path privileged functions, replay semantics, and transaction rollback.
4. Complete the mandatory command matrix and final `verify-change` / `pr-hygiene` verdicts.
5. Provision a dedicated safe synthetic reviewer persona/path, then add reviewer-visibility browser proof without broadening BT authority.
