# Clients UI Diagnostic

| Screen / Component | Auth Headers | Loading & Disabled States | Validation Coverage | Accessibility Notes | Additional Observations |
| --- | --- | --- | --- | --- | --- |
| `src/pages/Clients.tsx` | Uses browser Supabase client with anon key + user session; relies on auto-attached `Authorization` header.【F:src/pages/Clients.tsx†L64-L133】 | Table shows spinner but bulk actions remain clickable during mutations; archive/restore buttons rely on `window.confirm`. | Form uses `prepareClientPayload` but no max-length enforcement; RPC handles required fields. | Table rows lack explicit `aria` roles; modal focus trap handled by headless UI but no keyboard shortcuts for filters. | Client search/filter runs client-side; large rosters incur performance cost. |
| `src/pages/ClientDetails.tsx` | Supabase client fetch by ID with same headers.【F:src/pages/ClientDetails.tsx†L40-L88】 | Shows skeleton while fetching but nested tabs load synchronously causing jank. | Minimal validation; assumes server returns sanitized data. | Breadcrumb links accessible; detailed sections missing `aria-labelledby`. | Lacks retry/backoff when `get-client-details` returns 403 (archived). |
| `src/pages/ClientOnboardingPage.tsx` | Relies on browser session; no extra headers beyond Supabase defaults.【F:src/pages/ClientOnboardingPage.tsx†L30-L78】 | Submit button disables during RPC call but no progress indicator on slow network. | Validates presence of name/email client-side; trusts URL query params from onboarding function. | Input fields have labels but no error region for screen readers. | Query param injection can prefill hidden values; sanitize before render. |
| `src/components/ClientModal` | Reuses Supabase client from context; inherits headers.【F:src/components/ClientModal.tsx†L40-L96】 | Save button disables while mutation pending; close button still active. | Basic required-field checks; does not enforce phone/email formats. | Uses `Dialog` for focus trap but missing `aria-describedby` on helper text. | Consider debouncing search fields to reduce re-renders. |

## Security Risks
- Continued dependence on client-side Supabase queries means any RLS regression leaks the entire roster to authenticated users.
- Lack of server-side validation for query-string prefill allows an attacker to craft malicious onboarding links injecting arbitrary metadata.
- Archive/restore actions rely solely on window confirms without reason capture, limiting audit trails when soft delete is abused.
