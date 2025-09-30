# Admins UI Diagnostic

| Screen / Component | Data Sources | Mutations | Header Expectations | Notes |
| --- | --- | --- | --- | --- |
| `src/pages/Dashboard.tsx` | `useDashboardData` hook hitting `/functions/v1/get-dashboard-data`; fallback loaders call local stubs. | None; read-only metrics. | Supabase session token (auth hook ensures). | Falls back to redacted metrics when API fails; ensures some UI even without network. |
| `src/pages/Reports.tsx` | Combines `useDropdownData`, `useSessionMetrics`, and direct `supabase` queries for fallback generation. | Calls `/functions/v1/generate-report` via `supabase.functions.invoke` (see implementation). | Requires Bearer token auto-injected by Supabase client. | Generates CSV downloads; front-end caches filters in state without server confirmation. |
| `src/pages/MonitoringDashboard.tsx` | Aggregates `useDashboardData` plus additional health checks (API latencies). | None. | Auth context ensures `Authorization` header. | Displays service degradation banners when metrics older than threshold. |
| `src/pages/Settings.tsx` | Uses `supabase.from('profiles')` and `supabase.functions.invoke('admin-users')` for user management sections. | Updates profile preferences, toggles feature flags. | Supabase session token; some sections expect service role to succeed. | Settings includes feature flag toggles stored in `profiles.preferences`; no schema validation in UI. |

## Security Risks
- Reports page logs errors via `logger`; ensure log sink redacts emails/IDs before shipping to analytics.
- Dashboard fallback data may expose stale counts from previous sessions when running offline, confusing admins about current state.
- Settings toggles write directly to `profiles.preferences`; inconsistent schemas between admin edits can break downstream parsing. 
