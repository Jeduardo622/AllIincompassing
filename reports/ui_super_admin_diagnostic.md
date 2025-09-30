# Super Admin UI Diagnostic

| Screen / Component | Data Sources | Mutations | Header Expectations | Notes |
| --- | --- | --- | --- | --- |
| `src/components/settings/AdminSettings.tsx` | Uses `supabase.rpc('get_admin_users')` and `supabase.auth` admin APIs. | Invokes `assign_admin_role` RPC, resets passwords, deletes admins. | Requires authenticated session with super admin privileges; Supabase JS automatically attaches JWT. | Component assumes caller has organizationId metadata; super admins editing other tenants must manually switch context. |
| `src/components/settings/UserSettings.tsx` | Reads `profiles` row for current user; updates preferences/time zone. | Uses `.update` on `profiles`. | Requires `Authorization` header; depends on `useAuth`. | Exposes toggles for feature flags consumed by AI automation features. |
| `src/pages/Settings.tsx` (Admin tab) | Container for admin management modals. | Spawns `AdminSettings` modals for invites, resets. | Same as above. | Super admins can invite cross-tenant admins by editing `organization_id` field in modal (not locked). |
| `src/pages/Documentation.tsx` | Links to AI/automation playbooks. | None. | None. | Serves as reference for super admin-only AI workflows triggered via `/ai/agent/optimized`. |

## Security Risks
- Admin modal collects plaintext passwords for invites; ensure forms enforce minimum complexity and do not log credentials.
- Organization context defaults to caller’s metadata; super admins adjusting other tenants could accidentally mutate their own org if they forget to override.
- Reset password flow likely calls service role endpoints; ensure audit logs capture actor/target relationships for compliance. 
