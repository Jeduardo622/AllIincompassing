### UI Diagnostic

#### Auth & Org Scoping
- Auth provider: `src/lib/authContext.tsx` using `supabase.auth.*` with auto refresh and persistent sessions. Tokens stored via Supabase-js; no custom storage.
- Requests: Client uses `supabase` (anon key) and `callEdge` sets `Authorization: Bearer <user JWT>` automatically; correct for user-scoped operations.
- Org flow: Server/db policies infer organization via triggers and helper functions; UI doesn’t manually pass org_id (OK).
- Risk: Ensure runtime-config endpoint serves the anon URL/key (`src/server/api/runtime-config.ts`) before app loads; it does via `src/lib/runtimeConfig.ts` fetch.

#### Scheduling & Billing Screens
- Scheduling page: `src/pages/Schedule.tsx`. Booking payload POSTs to `/api/book` with Bearer token and Idempotency-Key; derives CPT server-side after confirmation and persists modifiers via service-role server function.
- Form validation: `react-hook-form` with required fields, visible error messages. Loading/disabled states present on submit buttons.
- Concurrency: Idempotency keys used for Edge holds/confirm; `/api/book` also supports Idempotency-Key header propagation.
- CPT/modifiers in UI payload: UI does not send CPT fields; CPT is derived and persisted server-side. This matches current model.

#### Accessibility (Updated)
- Form components use `label`/`aria-*`; inputs have `aria-invalid`, `role="alert"` for errors (`src/components/forms/ValidatedInput.tsx`).
- Focus and keyboard: Buttons/inputs are native; visible focus via Tailwind focus classes.
- Changes applied:
  - Added `aria-label`/`title` to icon-only buttons in `src/pages/Schedule.tsx`.
  - Added `role="dialog" aria-modal="true"` to `src/components/SessionModal.tsx`.
  - Basic a11y tests in `tests/ui/a11y.spec.ts`.

#### Performance (Updated)
- Route loading: `src/App.tsx` already lazy-loads the top-level route shells and pages (`Login`, `Signup`, `Layout`, `Dashboard`, `Schedule`, `Clients`, `Therapists`, `MonitoringDashboard`, `Reports`, `Settings`, and related detail/onboarding pages) behind a shared `Suspense` fallback.
- Build artifacts: Vite bundles present (`dist/index.html` references `assets/index-*.js` plus multiple route/page chunks, including reports, dates, vendor, and Supabase bundles). Code-splitting is active in both source and build output.
- Quick win: confirmed route-level code-splitting is already doing the main performance work. The next candidate is not broad lazy-loading, but reviewing whether the heaviest already-lazy pages (`MonitoringDashboard`, `ClientDetails`, `Settings`, `Reports`) need chunk-size follow-up or targeted prefetching based on actual navigation patterns.
- Lighthouse evidence: `reports/lighthouse-after.json` is currently only a failed-run artifact (`CHROME_INTERSTITIAL_ERROR` to `chrome-error://chromewebdata/`), so it should not be treated as current paint-metric proof.
- Request waterfalls: Batched schedule query hooks in `src/lib/optimizedQueries.ts` reduce N+1.

#### Recording Screen
- No dedicated `Recording` page found. Recording/transcripts are handled via Edge functions and backend; UI surfaces documentation dashboard and not explicit recording UI.


