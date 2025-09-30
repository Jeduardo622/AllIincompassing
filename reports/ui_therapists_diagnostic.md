# Therapists UI Diagnostic

| Screen / Component | Data Sources | Mutations | Header Expectations | Notes |
| --- | --- | --- | --- | --- |
| `src/pages/Therapists.tsx` | `supabase.from('therapists')` selecting rich profile fields. | Inserts via `.insert`, updates via `.update`, deletes via `.delete`. | Browser Supabase session token. | Client-side filtering for status/location; risk of exposing inactive therapists if RLS misconfigured. |
| `src/pages/TherapistDetails.tsx` | Uses `useQuery` to hit `/functions/v1/get-therapist-details`. | None inline; surfaces schedule + metrics. | Expects `Authorization: Bearer <JWT>` automatically set by Supabase client. | Edge function only validates therapistId; no org gating beyond RLS. |
| `src/pages/Schedule.tsx` | Calls `useScheduleDataBatch`, `useSessionsOptimized`, `useDropdownData` hitting edge functions. | Mutations via `/sessions/hold`, `/sessions/confirm`, `cancelSessions`. | Requires `Idempotency-Key` when confirming sessions; fetch hooks attach `Authorization`. | Heavy React state; errors bubble via toast but not surfaced to instrumentation. |
| `src/components/SessionModal` | Wraps scheduling forms; posts to `bookSession` API. | Creates holds/confirmations. | Adds `Idempotency-Key` header via helper when available. | Missing guard for double submission beyond disable states. |

## Security Risks
- Therapist list exposes full addresses and licensing numbers; ensure UI masks sensitive fields unless user has compliance permissions.
- Schedule page caches dropdown data globally; stale tokens could allow previously removed therapists to appear until browser refresh. 
- Lack of retry throttling on schedule mutations could spam session holds leading to resource exhaustion. 
