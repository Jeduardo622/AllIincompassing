# Therapist Onboarding Status (2026-03-13)

## TL;DR
- Client onboarding prefill links are now tokenized and one-time; PHI/PII is no longer passed in query-string fields.
- `initiate-client-onboarding` is deployed with create/consume token flow, org-scoped role checks, and one-time consume semantics.
- Migration `20260313103000_client_onboarding_prefills.sql` is applied to project `wnnjeqheqxxyrgsjmygy` with RLS + explicit deny policies for direct client access.
- Route and wizard safeguards are in place: onboarding role route coverage added and therapist Enter-key early submit path is blocked.
- Prefill sanitizer now preserves `+` in email aliases (for example, `john+filter@example.com`) with regression test coverage.

## Next Actions
1. Add an automated token-flow smoke (issue token -> consume once -> second consume returns `prefill_not_found`) to CI.
2. Add scheduled cleanup for expired/consumed `client_onboarding_prefills` rows to control retention.
3. Keep Playwright onboarding smoke and route guards as merge gates for onboarding-related changes.
4. Continue Slack/PagerDuty integration improvements so onboarding regressions alert without manual log inspection.

Refer to `docs/tone.md` & `docs/style.md` for stakeholder comms/UI messaging guidance.


