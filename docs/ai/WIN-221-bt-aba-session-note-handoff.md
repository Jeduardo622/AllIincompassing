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

The browser script performs **no branch lifecycle mutation** after success or failure. It emits one best-effort, non-throwing teardown/retention instruction from an outer `finally` boundary. That boundary covers every stage after safety configuration is validated: authentication, organization and fixture validation, browser launch, lifecycle proof, failure screenshot capture, and browser/context close. The Supabase session insert is fully awaited without the detached step timeout, and its returned ID is assigned before any success logging can fail. Before a session is booked, the event contains the validated project ref and `sessionId="not-created"`; after booking, it contains the exact created session ID. Failure screenshot, context close, and browser close are bounded best-effort operations (`PW_BT_ABA_CLEANUP_TIMEOUT_MS`, default 10 seconds), so a hung cleanup operation or its own reporting error cannot bypass the mandatory event. The protected workflow always runs marker-validated exact-fixture cleanup and proves zero retained fixture rows. Platform-managed PR preview branches are retained and health-checked; proof-created disposable branches require whole-branch deletion.

Required runtime inputs are `PW_BASE_URL`, `PW_BT_EMAIL`, `PW_BT_PASSWORD`, explicit `PW_BT_CLIENT_ID`, `PW_BT_PROGRAM_ID`, `PW_BT_GOAL_ID`, `PW_BT_AUTHORIZATION_ID`, and `PW_BT_SERVICE_CODE`, a strong `PW_BT_FIXTURE_MARKER` present in every validated fixture identity field, `PW_BT_DISPOSABLE_PROJECT_REF`, `PW_BT_DISPOSABLE_ACK=I_ACKNOWLEDGE_DISPOSABLE_SUPABASE`, an ownership-matched teardown acknowledgement (`retain-platform-managed-pr-preview` or `delete-branch-after-run`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_ANON_KEY`), and `SUPABASE_SERVICE_ROLE_KEY`. No credential or customer identifier is embedded in the repository, and no arbitrary client/program/goal/authorization/service selection is permitted.

Authorized-reviewer browser visibility is **blocked**, not passed: the repository has no established safe synthetic reviewer credential/fixture path for this new note. Add that proof only after a dedicated reviewer persona and fixture contract are provisioned. Service-role artifact inspection in the script proves persistence, not reviewer UI authorization.

## Specialist review and corrections completed

- Specification review fixed the transaction boundary: session completion and all existing finalizer/audit/supervision side effects are atomic; signatures for other actors cannot be forged by the BT.
- Supabase/security review hardened exact active BT/RBT authority, linked-user ownership, tenant derivation, RLS plus explicit grants, authenticated direct-attestation denial, fixed search paths, execution revocations, canonical completed replay, and idempotent side effects.
- Database/API cross-layer review removed caller-controlled billing identity and routes assignment preflight through the protected RPC contract.
- UI review added exact shared labels/options, conditional Other rules, exclusive N/A behavior, accessible first-error focus, bounded multi-stroke drawing, typed fallback, and same-session unsaved-state preservation.
- Lifecycle review added durable draft auto-open, visible load/finalize failures, synchronous duplicate-finalize prevention, completion/refresh separation, canonical context derivation, and one completion callback/toast/reset.
- Test/documentation review corrected the browser boundary to require an explicit marker-validated fixture/billing graph and disposable-project teardown acknowledgement before any write, assert visible Schedule completion processing, preserve the completed graph for evidence with whole-branch teardown, and honestly defer reviewer visibility.
- Final critical/security review closed a clinical-integrity bypass by enforcing template-derived JSON types and canonical option membership in the authenticated finalization RPC, rejecting unknown response keys, validating bounded drawn-point serialization, and matching the UI's 200-character typed-signature limit. Direct-RPC negatives cover arbitrary options, wrong types, malformed drawn values, and oversized typed values; positive SQL proof exercises drawn-point finalization and attestation creation.

## Supabase compatibility and live-state boundary

Read-only Supabase documentation/advisor review confirmed that a `SECURITY DEFINER` function executable by `authenticated` is a privileged API: it must validate caller scope and inputs, use a fixed search path, and revoke default `PUBLIC`/`anon` execution. It also confirmed that RLS and table/function grants are independent controls. The migration follows those requirements with tenant-derived checks, explicit grants, and revocations.

No production migration or production write was performed for WIN-221. Supabase PR preview `zutoyqdrpddtgkgooijx` applied `20260716212837_bt_aba_session_note_closeout.sql`, completed seeding/function deployment, and remained healthy after the exact live lifecycle. Protected run [29556344632](https://github.com/Jeduardo622/AllIincompassing/actions/runs/29556344632) validated immutable PR head `85343658bcc17eb10951f07bfd8860e918e7f3cf`, authenticated the exact synthetic BT, created and started the exact marked session, captured the exact goal, proved incomplete validation, saved/reloaded the draft, exercised drawn and typed signatures, finalized atomically, observed modal closure plus one completion signal, and read the refreshed Schedule card as `completed`. It then deleted and zero-verified marker `bt-aba-proof-29556344632-1` / session `ca7d5e1f-5a51-4e94-91b8-37020148e1bd`, retained the platform-managed branch, and passed the independent managed-preview health job. The earlier full synthetic SQL smoke also passed inside explicit `BEGIN`/`ROLLBACK`, proving compilation, caller-bound grants/RLS checks, draft/read/finalize/replay behavior, failure rollback, and side-effect idempotency without retained fixture data.

## Mandatory command matrix

Final local verification was run from the clean isolated worktree after all implementation and review-fix commits.

| Check | Current evidence | Final requirement |
|---|---|---|
| Focused BT ABA contract/components/server/migration/orchestration/security/proof tests | **PASS** — final remediation run covered 12 files, `414/414` tests | Complete |
| `npm run ci:check-focused` | **PASS** — static API/auth/grant/RLS/migration/reliability policies passed | DB overlap, preview drift, privileged-function DB grants, auth parity, and branch protection remain environment/CI-skipped |
| `npm run lint` | **PASS** — zero warnings | Complete |
| `npm run typecheck` | **PASS** | Complete |
| `npm run test:ci` | **LOCAL FAIL / LINUX CI PASS** — final local `verify:local` recorded `2930` passed, `3` skipped, `1` failed in `tests/ci/check-e2e-reliability-gates.test.ts`; the Windows CRLF parser produced an empty synthetic-BCBA workflow step. WIN-221 focused suites passed inside the run. A separate broad local run also showed two suite-order Schedule readiness timeouts; that file passed `4/4` immediately in isolation. PR CI `unit-tests` passed on Linux at head `85343658`. | Keep the Windows-only parser failure as local residual evidence; Linux application tests are green |
| `npm run ci:verify-coverage` | **PASS** — line coverage `92.69%` meets the `86%` threshold; all module floors passed | Complete |
| `npm run validate:tenant` | **PASS** — `tenant-safety: all checks passed` | Complete |
| `npm run test:routes:tier0` | **PASS** on isolated `PREVIEW_PORT=4175` — 7 specs, `220/220` Cypress tests | Complete; initial attempt on `4173` was an environment port collision with the user's existing dev server |
| `npm run build` | **PASS** | Complete |
| `npm run ci:playwright` | **BLOCKED** at credential preflight before browser launch: missing `PW_SUPERADMIN_EMAIL/PASSWORD` or `PW_ADMIN_EMAIL/PASSWORD` | Credentialed generic smoke environment/CI required; the exact BT lifecycle has independent protected proof |
| Protected `npm run playwright:bt-aba-session-note` | **PASS** — run `29556344632` on exact head `85343658`; lifecycle, modal closure, single completion signal, completed Schedule card, locked note, one actor-owned BT attestation, exact cleanup, and managed-preview health all passed | Complete for exact BT lifecycle; reviewer UI remains separately deferred |
| `npm run verify:local` | **LOCAL FAIL at chained `test:ci`** after policy/lint/typecheck passed; `2930` passed, `3` skipped, and the same single Windows CRLF workflow-parser test failed, so later chained coverage/build/tier-0 steps did not execute there | Standalone coverage/build/tier-0 passes are recorded above; Linux `unit-tests` passed |
| `npx supabase db reset` + SQL smoke | Local Supabase startup timed out; full SQL smoke **PASS** on disposable preview `zutoyqdrpddtgkgooijx` through the Supabase connector and rolled back | Hosted executable proof complete; local Docker proof remains unavailable |
| Hosted/preview migration replay and advisors | **PASS** — migration applied and branch reached `FUNCTIONS_DEPLOYED`; security/performance advisors were read back and retain project-wide baseline warnings | Human Supabase/security review remains mandatory before merge |
| PR CI `runtime-migration-parity` | **FAIL** — job `87810028261` on head `85343658` reports the protected runtime database is missing migration `20260716212837/bt_aba_session_note_closeout` | Protected runtime migration parity must pass before merge; no production migration was applied in this slice |

## Verification card

- Lane: `critical`
- Required checks: focused tests; policy; lint; typecheck; `test:ci`; tenant validation; Tier-0 routes; build; credentialed Playwright; `verify:local`; executable migration replay and SQL smoke.
- Executed checks: focused BT/ABA, route-state, migration, security, and proof suites `414/414`; policy; lint; typecheck; coverage; tenant validation; production build; Tier-0 routes `220/220`; broad `test:ci`; `verify:local`; protected Playwright preflight; exact-head protected BT lifecycle run `29556344632`; disposable Supabase migration replay and full transactional SQL smoke.
- Blocked checks: authorized-reviewer browser visibility; generic protected Playwright credentials; local Docker database replay.
- Result: `fail` — exact protected browser/preview-database lifecycle gates and Linux application tests pass, but live PR CI `runtime-migration-parity` fails because the protected runtime database does not yet contain the new migration. Local `verify:local` also retains one Windows-only CRLF workflow-parser failure.
- Residual risk: protected runtime migration parity is red; reviewer UI visibility is not covered; project-wide Supabase advisor baseline warnings require separate triage; mandatory human Supabase/security approval is still required before merge.

## PR-hygiene card

- Dedicated branch/worktree: `codex/win-221-bt-aba-session-note` — yes.
- Linear/design/plan/handoff: yes.
- Scope: one coherent BT ABA closeout feature; no supervisor-note redesign or completed-session backfill.
- Secrets/PHI: none added; browser data is marker-based synthetic content.
- Protected paths: expected migration and server API changes; critical lane retained.
- Required reviews: specification, code, test, UI, lifecycle, security, and Supabase reviews were completed during implementation with all actionable findings resolved; human Supabase/security and product approval remain mandatory.
- Branch-ready: yes; dedicated clean `codex/` branch.
- Linear-ready: yes; WIN-221 is In Review and contains implementation/verification checkpoints.
- Single-purpose: yes; mandatory exact-BT ABA closeout only.
- Unrelated changes: none; shared SDD report collisions were restored and excluded.
- Generated artifact drift: none identified.
- Protected-path drift: expected migration and server API files only; lane remains `critical`.
- Verification summary: present above; exact protected lifecycle and Linux application tests pass, while live protected runtime migration parity is failed and local Windows retains a CRLF parser failure.
- PR handoff: ready for continued human review, not ready to merge.
- PR-ready: `NO` until protected runtime migration parity passes and mandatory human Supabase/security approval is recorded. Disposable preview migration, SQL smoke, exact BT browser lifecycle, cleanup, managed-preview health, and Linux application-test proof are complete.

## Merge blockers and follow-up

1. Resolve protected runtime migration parity: the protected runtime database must contain `20260716212837/bt_aba_session_note_closeout` and the PR check must pass. Do not apply the production migration without the separately authorized critical deployment path.
2. Obtain human Supabase/security review of migration, grants/RLS, fixed-search-path privileged functions, replay semantics, and transaction rollback.
3. Track the Windows-only CRLF workflow-parser failure separately; Linux PR `unit-tests` pass and it is not the current live merge blocker.
4. Provision a dedicated safe synthetic reviewer persona/path, then add reviewer-visibility browser proof without broadening BT authority.
