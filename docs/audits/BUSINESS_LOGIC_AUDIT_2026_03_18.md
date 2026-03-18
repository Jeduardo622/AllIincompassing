# Business Logic Audit (2026-03-18)

## Scope

- Full repository audit with emphasis on:
  - financial correctness (booking/confirm/cancel)
  - authorization and tenant isolation
  - workflow state transitions
  - data integrity and invariants

## Method

- Cross-layer trace of authority boundaries: UI -> API -> Edge -> DB constraints/RLS/RPC.
- Static analysis of highest-risk lifecycle paths:
  - `src/server/api/book.ts`
  - `src/server/bookSession.ts`
  - `supabase/functions/sessions-hold/index.ts`
  - `supabase/functions/sessions-confirm/index.ts`
  - `supabase/functions/sessions-cancel/index.ts`
  - `supabase/functions/sessions-start/index.ts`
  - `supabase/functions/initiate-client-onboarding/index.ts`
  - `supabase/functions/_shared/auth-middleware.ts`
  - `src/server/types.ts`
  - `src/types/index.ts`
  - `supabase/migrations/*` related to scheduling/auth lifecycle hardening

## Invariant Matrix (Condensed)

- `FIN-01`: Booking idempotency must prevent duplicate operations and cross-user replay.
- `FIN-02`: Hold/confirm flow must prevent therapist/client overlap and avoid partial persistence.
- `AUTH-01`: Role checks must be org-scoped at runtime for every privileged mutation path.
- `AUTH-02`: Service-role mutations must remain bounded by explicit org and actor constraints.
- `STATE-01`: Session status transitions must be consistent across DB constraints, edge handlers, and TypeScript types.
- `DATA-01`: Confirmation must not consume hold state unless session persistence succeeds.
- `DATA-02`: Financial fields must be validated server-side or constrained in DB.

## Findings (Ordered by Severity)

### Critical

1. Non-atomic recurring confirmation can persist partial sessions while returning failure.
   - Evidence:
     - `supabase/functions/sessions-confirm/index.ts` returns `partial: true` with `confirmedSessions` when later occurrences fail.
     - `src/server/bookSession.ts` catch block releases holds but does not rollback confirmed sessions.
   - Blast radius:
     - orphan scheduled sessions after user-visible failure
     - billing and scheduling drift requiring manual reconciliation
   - Repro:
     1. submit recurring booking with 2+ occurrences
     2. force conflict on a later occurrence
     3. observe response failure and pre-existing confirmed session(s)
   - Remediation:
     - implement transactional batch confirm RPC or explicit compensating cancellation for already confirmed sessions.

2. Cancel cleanup idempotency key reuse can leave unreleased holds on multi-hold cleanup.
   - Evidence:
     - `src/server/bookSession.ts` reuses one `cancel:<idempotency>` key across all hold releases in `Promise.all`.
     - idempotency store is endpoint/key scoped and raises conflict for mismatched payload/replay semantics.
   - Blast radius:
     - leaked holds, false conflicts, avoidable booking failures until expiry
   - Repro:
     1. create recurrence where confirm fails after multiple holds acquired
     2. run cleanup path
     3. inspect `session_holds` for unreleased rows
   - Remediation:
     - use per-hold cancel idempotency keys (`cancel:<base>:<holdKey>`) or a single bulk-cancel endpoint.

### High

3. Edge auth middleware collapses role globally (not org-bound) before role gating.
   - Evidence:
     - `supabase/functions/_shared/auth-middleware.ts` resolves highest role from `user_roles` without org dimension.
   - Blast radius:
     - over-authorization risk where handlers rely on role gate without strong org-scoped follow-up checks
   - Repro:
     1. user has admin role in org A, therapist in org B
     2. call route protected by role hierarchy but weak org follow-up checks
     3. middleware role passes as admin
   - Remediation:
     - use org-scoped role resolution (`user_has_role_for_org`) in middleware or per-route authorization primitive.

