# Clients UI Diagnostic

| Screen / Component | Data Sources | Mutations | Header Expectations | Notes |
| --- | --- | --- | --- | --- |
| `src/pages/Clients.tsx` | Uses `supabase.from('clients')` via anon key. | Creates via `create_client` RPC; updates/deletes directly on `clients`. | Relies on browser Supabase client to inject `Authorization` (anon key JWT). | Bulk fetch renders full roster; filtering happens client-side so large tenants may experience latency. |
| `src/pages/ClientDetails.tsx` | `supabase.from('clients').select('*').eq('id', clientId)` | None in page; tabs issue their own RPCs. | Browser Supabase session token. | Missing org guard; 404 state triggered only when Supabase rejects query. |
| `src/pages/ClientOnboardingPage.tsx` | Reads query params prefilled by `/initiate-client-onboarding`; posts to `supabase.rpc('create_client')`. | On submit, triggers RPC. | Needs valid Supabase session; handles unauthenticated redirect upstream. | Form trusts query params; should sanitize to avoid populating hidden fields with attacker-provided values. |
| `src/components/ClientModal` | Controlled by `Clients.tsx`; uses `prepareClientPayload` before RPC. | Creates/updates clients. | Shared Supabase client. | No built-in validation for max lengths; relies on `prepareClientPayload`. |

## Security Risks
- Client list runs fully in the browser, so any RLS bug leaks entire roster; consider server-proxy for admin users.
- Onboarding page trusts URL query strings; an attacker could craft a malicious link injecting script-like values that appear in confirmation modals.
- Deletion confirmation uses `window.confirm` without secondary checks; accidental double-clicks could remove clients without audit commentary. 
