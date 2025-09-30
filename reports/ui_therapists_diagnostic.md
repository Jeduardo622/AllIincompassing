# Therapists UI Diagnostic

| Screen / Component | Auth Headers | Loading & Disabled States | Validation Coverage | Accessibility Notes | Additional Observations |
| --- | --- | --- | --- | --- | --- |
| `src/pages/Therapists.tsx` | Browser Supabase client with anon key + JWT; fetches `/therapists` table directly.【F:src/pages/Therapists.tsx†L70-L148】 | Table renders spinner but action buttons stay enabled; archive modal disables submit while RPC pending. | Uses `therapistSchema` for forms but lacks max caseload enforcement; relies on server to reject invalid specialties. | Filters implemented with buttons lacking `aria-pressed`; modals maintain focus via headless UI. | Large rosters cause slow client-side sorting; consider virtualization. |
| `src/pages/TherapistDetails.tsx` | Same Supabase session; fetch + schedule queries forwarded to edge functions.【F:src/pages/TherapistDetails.tsx†L40-L120】 | Shows loading states for tabs but nested schedule components fetch immediately causing jank. | Minimal validation for notes/time entries; relies on server errors. | Tabs implemented with buttons but missing `role="tablist"`; color-only indicators for availability. | No retry/backoff when edge functions return 429. |
| `src/components/AvailabilityEditor` | No direct fetch; controlled form inherits Supabase context.【F:src/components/AvailabilityEditor.tsx†L20-L96】 | Save button disables while parent mutation runs; day toggles remain interactive. | Validates time format but not overlapping ranges; timezone not enforced. | Checkbox/inputs labeled but slider controls not keyboard-accessible. | Should persist default timezone per therapist. |
| `src/components/AlternativeTimes` | Calls edge function suggestions via Supabase client.【F:src/components/AlternativeTimes.tsx†L40-L110】 | Displays loading spinner while suggestions load; disables confirm button. | Validates duration >0 but trusts start/end windows. | Modal lacks `aria-live` for suggestion updates. | Frequent recomputations without debounce when filters change. |

## Security Risks
- Schedule views surface PHI-laden data entirely client-side; rely on RLS/edge validations for scoping.
- Alternative time suggestions leak available slots; without server guard, cross-tenant enumeration possible.
- Archive actions operate via definer RPC; absence of audit UI prevents operators from reviewing changes.
