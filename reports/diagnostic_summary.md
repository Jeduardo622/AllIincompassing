# Booking Diagnostic Summary

## End-to-end flow
- Clients submit `POST /api/book` with a `session` payload, optional overrides, and idempotency header support. The handler validates JSON, injects the header value into the booking request, and returns normalized responses with shared CORS headers.
  - Evidence: [src/server/api/book.ts](../src/server/api/book.ts)
- `bookSession` enforces required identifiers and timestamps, derives CPT metadata, and orchestrates the hold → confirm lifecycle. Holds are cancelled on downstream failures to avoid stranded capacity.
  - Evidence: [src/server/bookSession.ts](../src/server/bookSession.ts), [src/lib/sessionHolds.ts](../src/lib/sessionHolds.ts)
- The session confirmation RPC in `sessions-hold` rounds durations to 15-minute CPT increments, rejects conflicts, and persists all auxiliary fields (location, type, notes, rate, total).
  - Evidence: [supabase/migrations/20250711090000_session_holds.sql](../supabase/migrations/20250711090000_session_holds.sql)

## Session status expectations
| Status | When it is set | Notes |
| --- | --- | --- |
| `scheduled` | Default when booking new sessions or when callers omit the field. | Server injects this default before confirmation and the database default matches. |
| `completed` | Post-session updates when clinical documentation is finalized. | Booking conflicts ignore completed entries because they represent historical work. |
| `cancelled` | Applied when staff void a reservation; still logged for audit but ignored in conflict checks. | Hold confirmation excludes cancelled sessions from overlap detection. |
| `no-show` | Recorded when a client misses a session without notice. | Downstream analytics aggregate no-shows for utilization reports. |

- Evidence: [src/types/index.ts](../src/types/index.ts), [supabase/migrations/20250315065232_damp_jungle.sql](../supabase/migrations/20250315065232_damp_jungle.sql), [supabase/migrations/20250711090000_session_holds.sql](../supabase/migrations/20250711090000_session_holds.sql)

## CPT and modifier coverage
- `deriveCptMetadata` normalizes session types, location modifiers, duration thresholds, and override semantics. The helper produces descriptions for common ABA codes and falls back to `97153` when session metadata is sparse.
  - Evidence: [src/server/deriveCpt.ts](../src/server/deriveCpt.ts)
- Booking integration tests assert modifier normalization (`tz` → `TZ`, addition of `95`/`HQ`/`KX`) and CPT selection via both default rules and explicit overrides.
  - Evidence: [tests/booking.billing.spec.ts](../tests/booking.billing.spec.ts)
- Primary CPT lines and modifier associations persist in dedicated tables with therapist-scoped RLS and uniqueness guarantees, ensuring each session has at most one primary CPT entry and deduped modifiers.
  - Evidence: [supabase/migrations/20250920120200_create_session_cpt_linkages.sql](../supabase/migrations/20250920120200_create_session_cpt_linkages.sql), [supabase/migrations/20250920120100_create_cpt_modifier_associations.sql](../supabase/migrations/20250920120100_create_cpt_modifier_associations.sql)

## Outstanding considerations
- Modifier suggestions rely on keyword heuristics (e.g., "tele", "school") and do not yet consult the CPT/modifier association tables; integrating those lookups would reduce false positives.
- Confirmation currently trusts edge responses for billing metadata; adding schema-level foreign keys into `session_cpt_entries` from automation jobs will enforce CPT synchronization once booking writes those rows.
