# Super Admin UI Diagnostic

| Screen / Component | Auth Headers | Loading & Disabled States | Validation Coverage | Accessibility Notes | Additional Observations |
| --- | --- | --- | --- | --- | --- |
| `src/pages/SuperAdminImpersonation.tsx` | Calls `/super-admin/impersonate` via fetch with `Authorization` + anon `apikey` headers.【F:src/pages/SuperAdminImpersonation.tsx†L60-L130】 | Issue/revoke buttons disable during mutation; countdown updates every second. | Requires reason text but not minimum length; accepts either email or UUID. | Modal uses `Dialog` but lacks `aria-live` for countdown; toast messages accessible. | No audit history table; relies on edge function response. |
| `src/pages/SuperAdminFeatureFlags.tsx` | Uses Supabase client to invoke feature flag function with JWT + anon key.【F:src/pages/SuperAdminFeatureFlags.tsx†L70-L140】 | Loading spinner shown on initial fetch; toggle switches disable while saving. | Validates slug pattern client-side; metadata JSON not schema-checked. | Toggle switches accessible with keyboard but lack `aria-describedby` for description text. | Plan assignment form allows empty plan notes; no autosave indicator. |
| `src/components/super-admin/OrgSwitcher.tsx` | Reads organizations via Supabase query; same headers.【F:src/components/super-admin/OrgSwitcher.tsx†L40-L110】 | Dropdown shows loading indicator; disable states for options missing. | No validation beyond ensuring selection exists. | Lacks screen reader announcement when organization context changes. | Should persist last selection to local storage. |

## Security Risks
- Impersonation UI permits issuing tokens without justifying reason beyond free text; no integration with approval workflow.
- Feature flag editor allows arbitrary metadata injection which later flows into edge functions.
- Organization switcher changes context without explicit confirmation, increasing risk of cross-tenant edits when mis-clicked.
