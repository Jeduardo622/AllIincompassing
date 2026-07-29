# Appointment Reactivation Design

## Goal

Allow authorized scheduling staff to reactivate a cancelled appointment at its original date and time when that appointment is still valid and conflict-free. If the original slot is no longer available, keep the appointment cancelled and move the user into the existing rescheduling interaction.

## Route And Scope

- Linear issue: `WIN-263`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Protected surfaces: `supabase/migrations/**`, `supabase/functions/**`, tenant-scoped scheduling writes
- Exact UI and server roles: `admin`, `admin_schedule`, `midtier`, `bcba`, `super_admin`
- Denied roles: `therapist`, `bt`

The implementation may add one focused migration, one dedicated Edge Function, one browser client helper, and the minimum Schedule/SessionModal wiring and tests. It must not broaden schedule RLS, rewrite cancellation, change ordinary create/reschedule behavior, or alter session-capture billing rules.

## Current-State Evidence

The hosted Supabase project `wnnjeqheqxxyrgsjmygy` is the runtime source of truth.

- `public.enforce_session_status_transition()` rejects `cancelled -> scheduled`.
- `app.current_user_can_manage_schedule(uuid)` includes therapists, so it is too broad for this action by itself.
- `public.sessions` RLS is organization scoped, but a privileged Edge Function must still prove the target session belongs to the resolved organization before mutation.
- `sessions_no_overlap` enforces therapist overlap at the table boundary, while booking RPCs also check therapist and client overlap against non-cancelled sessions.
- The existing Schedule surface already sends `canCreateSchedules=false` for therapist/BT views and already owns the rescheduling interaction.

## User Experience

For an existing cancelled appointment, `SessionModal` shows a distinct **Reactivate appointment** button when `canCreateSchedules` is true. The normal submit button does not reactivate a cancelled session by changing the status dropdown.

Selecting the action asks for confirmation using the original appointment date and time. While the request is pending, the reactivation action is disabled.

Outcomes:

1. Success: the same appointment row returns to `scheduled`, cancellation attribution is cleared, the modal closes, schedule queries refresh, and a success notice is shown.
2. Already reactivated: the response is treated as an idempotent success and the schedule refreshes.
3. Therapist or client conflict: the appointment remains cancelled. The modal closes and the existing reschedule selection state is activated for that same appointment so the user can choose another empty slot.
4. Invalid linked authorization: the appointment remains cancelled and the modal shows a clear error. Rescheduling is not opened because a time change may not repair authorization coverage.
5. Forbidden, missing, or other lifecycle state: the appointment remains unchanged and a clear error is shown.

## Server Boundary

Add an authenticated `sessions-reactivate` Edge Function accepting:

```json
{
  "session_id": "uuid"
}
```

The request also accepts the existing `Idempotency-Key` and trace headers. The function:

1. authenticates the caller;
2. resolves the target session without exposing cross-organization data;
3. resolves the scheduling organization using the same selected-org/super-admin pattern as existing scheduling functions;
4. requires one exact role from `admin`, `admin_schedule`, `midtier`, `bcba`, or `super_admin`;
5. invokes a service-role-only transactional RPC;
6. maps structured RPC outcomes to stable HTTP responses;
7. persists and replays responses by scoped idempotency key.

The Edge Function never accepts an organization, therapist, client, date, or status from the browser. Those values come from the stored session row.

## Transactional Database Operation

Add `public.reactivate_cancelled_session(p_session_id uuid, p_actor_id uuid)` as `SECURITY DEFINER` with an empty search path. Revoke execute from `public`, `anon`, and `authenticated`; grant execute only to `service_role`.

Within one transaction the RPC:

1. locks the session row with `FOR UPDATE`;
2. returns `SESSION_NOT_FOUND` when absent;
3. returns idempotent success when status is already `scheduled`;
4. returns `INVALID_STATUS` for any state other than `cancelled`;
5. validates any linked authorization row remains in the same organization and client scope, is approved, and covers the stored session date;
6. checks therapist and client overlap against other non-cancelled sessions using half-open `[start_time, end_time)` ranges;
7. checks unexpired therapist and client session holds using the same half-open range semantics;
8. updates only `status = 'scheduled'`, `cancellation_attribution = null`, `updated_at`, and `updated_by`;
9. writes one `session_reactivated` audit row in the same transaction, preserving the prior cancellation attribution without copying notes or PHI;
10. returns the stored session identifiers and original time window.

The status transition trigger is changed only enough to permit `cancelled -> scheduled`. Completed, no-show, and in-progress lifecycle rules stay unchanged. The RPC preserves `notes`, clinical links, plan links, times, therapist, client, and session ID.

When `authorization_id` is null, reactivation follows current booking behavior and does not invent a new requirement that ordinary booking does not enforce. When a linked authorization exists, stale or cross-scope linkage is rejected instead of being silently ignored.

## Tenant And Authorization Guarantees

- The Edge Function checks exact persisted role authority through `user_roles`-backed RPC helpers.
- `therapist` and `bt` are denied even though therapists can manage some schedule operations elsewhere.
- The target session must match the resolved scheduling organization before the privileged RPC is called.
- The RPC is not callable by browser roles.
- No RLS policy or table grant is broadened.
- Cross-organization session IDs are reported as forbidden/not found without leaking session details.

## Audit And Idempotency

The idempotency key is scoped to the authenticated actor and `sessions-reactivate`. Reusing a key with a different session payload returns a conflict. Replaying the same request returns the stored response.

A successful transition writes a `session_reactivated` audit event atomically with the status update. It contains only operational identifiers, prior cancellation attribution, and status/time metadata; it must not copy schedule notes or PHI into the audit payload. An already-scheduled replay does not add another lifecycle audit event.

## Verification

Test-first coverage must prove:

- migration transition, grant, conflict, linked-authorization, note preservation, and attribution clearing behavior;
- Edge Function authentication, exact role matrix, organization scoping, response mapping, audit requirement, and idempotency;
- browser helper headers and response normalization;
- modal action visibility and disabled/pending behavior;
- Schedule success refresh and conflict-to-reschedule wiring.

Required commands are:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- `npm run ci:playwright`
- `npm run build`
- `npm run verify:local` when its prerequisites are available

The user will manually measure the finished UX on the reviewable preview. Manual measurement complements but does not replace the automated protected-path gates.

## Stop Conditions

Stop and re-route if implementation requires:

- changing shared RLS policies or schedule-role definitions;
- changing ordinary booking-time authorization requirements;
- changing cancellation behavior;
- adding new tables or a broad audit redesign;
- replacing the existing reschedule interaction;
- touching authentication, runtime configuration, CI, or deployment configuration.
