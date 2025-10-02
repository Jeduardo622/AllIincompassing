# Session hold conflict codes

The `acquire_session_hold` RPC returns structured error responses when it cannot reserve a slot. The
`sessions-hold` Edge Function forwards these codes to clients so the front-end can display specific
messages and retry guidance.

| Code | Description | HTTP status |
| ---- | ----------- | ----------- |
| `INVALID_RANGE` | The supplied `end_time` is not after `start_time`. | 400 |
| `HOLD_EXISTS` | A hold already exists for the same therapist, client, start time pair. | 409 |
| `THERAPIST_CONFLICT` | The therapist already has a confirmed session that overlaps the requested range. | 409 |
| `CLIENT_CONFLICT` | The client already has a confirmed session that overlaps the requested range. | 409 |
| `THERAPIST_HOLD_CONFLICT` | A non-expired hold already reserves the overlapping range for the therapist. | 409 |
| `CLIENT_HOLD_CONFLICT` | A non-expired hold already reserves the overlapping range for the client. | 409 |
| `FORBIDDEN` | The authenticated actor is not permitted to manage holds for the target therapist. | 403 |

The new `THERAPIST_HOLD_CONFLICT` and `CLIENT_HOLD_CONFLICT` codes are emitted both during the
pre-insert range check and by the database exclusion constraints. Callers should treat them as
temporary conflicts and either retry after the existing hold expires or prompt the user to choose a
different slot.
