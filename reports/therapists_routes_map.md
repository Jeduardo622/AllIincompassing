# Therapists Route Map

| Surface | Method | Path | Source | Auth Guard | Primary Data Touchpoints |
| --- | --- | --- | --- | --- | --- |
| Edge Function | GET/POST | `/get-schedule-data-batch` | `supabase/functions/get-schedule-data-batch/index.ts` | `getUserOrThrow` + request-based rate limiting. | Reads `sessions`, joins `therapists`, `clients`, `authorizations`; optionally pulls availability JSON. |
| Edge Function | GET | `/get-sessions-optimized` | `supabase/functions/get-sessions-optimized/index.ts` | `getUserOrThrow`; no additional role scoping. | Queries `sessions` with therapist/client filters and attaches related profiles + authorizations. |
| Edge Function | GET | `/get-dropdown-data` | `supabase/functions/get-dropdown-data/index.ts` | `getUserOrThrow`; toggles inactive filtering. | Reads `therapists`/`clients` tables; returns static enumerations for statuses/locations. |
| Edge Function | POST | `/sessions/confirm` | `supabase/functions/sessions-confirm/index.ts` | `ensureAuthenticated` (Supabase auth) + idempotency enforcement. | Persists session confirmation via admin client; interacts with idempotency store and Supabase RPC for holds. |
| Edge Function | POST | `/sessions/cancel` | `supabase/functions/sessions-cancel/index.ts` | Authenticates via Supabase, validates payload with zod. | Updates `sessions` status, records cancellation metadata. |
| Edge Function | POST | `/sessions/hold` | `supabase/functions/sessions-hold/index.ts` | Auth + input zod validation; ensures hold uniqueness before insert. | Writes to `session_holds`, touches `sessions` for dedupe. |

## Security Risks
- None of the schedule-facing functions enforce organization scoping; if RLS on `sessions` is misconfigured, therapists could enumerate cross-tenant events simply by toggling filters.
- `sessions-confirm` accepts arbitrary session payloads and trusts hold keys; a compromised hold key enables forging confirmations unless additional cross-checks run inside the database.
- Dropdown enumeration returns full therapist/client rosters; absent search throttling, it can be abused for bulk email scraping. 
