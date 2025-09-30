# Admins UI Diagnostic

| Screen / Component | Auth Headers | Loading & Disabled States | Validation Coverage | Accessibility Notes | Additional Observations |
| --- | --- | --- | --- | --- | --- |
| `src/pages/Settings.tsx` (Admin tab) | Supabase client with anon key + JWT; fetches admin list via `/admin/users` function.【F:src/pages/Settings.tsx†L40-L120】 | Displays spinner while fetching but action toggles remain interactive; invite button disables during API call. | Invite form validates email but not organization ID; relies on backend. | Tabbed interface uses `role="tablist"` but lacks keyboard arrow support. | Pagination handled client-side; large orgs may freeze UI. |
| `src/components/settings/AdminSettings.tsx` | Uses `supabase.rpc('get_admin_users')`; same headers.【F:src/components/settings/AdminSettings.tsx†L70-L140】 | Table shows skeleton; disable states handled by `isSubmitting`. | Validates role selection but not simultaneous toggles; no double-submit guard. | Table cells accessible but lacks `scope="col"` for headers. | Search input triggers fetch on each change without debounce. |
| `src/components/settings/AdminInviteModal.tsx` | Inherits Supabase session for invites.【F:src/components/settings/AdminInviteModal.tsx†L40-L110】 | Submit button disables and shows spinner; background overlay prevents interaction. | Uses Zod schema for email/expiration but allows optional org ID; no preflight to confirm membership. | Input labels present; error text announced but modal lacks `aria-describedby`. | Need to auto-focus on first invalid field. |

## Security Risks
- Client stores service-role responses in memory; ensure responses omit invitation token hashes.
- Search UI pulls entire admin list before filtering, magnifying risk of data leakage if RPC misconfigured.
- Invite modal accepts arbitrary organization ID, enabling super admins to invite into other tenants without audit reason capture.
