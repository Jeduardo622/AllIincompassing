# Session hold contract & resiliency guidance

## Observed race conditions
- The booking flow is a multi-step pipeline: acquire a hold, confirm the session, then persist CPT metadata. Because each step is an independent network call, failures between steps can leave the system in an inconsistent state (for example, a session can be confirmed even if CPT persistence fails).【F:src/server/bookSession.ts†L33-L97】
- If two clients request the same therapist slot concurrently, only one confirmation should succeed. The new concurrency test shows that the losing hold must be cancelled explicitly, otherwise the slot can remain reserved until the hold expires.【F:src/server/__tests__/bookSession.test.ts†L132-L210】

## Idempotency & retry expectations
- Hold, confirm, and cancel requests already accept an `Idempotency-Key` header, but retries are still caller-managed. The booking service should propagate a single idempotency key to both the hold and confirm calls so that network retries do not duplicate sessions.【F:src/server/bookSession.ts†L45-L74】【F:src/server/__tests__/bookSession.test.ts†L86-L131】
- Confirmation failures now trigger a deterministic cancel idempotency key derived from either the booking idempotency token or the hold key (`cancel:${idempotencyKey ?? holdKey}`) so that cleanup retries cannot re-enqueue duplicate releases.【F:src/server/bookSession.ts†L344-L353】【F:src/server/__tests__/bookSession.test.ts†L226-L252】
- Conflict responses now include `orchestration` hints with AI-suggested alternatives and rollback guidance for deterministic retries (`docs/SCHEDULING_ORCHESTRATION.md`).

## Proposed hold → confirm contract
1. **Hold request**: clients send therapist/client IDs, UTC start/end timestamps, optional session ID, and offsets/time-zone context. The edge function returns `{ holdKey, holdId, expiresAt }` and echoes the idempotency key in the response headers for logging.【F:src/lib/sessionHolds.ts†L21-L76】
2. **Confirmation**: callers must supply both `holdKey` and `holdId` (or another immutable token) to prove they are confirming the exact hold they acquired. The confirm request should also include the same idempotency key that was used for the hold so that the edge function can safely return the previously confirmed session on retries.【F:src/lib/sessionHolds.ts†L78-L124】
3. **Cancellation**: when confirmation fails, cancel the hold immediately and propagate the hold’s unique identifiers and a dedicated idempotency key. Responses should indicate whether a hold was actually released to guard against the case where confirmation already consumed the hold.【F:src/lib/sessionHolds.ts†L126-L171】
4. **Retries**: treat 409 conflict codes as soft failures—retry acquisition after the `expiresAt` timestamp, and back off exponential retries for 500-range errors. The concurrency integration test demonstrates how a losing hold can be cancelled and retried safely.【F:src/lib/__tests__/bookingConcurrency.test.ts†L180-L242】
5. **Retry hints**: hold and confirm edge functions now emit a `retryAfter` field in the JSON payload and a `Retry-After` response header whenever a conflict occurs so UIs can schedule deterministic back-offs instead of blind polling.【F:supabase/functions/sessions-hold/index.ts†L150-L205】【F:supabase/functions/sessions-confirm/index.ts†L199-L216】

## Audit logging
- Session hold acquisition, confirmation, release, and therapist note edits are now captured in the `session_audit_logs` table via the helper `record_session_audit`. Edge functions call this helper so support teams have an immutable trail of hold attempts without storing PHI in clear text.【F:supabase/migrations/20251111130000_therapist_sessions_enforcement.sql†L19-L152】【F:supabase/functions/_shared/audit.ts†L1-L35】
- Hold release and cancellation flows in `sessions-cancel` log `hold_released` and `session_cancelled` events respectively, allowing compliance teams to trace conflict resolution attempts.【F:supabase/functions/sessions-cancel/index.ts†L180-L260】

## DST & timezone pitfalls
- Duration and billing metadata are computed by subtracting ISO timestamps with JavaScript’s `Date`, so offsets embedded in the ISO string determine the billed minutes. When sessions span DST transitions the real-world duration may differ from naive wall-clock arithmetic.【F:src/server/deriveCpt.ts†L33-L72】
- Tests now assert that a session crossing the “fall back” boundary lasts three real hours, highlighting the need to always transmit explicit offsets and to double-check downstream billing during DST changes.【F:src/server/__tests__/deriveCpt.test.ts†L41-L62】

## Recommended backlog items
- [x] Add an idempotent cancel path keyed by hold identifiers to remove the residual race during cleanup.
- Persist hold acquisition attempts (holdKey, holdId, idempotency key, and timestamps) so support teams can correlate retries and diagnose collisions.
- [x] Extend the booking API to surface retry-after hints when conflicts arise so the client can schedule deterministic retries instead of busy looping.