4. Admin-management RPCs check for admin existence but not role active/expiry state.
   - Evidence:
     - `supabase/migrations/20251030120000_assign_admin_role_logging.sql` uses `EXISTS` on admin role rows with no `is_active` or `expires_at` guard.
   - Blast radius:
     - expired/deactivated admins may still execute admin assignment flows
   - Repro:
     1. mark admin assignment inactive/expired
     2. call `assign_admin_role` or `manage_admin_users`
     3. operation still authorized
   - Remediation:
     - use canonical helpers that enforce active/expiry (`app.is_admin`) or add equivalent row predicates.

5. Confirm SQL can consume hold even when update path returns no session row.
   - Evidence:
     - `supabase/migrations/20260317043000_confirm_session_hold_program_goal_required.sql` update path has no `NOT FOUND` guard before deleting hold and returning success payload.
     - edge then rejects missing session (`Session response missing`) in `supabase/functions/sessions-confirm/index.ts`.
   - Blast radius:
     - lost hold with no session persisted
   - Repro:
     1. call confirm with stale/invalid `session.id` in org scope path
     2. update returns no row
     3. hold deleted and response path fails
   - Remediation:
     - require successful insert/update before hold deletion; return explicit `SESSION_NOT_FOUND` and preserve hold when no row updated.

6. Financial inputs (`rate_per_hour`, `total_cost`) are accepted via passthrough and persisted without bounds/consistency checks.
   - Evidence:
     - `src/server/types.ts` uses `.passthrough()` for session payload schema.
     - `confirm_session_hold` reads `rate_per_hour`/`total_cost` directly from JSON in SQL.
   - Blast radius:
     - negative/inconsistent billing values and downstream claims/reporting corruption
   - Repro:
     1. submit booking payload with invalid or negative financial values
     2. confirm booking
     3. persisted session contains malformed financial values
   - Remediation:
     - enforce API validation + DB check constraints, or derive billable values server-side.

### Medium

7. State machine drift between DB and TypeScript/UI models.
   - Evidence:
     - DB allows `in_progress` in `sessions_status_check` and transitions (`scheduled -> in_progress`).
     - `src/types/index.ts` `Session.status` omits `in_progress`.
   - Blast radius:
     - UI behavior inconsistencies and brittle conditional logic.
   - Remediation:
     - align shared TS session status union with DB state model.

8. Cancellation policy mismatch: edge allows cancel only from `scheduled`, DB transition model allows `in_progress -> cancelled`.
   - Evidence:
     - `supabase/functions/sessions-cancel/index.ts` `CANCELLABLE_STATUSES = new Set(["scheduled"])`.
     - `supabase/migrations/20260316153000_allow_session_in_progress_transitions.sql` allows `in_progress -> cancelled`.
   - Blast radius:
     - operational inability to cancel started sessions through current handler.
   - Remediation:
     - decide policy and align edge handler + docs + tests with DB transition rules.

9. Session-start edge path is non-atomic (session update succeeds before `session_goals` upsert).
   - Evidence:
     - `supabase/functions/sessions-start/index.ts` updates `sessions` then separately upserts `session_goals`.
   - Blast radius:
     - partial state (`started_at` set with missing goal links) on second-step failure.
   - Remediation:
     - route all starts through transactional RPC (`start_session_with_goals`) or add DB-side atomic procedure for edge path.

10. Route guard matrix is primarily declarative and test-referenced, not runtime enforcement source.
    - Evidence:
      - `src/server/routes/guards.ts` mostly referenced by tests/docs (`tests/edge/route-guards-parity.test.ts`).
    - Blast radius:
      - policy drift and false confidence when runtime checks diverge.
    - Remediation:
      - either wire guard definitions into runtime policy checks or clearly mark as non-authoritative documentation/test artifact.

## Prioritized Remediation Backlog

