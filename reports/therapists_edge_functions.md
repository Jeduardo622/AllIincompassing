# Therapists Edge Function Inventory

| Function | Purpose | Input Validation | Key Dependencies |
| --- | --- | --- | --- |
| `get-schedule-data-batch` | Batch loads therapist sessions, optional availability/conflict data. | Combines zod schema with ISO date coercion; enforces limits on `batch_size`. | Rate limiter, `sessions`, `therapists`, `authorizations` tables. |
| `get-sessions-optimized` | Provides paginated session list plus summary counts. | Parses query params manually, caps limit to 100. | `sessions` table with joins to `therapists`, `clients`, `authorizations`. |
| `get-dropdown-data` | Supplies therapist/client/location dropdown options. | Query params only; no schema enforcement beyond boolean parsing. | Static enumerations plus `therapists` and `clients` selects. |
| `sessions-hold` | Creates provisional holds before confirmation. | zod schema ensures timestamps, timezone offsets, and recurrence structure. | `session_holds`, `sessions`, `therapists`, `clients`. |
| `sessions-confirm` | Converts holds into persisted sessions with idempotency. | Validates presence of hold key + session times, normalizes timezone offsets. | Idempotency service (`supabase.functions._shared`), `session_holds` cleanup, `sessions` writes. |
| `sessions-cancel` | Cancels scheduled sessions and records metadata. | zod schema for `session_id`, reason strings, optional metadata. | `sessions`, `session_cancellations` tables and RPC logs. |
| `suggest-alternative-times` | Returns recommended replacement slots using heuristics. | Validates timezone/duration input. | `sessions`, `therapist_availability` heuristics. |

## Security Risks
- Alternative-time suggestions rely on heuristic filtering; without organization scoping, cross-tenant schedule density can leak via returned options.
- Hold and confirm functions rely on consistent timezone offsets supplied by the caller; mismatched offsets could lead to holds confirmed at unintended UTC times, effectively leaking other therapists’ availability windows. 
