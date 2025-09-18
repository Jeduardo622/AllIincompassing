# Session hold contract & resiliency guidance

## Observed race conditions
- The booking flow is a multi-step pipeline: acquire a hold, confirm the session, then persist CPT metadata. Because each step is an independent network call, failures between steps can leave the system in an inconsistent state (for example, a session can be confirmed even if CPT persistence fails).【F:src/server/bookSession.ts†L33-L97】
- If two clients request the same therapist slot concurrently, only one confirmation should succeed. The new concurrency test shows that the losing hold must be cancelled explicitly, otherwise the slot can remain reserved until the hold expires.【F:src/server/__tests__/bookSession.test.ts†L132-L210】

## Idempotency & retry expectations
- Hold, confirm, and cancel requests already accept an `Idempotency-Key` header, but retries are still caller-managed. The booking service should propagate a single idempotency key to both the hold and confirm calls so that network retries do not duplicate sessions.【F:src/server/bookSession.ts†L45-L74】【F:src/server/__tests__/bookSession.test.ts†L86-L131】
- Cancellations currently omit an idempotency key, so concurrent cleanup retries can still race. Future work should thread a derived key (for example `cancel:${holdKey}`) through the cancel step to make release attempts idempotent.【F:src/server/bookSession.ts†L65-L77】

## Proposed hold → confirm contract
1. **Hold request**: clients send therapist/client IDs, UTC start/end timestamps, optional session ID, and offsets/time-zone context. The edge function returns `{ holdKey, holdId, expiresAt }` and echoes the idempotency key in the response headers for logging.【F:src/lib/sessionHolds.ts†L21-L76】
2. **Confirmation**: callers must supply both `holdKey` and `holdId` (or another immutable token) to prove they are confirming the exact hold they acquired. The confirm request should also include the same idempotency key that was used for the hold so that the edge function can safely return the previously confirmed session on retries.【F:src/lib/sessionHolds.ts†L78-L124】
3. **Cancellation**: when confirmation fails, cancel the hold immediately and propagate the hold’s unique identifiers and a dedicated idempotency key. Responses should indicate whether a hold was actually released to guard against the case where confirmation already consumed the hold.【F:src/lib/sessionHolds.ts†L126-L171】
4. **Retries**: treat 409 conflict codes as soft failures—retry acquisition after the `expiresAt` timestamp, and back off exponential retries for 500-range errors. The concurrency integration test demonstrates how a losing hold can be cancelled and retried safely.【F:src/lib/__tests__/bookingConcurrency.test.ts†L180-L242】

## DST & timezone pitfalls
- Duration and billing metadata are computed by subtracting ISO timestamps with JavaScript’s `Date`, so offsets embedded in the ISO string determine the billed minutes. When sessions span DST transitions the real-world duration may differ from naive wall-clock arithmetic.【F:src/server/deriveCpt.ts†L33-L72】
- Tests now assert that a session crossing the “fall back” boundary lasts three real hours, highlighting the need to always transmit explicit offsets and to double-check downstream billing during DST changes.【F:src/server/__tests__/deriveCpt.test.ts†L41-L62】

## Recommended backlog items
- Add an idempotent cancel path keyed by hold identifiers to remove the residual race during cleanup.
- Persist hold acquisition attempts (holdKey, holdId, idempotency key, and timestamps) so support teams can correlate retries and diagnose collisions.
- Extend the booking API to surface retry-after hints when conflicts arise so the client can schedule deterministic retries instead of busy looping.
