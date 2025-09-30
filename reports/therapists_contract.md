# Therapists Request/Response Contract

| Endpoint | Method | Required Payload / Params | Optional Controls | Response Shape |
| --- | --- | --- | --- | --- |
| `/get-schedule-data-batch` | GET / POST | `start_date`, `end_date`; POST body accepts same along with arrays of `therapist_ids` or `client_ids`. | `batch_size`, `offset`, `include_availability`, `include_conflicts`. | `{ success, data: { sessions[], availability?, conflicts?, pagination, performance }, request_parameters }` with 500 error envelope on failure. |
| `/get-sessions-optimized` | GET | Query params `page`, `limit`, `therapist_id`, `client_id`, `status`, `start_date`, `end_date`, `location_type`. | None beyond filters. | `{ success: true, data: { sessions[], pagination, summary }, filters, performance }` or `{ success: false, error }`. |
| `/get-dropdown-data` | GET | `types` comma list and `include_inactive` flag. | None. | `{ success: true, data: { therapists?, clients?, locations?, ... }, cached, lastUpdated }`. |
| `/sessions/confirm` | POST | `{ hold_key, session: { start_time, end_time, ... } }`. | `occurrences[]`, timezone offset metadata. | `{ success: true, session, occurrences }` on success, else `{ success: false, error }` with 4xx/5xx. |
| `/sessions/hold` | POST | `session` block plus `duration_minutes`, `time_zone`. | `metadata`, `occurrences`. | `{ success: true, hold_key, expires_at }` or error JSON with descriptive `code`. |
| `/sessions/cancel` | POST | `{ session_id }`. | `reason`, `notes`, `cancellation_policy`. | `{ success: true, session_id }` or error with 4xx/5xx. |

## Security Risks
- `get-schedule-data-batch` exposes `authorization.sessions_remaining` counts that might be considered PHI; ensure HIPAA compliance before broad therapist rollout.
- Cancellation endpoint does not reconfirm therapist ownership—any authenticated user with a session ID could cancel unless RLS rejects the update.
- Bulk dropdown responses contain therapist emails; caching these in browsers may leak staff directories on shared workstations. 
