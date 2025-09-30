# Unified Domain Diagnostic

## Status Matrix

| Domain | Surface Coverage | AuthZ Confidence | Data Leakage Risk | Automation/AI Risk | Overall Status |
| --- | --- | --- | --- | --- | --- |
| Clients | Booking API, client detail function, onboarding, profile management | Medium – relies on `user_has_role_for_org` RPC and Supabase JWT | Medium – browser queries expose full roster if RLS weakens | Low – limited AI usage | 🟡 Needs Guardrails |
| Therapists | Schedule batch/optimized APIs, holds/confirm flows, dropdown data | Low – functions lack explicit org filters | High – schedule exports include PHI + authorization counts | Medium – booking automation depends on caller-supplied offsets | 🔴 Immediate Risk |
| Admins | User management, invites, dashboard/reporting | Medium – asserts admin role but trusts organization metadata | Medium – aggregated KPIs may reveal cross-tenant trends | Low – minimal AI use | 🟡 Needs Guardrails |
| Super Admin | Global role management, AI orchestration, cross-tenant assignments | Low – some endpoints unauthenticated (`process-message`) | High – multi-tenant exports + AI prompts can leak PHI | High – GPT integrations without redaction | 🔴 Immediate Risk |
| UI (Clients) | Roster, detail, onboarding | Medium | Medium | Low | 🟡 |
| UI (Therapists) | Schedule matrix, session modal, dropdowns | Low | High | Medium | 🔴 |
| UI (Admins) | Dashboard, Reports, Settings | Medium | Medium | Low | 🟡 |
| UI (Super Admin) | Admin management modals | Low | High | Medium | 🔴 |

## Fix-Now Top 10
1. Lock down `/supabase/functions/process-message` with the same `createProtectedRoute` guard or upstream routing to prevent anonymous OpenAI usage.
2. Add organization scoping to `get-schedule-data-batch`, `get-sessions-optimized`, and `get-dropdown-data` queries to stop cross-tenant session leakage.
3. Enforce role checks on `/sessions/cancel` and `/sessions/hold` to confirm the caller owns the target therapist/client relationship.
4. Harden `/initiate-client-onboarding` so only admins with matching `organization_id` can mint onboarding URLs.
5. Introduce server-side validation of `profiles.preferences` payloads to stop unbounded JSON writes from `/profiles/me` and Settings UI.
6. Implement pagination limits and server-side filtering inside `get_admin_users` RPC to avoid dumping entire tenant user lists to the browser.
7. Require signed, expiring URLs (or hashed tokens) when returning `admin-invite` links to reduce risk of invite interception.
8. Add audit + throttling around AI functions (`ai-agent-optimized`, `ai-session-note-generator`, `ai-transcription`) to monitor prompt content and prevent PHI over-share.
9. Move roster CRUD (`Clients.tsx`, `Therapists.tsx`) behind privileged edge functions so the browser no longer issues direct table writes with the anon key.
10. Ensure `assign-therapist-user` validates that the target user and therapist share the same organization via database constraints, not just metadata heuristics. 
