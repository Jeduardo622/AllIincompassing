# Clients Supabase Static Assets

| Object | Type | Source Reference | Purpose | Security Controls |
| --- | --- | --- | --- | --- |
| `clients` table | Postgres table | Queried in `supabase/functions/get-client-details/index.ts` and `src/pages/Clients.tsx`. | Stores demographic + service preference details rendered in client roster and detail views. | Relies on row-level policies invoked via `user_has_role_for_org`; UI fetches use service role session (React) so ensure policies prevent cross-tenant reads. |
| `create_client` RPC | Postgres function | Invoked through `supabase.rpc('create_client')` in `src/pages/Clients.tsx`. | Inserts normalized client payloads, used for roster creation flows. | Must validate organization/creator in SQL; frontend currently trusts Supabase to reject unauthorized callers. |
| `admin_invite_tokens` table | Postgres table | Checked inside `supabase/functions/admin-invite/index.ts` when sending client onboarding invites indirectly. | Avoids duplicate invites and tracks expirations. | Exposed to admins via service role client inside function; ensure policies restrict insert/select to privileged roles only. |
| `profiles` table | Postgres table | Mutated via `supabase/functions/profiles-me/index.ts`. | Stores profile metadata reused by clients for preferences + timezone. | Edge function limits fields, but direct table updates in UI would bypass validation unless RLS enforces `id = auth.uid()`. |

## Security Risks
- React screens query `clients` with the browser Supabase client, which uses the public anon key; any RLS regression immediately becomes a data leak across organizations.
- `create_client` RPC execution happens client-side without server mediation; if SQL policies allow inserts, a malicious actor can seed bogus client rows or escalate privileges by crafting metadata accepted downstream.
- `admin_invite_tokens` is read with elevated service role credentials; if the function leaked raw token hashes they could be replayed. Ensure responses never expose `token_hash`. 
