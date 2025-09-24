1. Tighten a11y on scheduling modal icon buttons (add aria-label/title; ensure focus trap) — UX
2. Add UI confirmation display of derived CPT/modifiers on booking review — Revenue
3. Provide optional CPT/modifier overrides in UI with validation against catalog — Revenue
4. Create safe insert RPC for session + billing to avoid service-role write path — Security/PHI
5. Verify and harden RLS on logging/performance tables (ensure no PHI exposure) — Security/PHI
6. Add retry/backoff for `/api/runtime-config` fetch during app boot — UX
7. Preload critical route chunks and defer non-critical bundles — Performance
8. Expand react-query caching windows for schedule/dashboard with background revalidate — Performance
9. Add idempotency guidance and duplicate-submit guards to form buttons — Data loss
10. Add tests for org-scoped access across PHI tables (clients/sessions/billing) — Security/PHI


