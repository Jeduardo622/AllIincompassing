# Clients Request/Response Contract

| Endpoint | Method | Required Payload | Optional Fields | Response Shape |
| --- | --- | --- | --- | --- |
| `/api/book` (`bookHandler`) | POST | `session` object with `clientId`, `therapistId`, `startTime`, `endTime`. | `recurrence`, `authorizationId`, `notes`, overrides forwarded to `bookSession`. | `{ success: true, data: BookSessionResult }` or `{ success: false, error }`; echoes `Idempotency-Key` header when supplied. |
| `/get-client-details` | POST | `{ clientId: string }` | None. | `{ client: Client }` on 200; 403/404 when access denied; 500 on RPC failure. |
| `/initiate-client-onboarding` | POST | `{ client_name, client_email }` | `date_of_birth`, `insurance_provider`, `referral_source`, `service_preference[]`. | `{ success: true, onboardingUrl, message }` or `{ success: false, error }` with status 400 on validation failure. |
| `/profiles/me` | GET | *Headers only* (`Authorization`). | Query params ignored. | `{ profile: {...} }` containing sanitized caller profile fields. |
| `/profiles/me` | PUT | Any subset of `first_name`, `last_name`, `phone`, `avatar_url`, `time_zone`, `preferences`. | None. | `{ message: 'Profile updated successfully', profile: {...} }` or error JSON with 400/500 status. |

## Security Risks
- Booking payload trusts caller-provided timestamps and durations; missing normalization may allow creation of sessions outside allowable windows if downstream validation regresses.
- `/get-client-details` leaks presence/absence information (403 vs 404) that could allow tenant enumeration when RPC role checks misconfigured.
- `/profiles/me` update path filters allowed keys but does not enforce length limits; large `preferences` blobs could trigger Supabase row bloat or exceed Postgres limits. 