### P0 (Immediate)

1. Make recurring confirm all-or-nothing (transactional batch RPC) or fully compensated on partial failure.
2. Fix hold cleanup idempotency keying in `bookSession` cleanup path.
3. Add `NOT FOUND` safeguards in confirm SQL update branch before hold deletion.
4. Patch admin RPC authorization to enforce active/expiry role semantics.

### P1 (Near-term)

5. Align org-scoped role resolution in edge auth middleware.
6. Add financial validation + DB constraints for `rate_per_hour`/`total_cost`.
7. Unify session-start authority to transactional RPC path.
8. Reconcile cancel policy vs lifecycle model (`scheduled` only vs `in_progress` support).

### P2 (Hardening)

9. Align TypeScript session status union with DB states.
10. Clarify runtime authority of route guard matrix and prevent drift through contract tests.

## Targeted Test Plan Additions

### Critical/High tests to add

- `tests/edge/sessions-confirm.partial-failure.test.ts`
  - assert partial confirm behavior and post-failure DB consistency.
- `tests/edge/sessions-cancel.hold-authz.test.ts`
  - assert therapist/cross-org hold release denials and hold retention.
- `tests/integration/idempotency.sessions-scope.test.ts`
  - assert idempotency replay isolation by org/user/resource.
- `tests/integration/session-state-transition-race.test.ts`
  - concurrent start/cancel race and deterministic terminal state assertions.
- `tests/edge/authz-drift.booking-start-cancel.parity.test.ts`
  - backend endpoint authorization parity against declared policy.
- `tests/security/rls.spec.ts` extensions
  - expired/deactivated admin invocation denial for admin management RPCs.
- `src/server/__tests__/bookHandler.test.ts` extensions
  - reject invalid financial fields and relationship mismatch edge cases.

## Risk Sign-off Snapshot

- Security/tenant isolation: **At risk** until org-aware role resolution and admin RPC role-state checks are fixed.
- State transitions: **Partially aligned**; DB is stronger than edge/type layers in key paths.
- Financial correctness: **At risk** due to partial booking persistence and unchecked persisted financial inputs.
- Data integrity: **At risk** due to hold-consumption edge cases and non-atomic session-start path.

## Recommended Owners

- Scheduling lifecycle fixes: backend platform team (`supabase/functions/*` + scheduling SQL RPCs).
- Authz and role-state fixes: auth/security team (`_shared/auth-middleware.ts`, admin role SQL).
- Type and UI lifecycle alignment: frontend/domain team (`src/types/index.ts` and status consumers).
- Regression test suite: quality/security team (`tests/edge`, `tests/integration`, `tests/security`).

## Remediation Execution Status (2026-03-18)

- **Completed**
  - Atomic recurring confirm implemented via `confirm_session_holds_batch_with_enrichment`.
  - Hold-preservation safeguard added for `SESSION_NOT_FOUND` update-path outcomes.
  - Per-hold cleanup idempotency keying implemented in booking orchestration.
  - Admin RPC authorization hardened with active/expiry role checks.
  - Financial validation hardened at API and DB layers.
  - Route parity aligned:
    - `sessions-start` uses transactional `start_session_with_goals` RPC.
    - `sessions-confirm` uses atomic batch confirm semantics.
    - `sessions-cancel` aligned with `scheduled` + `in_progress` cancellable policy.
    - `/api/book` maps validation failure semantics consistently.
  - Type contract aligned (`Session.status` includes `in_progress`).
- **Production artifacts**
  - Migrations applied:
    - `20260318150000_batch_confirm_financial_hardening_v2`
    - `20260318152000_admin_role_state_hardening`
  - Lifecycle edge bundle deployed for all required scheduling/session functions.
- **Validation**
  - Targeted regressions and typecheck passed.
  - Operational details and rollback guidance documented in `docs/SESSION_LIFECYCLE_REMEDIATION_RUNBOOK.md`.
