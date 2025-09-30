# Clients Route Map

| Surface | Method | Path | Source | Auth Guard | Primary Data Touchpoints |
| --- | --- | --- | --- | --- | --- |
| HTTP API | POST | `/api/book` | `src/server/api/book.ts` → `bookHandler` | Requires `Authorization: Bearer <supabase JWT>` and forwards token into `bookSession`. | Booking pipeline orchestrated by `src/server/bookSession.ts` writes sessions, holds, CPT metadata via Supabase client. |
| Edge Function | POST | `/get-client-details` | `supabase/functions/get-client-details/index.ts` → `handleGetClientDetails` | `createProtectedRoute` enforces authenticated user + role check through `user_has_role_for_org` RPC. | Reads `clients` table with optional join on `sessions` scoped by therapist/client relationship. |
| Edge Function | POST | `/initiate-client-onboarding` | `supabase/functions/initiate-client-onboarding/index.ts` | `getUserOrThrow` ensures authenticated caller; no role narrowing. | Generates onboarding URL by parsing payload; no direct DB writes but returns link into `/clients/new` workflow. |
| Edge Function | GET / PUT | `/profiles/me` | `supabase/functions/profiles-me/index.ts` | `createProtectedRoute` restricts to authenticated user; updates limited to enumerated fields. | Reads and updates `profiles` row for the caller; validates phone + timezone formats before persistence. |

## Security Risks
- `/initiate-client-onboarding` only checks that the caller is authenticated; any role could mint onboarding URLs for arbitrary metadata, enabling client-spoofing if links are not single-use or RLS-controlled.
- `bookHandler` trusts the upstream Supabase access token but does not independently confirm role/organization; if a compromised JWT from another tenant is replayed, `bookSession` logic depends entirely on downstream Supabase RLS for isolation.
- `profiles-me` allows arbitrary JSON under `preferences`; without server-side schema enforcement this could be abused to stash oversized payloads or inject unsupported feature flags consumed elsewhere in the UI. 
