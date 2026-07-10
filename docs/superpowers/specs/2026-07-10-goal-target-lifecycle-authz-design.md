# Goal Target Lifecycle Authorization Design

## Objective

Implement a tenant-safe target lifecycle in which a midtier can archive or restore a goal target, while only a BCBA (and the existing super-admin override) can hard-delete an eligible target.

## Authorization contract

- All reads and mutations remain scoped to the caller's active organization.
- `manageProgramsGoals` continues to govern ordinary target creation and editing.
- A new `deleteGoalTargets` frontend capability is granted only to `bcba` and `super_admin`; it controls presentation only and is never the security boundary.
- Database deletion authority is checked from active `user_roles` through a dedicated exact-role capability and a strict RLS DELETE policy. Midtier, therapist, admin, BT, client, and unauthenticated callers cannot hard-delete.
- Midtier remains able to archive and restore through the existing authenticated PATCH boundary. “Archive only” refers to destructive lifecycle actions; this slice does not remove the established non-destructive target-edit permissions from midtier.

## Data integrity contract

- Hard deletion is allowed only when the target is already `archived` and no `trial_events` row references it.
- A referenced target maps to `409 Conflict`: a PostgreSQL foreign-key conflict returns `Goal target has trial history and cannot be deleted`; a strict-RLS zero-row delete after archived preflight returns `Goal target has trial history or is no longer eligible for deletion`.
- A non-archived target returns `409 Conflict` with `Only archived goal targets can be deleted`.
- Trial events are never deleted or cascaded by this feature.
- Missing and out-of-scope targets return a non-disclosing `404 Goal target not found` response.

## Architecture

The database owns the destructive invariant through `app.current_user_can_delete_goal_targets(uuid)`, a restricted public capability wrapper, and `goal_targets_bcba_delete_archived_unused`, an authenticated DELETE RLS policy. The policy requires the caller's active organization, exact BCBA or super-admin authority, archived status, and no visible trial history. Authenticated DELETE is granted only alongside this RLS policy; the non-cascading foreign key remains the authoritative concurrency and history guard.

Both the Supabase Edge Function and the server fallback add DELETE support using the request-scoped client. They preflight the delete capability and target status for clear responses, then issue the RLS-protected DELETE. They share an HTTP response contract: 400 invalid identifier, 403 unauthorized, 404 missing/out-of-scope, 409 not archived or referenced, 502 capability validation failure, and 200 with the deleted target identifier on success.

The Programs/Goals UI replaces status-dropdown-only lifecycle management with explicit Archive, Restore, and Delete actions. Active targets render by default; archived targets render in an expandable archived section. Delete is shown only when `deleteGoalTargets` is present and the target is archived. Confirmation names the target and explains irreversibility. Failed mutations retain visible state and display the server error.

## Verification

- Migration contract tests prove restricted capability EXECUTE grants, caller/org/exact-role checks, the DELETE grant plus strict RLS policy, archived/history guards, and the unchanged non-cascading foreign key.
- Handler tests prove Edge/server parity for BCBA success and all error mappings.
- Role/UI tests prove midtier archive/restore without Delete, BCBA Delete visibility, confirmation behavior, and archived filtering.
- Tenant validation and hosted smoke prove cross-organization deletion is impossible and trial history is preserved.

## Non-goals

- Cascading or rewriting trial history.
- Removing existing non-destructive midtier target-edit permissions.
- Deleting goals or programs.
- Broad role-system refactoring.
