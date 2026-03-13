# Therapist Onboarding Status (2026-03-13)

## TL;DR
- Client onboarding prefill links are now tokenized and one-time; PHI/PII is no longer passed in query-string fields.
- `initiate-client-onboarding` is deployed with create/consume token flow, org-scoped role checks, and one-time consume semantics.
- Migration `20260313103000_client_onboarding_prefills.sql` is applied to project `wnnjeqheqxxyrgsjmygy` with RLS + explicit deny policies for direct client access.
- Route and wizard safeguards are in place: onboarding role route coverage added and therapist Enter-key early submit path is blocked.
- Prefill sanitizer now preserves `+` in email aliases (for example, `john+filter@example.com`) with regression test coverage.
- Migration `20260313120000_onboarding_authz_and_prefill_retention_hardening.sql` removes metadata-derived org authorization checks, adds trusted org resolution via DB records, and introduces server-side prefill cleanup (`app.cleanup_client_onboarding_prefills`).
- Migration `20260313123000_profiles_org_immutability_guard.sql` prevents non-super-admin profile updates from changing `organization_id`, `role`, or `is_active`, and restricts `app.resolve_user_organization_id` execution to service-role contexts.
- Migration `20260313124500_profiles_insert_authz_guard.sql` blocks self-service profile inserts from setting `organization_id` and other authz-sensitive fields.
- `ClientOnboarding` now runs in token-first mode (legacy plaintext query prefill ignored), strips query params immediately, and keeps token state in-memory so failed consume attempts can still be retried.
- Token create/consume responses now include `Cache-Control: no-store` headers.

## Next Actions
1. Wire `app.cleanup_client_onboarding_prefills` into a scheduled job (daily minimum) and alert on repeated cleanup failures.
2. Add an automated token-flow smoke (issue token -> consume once -> second consume returns `prefill_not_found`) to CI.
3. Keep Playwright onboarding smoke and route guards as merge gates for onboarding-related changes.
4. Continue Slack/PagerDuty integration improvements so onboarding regressions alert without manual log inspection.

Refer to `docs/tone.md` & `docs/style.md` for stakeholder comms/UI messaging guidance.


