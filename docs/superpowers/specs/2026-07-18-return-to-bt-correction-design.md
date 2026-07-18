# Return to BT Correction Workflow Design

**Issue:** WIN-224  
**Lane:** Critical / high-risk human-reviewed  
**Status:** Approved for implementation

## Objective

Extend the assigned-BCBA supervision workflow with an auditable correction loop. The assigned BCBA can return a signed BT packet with a required reason, the original BT can submit a separately signed amendment, and the same assigned BCBA can review the original and amended versions before completing the separate supervision note.

The completed session and original signed BT packet remain immutable. Correction does not rerun session completion, goal progression, billing, or supervision assignment.

## State Machine

The existing request row remains the stable workflow identity and assigned-reviewer record.

- `pending` displays as **Pending Review**.
- `correction_required` displays as **Correction Required**.
- `resubmitted` displays as **Resubmitted**.
- `completed` displays as **Completed**.
- `cancelled` remains supported for the existing cancellation lifecycle but is not a new correction label.

Allowed transitions are:

1. `pending` or `resubmitted` -> `correction_required` by the same assigned exact BCBA, with a nonblank reason.
2. `correction_required` -> `resubmitted` by the original assigned/linked BT, with a validated amendment and new BT attestation.
3. `pending` or `resubmitted` -> `completed` by the same assigned exact BCBA through the existing separate supervision-note completion transaction.

Completed and cancelled requests cannot enter correction. Repeated correction rounds are allowed before completion.

## Append-Only Clinical History

The existing completed `client_session_notes` row and its BT attestation are version 1 and remain unchanged.

Add two tenant-scoped append-only tables:

1. `supervision_session_note_corrections`
   - request, organization, correction round, reviewer, reason, requested timestamp
   - resolution timestamp, resolving BT, and resulting amendment reference
   - one unresolved correction per request
2. `bt_session_note_amendments`
   - request, organization, original BT note, amendment version number
   - immutable template snapshot and validated response snapshot
   - authenticated BT signer, signature method/value, and signed timestamp
   - the correction round that required the amendment

Authenticated users receive no direct mutation grants. Security-definer transition RPCs perform all writes atomically with fixed search paths, explicit caller checks, and revoked `PUBLIC`/`anon` execution.

## Authorization Boundaries

### BCBA

- The caller must be authenticated, active, same-organization, have canonical exact `bcba` authority through `user_roles`, and equal `assigned_admin_user_id` on the request.
- Only that caller may return a request or complete its supervision note.
- Admin-family viewers retain existing org-scoped operational read visibility but cannot return or sign for the assigned BCBA.

### BT

- The caller must be authenticated, same-organization, and resolve through the existing exact assigned/linked BT authority for the request session and therapist.
- Only the original BT can read the correction task and submit its amendment.
- The BT cannot change request assignment, correction provenance, the original note, the completed session, or BCBA records.

### Tenant isolation

- Every privileged RPC derives organization scope from the authenticated caller.
- Request, session, original note, amendment, correction, therapist, and assignee must agree on organization.
- Missing or foreign records fail without revealing cross-tenant clinical content.
- New tables have RLS enabled, explicit least-privilege grants, indexed policy/join keys, and service-role access consistent with existing protected tables.

## RPC Contracts

### `return_supervision_session_note_request_to_bt(p_request_id uuid, p_reason text)`

Locks the request, checks the assigned exact BCBA and allowed current status, validates a trimmed reason of 1-2000 characters, appends the next correction round, and sets the request to `correction_required`. It returns the correction id.

### `get_bt_supervision_correction_tasks()`

Returns only unresolved correction tasks owned by the authenticated original BT. Each task includes the request/session identity, client display data needed by Dashboard, correction reason/reviewer timestamp, original version, latest amendment when present, and immutable template/response data needed to prefill the existing BT ABA form.

### `resubmit_bt_supervision_correction(...)`

Locks the request and active correction, verifies the original BT and `correction_required` state, validates the response payload against the immutable BT template contract, validates typed/drawn signature bounds, appends the next amendment version, resolves the correction round, and changes the request to `resubmitted`. Assignment is never recalculated.

### BCBA review packet and completion

The review-packet RPC returns `pending`, `resubmitted`, and authorized completed workflow records as needed for labels. It returns the immutable original BT packet, ordered amendments, active correction metadata, and `can_complete`/`can_return` flags. Completion accepts only `pending` or `resubmitted` and validates the latest reviewable version without modifying BT records.

## Dashboard Behavior

### Assigned BCBA

- Each review card shows the mapped status badge.
- Opening a request presents the latest BT version first and makes the original and earlier amendments distinguishable for comparison.
- **Return to BT** opens a focused reason input; blank/oversized reasons are rejected before RPC submission and again in the database.
- **Sign and Complete Supervision Note** remains the independent BCBA record action and is available only for `pending` or `resubmitted` requests where `can_complete` is true.

### Original BT

- Dashboard contains a focused **Corrections Required** section only when the authenticated BT has tasks.
- A task shows **Correction Required**, the correction reason, and reviewer timestamp.
- Opening it reuses the existing BT ABA fields and signature component, prefilled from the latest reviewable version.
- Submission requires a fresh BT signature. Success changes the card to **Resubmitted** and removes it from the BT active correction list.

The sidebar count remains an action count, not analytics: BCBA work counts `pending` and `resubmitted`; BT work counts `correction_required` tasks owned by that BT.

## Failure And Concurrency Behavior

- Transitions lock the request and active correction so double submission cannot create duplicate rounds or versions.
- Unique constraints enforce correction round and amendment version monotonicity.
- A stale state returns a constraint conflict and performs no partial writes.
- Invalid payloads, signatures, reasons, foreign tenants, wrong BTs, and wrong BCBAs fail closed.
- Dashboard shows a scoped retryable error without replacing unrelated dashboard content.

## Verification

Test-first coverage must prove:

- migration shape, RLS, grants, indexes, function revocations, fixed search paths, and allowed states
- assigned-BCBA-only return and completion, including same-org foreign BCBA denial
- original-BT-only task visibility and resubmission, including same-org foreign BT denial
- cross-tenant denial for every read and write RPC
- immutable original version, append-only version 2+, fresh BT re-attestation, and repeated rounds
- assignment remains unchanged across correction and resubmission
- state labels, required reason, BT correction form, version comparison, and button eligibility
- no session completion, goal progression, billing, notification, analytics, PDF, or reassignment side effect
- hosted synthetic BT -> BCBA -> BT -> BCBA proof on the exact PR head and disposable Supabase preview

Critical-lane commands are focused Vitest/SQL smoke first, then `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run build`, `npm run ci:playwright` where credentials permit, and `npm run verify:local` where locally meaningful.

## Scope And Non-Goals

In scope: one forward migration, protected RPC/RLS/grant changes, supervision and BT adapters, focused Dashboard/form wiring, test/proof scripts, Linear/handoff artifacts, and a human-reviewed PR.

Out of scope: notifications, analytics, PDF exports, general dashboard redesign, staffing/reassignment UI, broad role changes, session reopening, goal/billing changes, and production migration deployment.

## Rollout And Recovery

Apply only to a disposable or managed PR-preview Supabase branch during verification. Production application is not part of this implementation task. Rollback is a reviewed forward migration that restores prior functions/policies/status constraints while preserving clinical correction and amendment history; it does not delete signed records.
