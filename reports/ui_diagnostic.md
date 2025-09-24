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
- Build artifacts: Vite bundles present (`dist/index.html` references `assets/index-*.js` + code-split chunks for maps/supabase/vendor/dates/reports). Code-splitting in place.
- Quick win: Confirmed code-splitting is active; recommend lazy-loading heavy dashboards if bundle size flagged. Preload strategy to be added in a follow-up PR if needed.
- Request waterfalls: Batched schedule query hooks in `src/lib/optimizedQueries.ts` reduce N+1.

#### Recording Screen
- No dedicated `Recording` page found. Recording/transcripts are handled via Edge functions and backend; UI surfaces documentation dashboard and not explicit recording UI.


