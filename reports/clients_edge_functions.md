# Clients Edge Function Inventory

| Function | Path | Core Logic | Input Validation | Outbound Calls |
| --- | --- | --- | --- | --- |
| `get-client-details` | `/get-client-details` | Branches on caller role to fetch a single client row, optionally ensuring therapist ownership via join on `sessions`. | Requires `clientId`; rejects when ID missing or when RPC denies role scope. | None beyond Supabase queries. |
| `initiate-client-onboarding` | `/initiate-client-onboarding` | Normalizes name/email, constructs `/clients/new` URL with prefilled query params, returns JSON success state. | Demands `client_name` and `client_email`; minimal sanitization beyond trimming + splitting. | None. |
| `profiles-me` | `/profiles/me` | GET returns sanitized caller profile; PUT filters allowed fields, validates phone/timezone, persists update. | Schema uses allowlist + regex/timezone checks; rejects empty payloads. | Supabase JS client queries `profiles` table. |
| `auth-signup` | `/auth/signup` | Handles credential provisioning for new accounts used by clients and caregivers. | Uses zod schema to enforce email/password/metadata shapes (see file). | Supabase auth admin API via service role. |

## Security Risks
- `initiate-client-onboarding` returns raw onboarding URL without signing; if front-end uses the URL in emails, tampering between generation and delivery could inject phishing parameters.
- `auth-signup` runs under service role credentials; ensure audit logging covers who initiated the call to attribute client account creation. 
