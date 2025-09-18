# Booking & Billing Feature Matrix

| Capability | Status | Behavior Summary | Evidence |
| --- | --- | --- | --- |
| Session hold lifecycle | ✅ Pass | Booking requests issue a hold via `sessions-hold`, persist required identifiers, and expect a confirmation round-trip before insert/update. Holds enforce therapist/client availability and expire if mismatched or stale. | [src/lib/sessionHolds.ts](../src/lib/sessionHolds.ts), [supabase/migrations/20250711090000_session_holds.sql](../supabase/migrations/20250711090000_session_holds.sql) |
| Status normalization | ✅ Pass | Server defaults missing session statuses to `scheduled` before calling the confirmation edge function, matching the `sessions.status` column default and permitted enum (`scheduled`, `completed`, `cancelled`, `no-show`). | [src/server/bookSession.ts](../src/server/bookSession.ts), [src/types/index.ts](../src/types/index.ts), [supabase/migrations/20250315065232_damp_jungle.sql](../supabase/migrations/20250315065232_damp_jungle.sql) |
| CPT derivation from session context | ✅ Pass | `deriveCptMetadata` selects a base CPT code from the session type (individual, group, assessment, consultation) with fallback logic and description mapping. Duration is computed from start/end times for downstream billing. | [src/server/deriveCpt.ts](../src/server/deriveCpt.ts), [tests/booking.billing.spec.ts](../tests/booking.billing.spec.ts) |
| Modifier enrichment | ✅ Pass | Location keywords add telehealth (`95`) and school (`HQ`) modifiers, long sessions append `KX`, and user overrides are uppercased/deduped before returning to the client. | [src/server/deriveCpt.ts](../src/server/deriveCpt.ts), [tests/booking.billing.spec.ts](../tests/booking.billing.spec.ts) |
| Override handling | ✅ Pass | Explicit CPT code overrides bypass session-type rules while still normalizing modifiers and descriptions; confirmation responses propagate rounded durations to the persisted session. | [src/server/deriveCpt.ts](../src/server/deriveCpt.ts), [src/lib/sessionHolds.ts](../src/lib/sessionHolds.ts), [tests/booking.billing.spec.ts](../tests/booking.billing.spec.ts) |
| Persistent CPT bookkeeping | ✅ Pass | Dedicated tables store CPT line items and associated modifiers with therapist-scoped RLS, ensuring a single primary CPT line per session and cascade cleanup when sessions delete. | [supabase/migrations/20250920120200_create_session_cpt_linkages.sql](../supabase/migrations/20250920120200_create_session_cpt_linkages.sql), [supabase/migrations/20250920120100_create_cpt_modifier_associations.sql](../supabase/migrations/20250920120100_create_cpt_modifier_associations.sql) |
| Concurrent slot contention handling | ✅ Pass | Concurrency simulations ensure that when two clients attempt to book the same therapist/time window, exactly one confirmation succeeds and the losing hold is cancelled to free the slot. | [src/server/__tests__/bookSession.test.ts](../src/server/__tests__/bookSession.test.ts), [src/lib/__tests__/bookingConcurrency.test.ts](../src/lib/__tests__/bookingConcurrency.test.ts) |
| DST-aware duration calculations | ⚠️ Observed | Duration math depends on ISO offsets; DST fallback scenarios span three real hours even though wall-clock times repeat. Additional verification is recommended for billing during transitions. | [src/server/deriveCpt.ts](../src/server/deriveCpt.ts), [src/server/__tests__/deriveCpt.test.ts](../src/server/__tests__/deriveCpt.test.ts) |

## Failing test logs

```
<no failing tests recorded during this run>
```
