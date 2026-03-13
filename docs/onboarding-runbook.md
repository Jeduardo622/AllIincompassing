# Therapist Onboarding Runbook

## Overview
- **Objective**: Keep the therapist onboarding flow (runtime config, contract tests, document uploads, Supabase storage writes) healthy across environments.
- **Current status (2025-12-01)**:
  - `/api/runtime-config` now returns `supabaseUrl`, `supabaseAnonKey`, and `defaultOrganizationId` in every environment (`npm run contract:runtime-config` passes).
  - The Playwright smoke (`npm run playwright:therapist-onboarding`) provisions placeholder therapists end-to-end and stores evidence under `artifacts/latest/`.
  - Manual onboarding is unblocked; uploads land in `storage/therapist-documents/<therapist-id>/`.
  - Outstanding work: wire contract + smoke failures into Slack/PagerDuty alerts so regressions surface immediately.

## Step-by-step Playbook
1. **Validate Runtime Config**
   - Run `npm run contract:runtime-config`.
   - Success criteria: JSON payload includes `supabaseUrl`, `supabaseAnonKey`, `defaultOrganizationId`.
   - Artifacts:
     - `artifacts/runtime-config-before.json`
     - `artifacts/runtime-config-after.json`
     - Contract output logs (CI artifact recommended).

2. **Provision Test Account**
   - Recommended path: run the Playwright script once with `HEADLESS=false` to seed artifacts and confirm UI copy:  
     ```bash
     PW_EMAIL=admin@example.com PW_PASSWORD=**** npm run playwright:therapist-onboarding
     ```
   - The script auto-generates deterministic therapist emails (`therapist.onboarding+<timestamp>@example.com`) and writes metadata to `artifacts/latest/playwright-therapist-onboarding-*.json`. Use those credentials if you need to inspect Supabase rows manually.

3. **Manual Onboarding Verification**
   - Login at `https://app.allincompassing.ai/login` using an admin account.
   - Complete all five onboarding steps, reusing the placeholder docs created by the Playwright script (`artifacts/onboarding-*.pdf`).
   - Capture screenshots per step (`artifacts/manual/onboarding-step-*.png`) and run a storage listing to confirm the objects landed under `therapist-documents/<therapist-id>/`.

4. **Automated Smoke Test**
   - Command: `npm run playwright:therapist-onboarding`
   - Environment:
     - `PW_EMAIL` / `PW_PASSWORD` → admin credentials.
     - `PW_BASE_URL` → defaults to `https://app.allincompassing.ai` but can be overridden per environment.
   - Outputs:
     - Screenshots/JSON under `artifacts/latest/playwright-therapist-onboarding-<timestamp>.*`.
   - CI integration: `npm run ci:playwright` chains auth, schedule-conflict, and therapist-onboarding smokes; failures should block the deploy.

   - **Credential recovery for smoke accounts (if auth smoke fails with `Invalid email or password`)**:
     - Verify `.env.codex` values for:
       - `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD`
       - `PW_SUPERADMIN_EMAIL` / `PW_SUPERADMIN_PASSWORD`
       - `PW_THERAPIST_EMAIL` / `PW_THERAPIST_PASSWORD`
     - Validate login directly against Supabase Auth (`/auth/v1/token?grant_type=password`) using the current publishable key.
     - If admin/superadmin credentials drift, reset the affected `auth.users.encrypted_password` values and re-run `npm run playwright:auth`.

5. **Observability & Alerting**
   - `npm run contract:runtime-config` already runs in CI; treat any missing key as a stop-ship.
   - **Automatic alerting** (recommended for CI):
     Add to CI workflow after Playwright smoke tests:
     ```yaml
     - name: Alert on onboarding smoke failure
       if: failure()
       env:
         SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
       run: |
         npm run alert:slack -- \
           --title "Therapist onboarding smoke test failed" \
           --text "Playwright therapist onboarding smoke test failed. Check artifacts: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
           --severity medium \
           --source "ci:playwright:therapist-onboarding" \
           --runbook docs/onboarding-runbook.md
     ```
   - **Manual alerting**:
     ```bash
     npm run alert:slack -- \
       --title "Therapist onboarding failure" \
       --text "<description of failure>" \
       --severity medium \
       --source "therapist-onboarding" \
       --runbook docs/onboarding-runbook.md
     ```
   - See `docs/OBSERVABILITY_RUNBOOK.md` for severity mapping (onboarding failures typically map to SEV2/`medium`).

6. **Storage-vs-Manifest Reconciliation**
   - Run a dry-run report:
     ```bash
     npm run reconcile:therapist-docs
     ```
   - Run controlled apply mode (bounded to one action for first rollout):
     ```bash
     npm run reconcile:therapist-docs -- --apply --fix-storage --max-actions 1
     ```
   - Reports are written to `.reports/therapist-docs-reconcile-*.json` and include:
     - `orphanStorageCount`
     - `orphanManifestCount`
     - sample paths for both classes
     - apply-mode action results and blocked operations
   - Current safety behavior:
     - `manifest` cleanup can be applied directly.
     - `storage` cleanup requires Storage API credentials; if unavailable, the report records `storageApplyError` and leaves objects untouched.

7. **Recurring Schedule (Operations)**
   - Scheduler target command:
     ```bash
     npm run reconcile:therapist-docs:scheduled
     ```
   - Recommended cadence:
     - Every 6 hours in production
     - Daily in non-production
   - Recommended scheduler wiring:
     - External cron runner or CI scheduled job executes the command above.
     - Treat non-zero exit (`--fail-on-orphans`) as an alert condition and attach the newest `.reports/therapist-docs-reconcile-*.json`.

8. **Alert Thresholds for Reconciliation**
   - `SEV3` (`low`): `orphanManifestCount > 0` and `<= 5`
   - `SEV2` (`medium`): `orphanStorageCount > 0` and `<= 5`, or repeated blocked cleanup (`storageApplyError`) for 2+ consecutive runs
   - `SEV1` (`high`): `orphanStorageCount > 5`, or trend growth for 3 consecutive scheduled runs
   - Alert payload should include:
     - environment
     - report path
     - counts
     - top sample paths
     - last successful apply timestamp

9. **Netlify + Supabase Key Drift Troubleshooting**
   - Symptom: `/api/runtime-config` returns legacy JWT anon key (`eyJ...`) and login fails with `Legacy API keys are disabled` or `Unregistered API key`.
   - Required state:
     - Runtime config must expose a publishable key (`sb_publishable_...`).
     - Production auth smoke (`npm run playwright:auth`) must pass.
   - Resolution checklist:
     - Confirm Netlify production deploy includes latest `runtime-config` function changes.
     - Set `SUPABASE_PUBLISHABLE_KEY` in Netlify env vars for production context.
     - Redeploy and verify `GET /api/runtime-config` is now publishable.
     - Re-run auth smoke.
   - If deploy fails during config parse with extension fetch `504`, retry deploy (transient platform issue).

## Communication Aids
- Use `docs/tone.md` for stakeholder messaging templates.
- UI copy / style updates should follow `docs/style.md`.

## Outstanding Actions
- Keep the runtime-config contract wired into CI and add PagerDuty notifications if needed.
  - **PagerDuty integration**: If configured, route SEV1 alerts (production onboarding failures) to PagerDuty. For SEV2/SEV3, Slack alerts are sufficient.
- Extend Supabase storage verification (list objects under `therapist-documents/<therapist-id>/`) in CI after Playwright runs.
- **Alerting gaps addressed**: Slack alerting is now documented. PagerDuty integration remains optional and should be configured separately if needed for on-call escalation.


## 2026-03-13 Onboarding Hardening Updates

- **Client onboarding prefill flow moved to one-time tokens**
  - `initiate-client-onboarding` now issues `/clients/new?prefill_token=<uuid>` instead of embedding client details in URL params.
  - Prefill payload is stored server-side in `public.client_onboarding_prefills` and consumed once.
  - Token consume path enforces org scope and role checks, then atomically marks token as consumed.

- **New migration and storage contract**
  - Added migration `supabase/migrations/20260313103000_client_onboarding_prefills.sql`.
  - Table includes expiry and consume integrity checks (`expires_at > created_at`, `consumed_at >= created_at`), RLS enabled, and deny policies for direct `anon`/`authenticated` access.
  - Indexed for active-token lookups by org and expiry.

- **Frontend onboarding route hardening**
  - `ChatBot` now calls the edge function to generate onboarding links and opens links with `noopener,noreferrer`.
  - `ClientOnboarding` consumes `prefill_token` from backend, hydrates form values from secure payload, and strips query params from browser history via `replace`.
  - `TherapistOnboarding` now uses guarded wizard submission so Enter cannot bypass steps and trigger early submit.

- **Validation and regression safety**
  - Email uniqueness check in `ClientOnboarding` now fails closed when lookup is unavailable.
  - Added regression tests for onboarding route guard behavior, wizard Enter-key submit prevention, and token-hash helper determinism.
  - Fixed prefill sanitizer to preserve `+` in email aliases (for example, `john+filter@example.com`), with dedicated unit coverage.

## 2026-03-13 Re-Audit Remediation Follow-up

- **Tenant authorization hardening**
  - Added migration `supabase/migrations/20260313120000_onboarding_authz_and_prefill_retention_hardening.sql`.
  - Replaced metadata-derived org auth checks with trusted DB-backed org resolution (`app.resolve_user_organization_id`, `app.current_user_organization_id`, updated `app.user_has_role_for_org`).
  - Maintained guardian-aware client access branch while removing metadata fallbacks from org resolution.
  - Added follow-up migration `supabase/migrations/20260313123000_profiles_org_immutability_guard.sql` to block non-super-admin profile edits of `organization_id`, `role`, and `is_active`, and to restrict direct execution of `app.resolve_user_organization_id`.
  - Added migration `supabase/migrations/20260313124500_profiles_insert_authz_guard.sql` so self-service profile inserts cannot set tenant/privilege-bearing fields.

- **Token consume/create response hardening**
  - `initiate-client-onboarding` now adds no-store cache headers for token create/consume responses.
  - Added consume-path rate limiting and explicit role resolution guard (client role cannot consume tokenized prefill).

- **Client onboarding route hardening**
  - Client form prefill now defaults to token-only mode; legacy plaintext query prefill values are ignored.
  - URL query params are stripped immediately; token is retained in component state for retry if consume fails.
  - Added UI state for secure prefill loading/failure to improve operator visibility.

- **Retention controls**
  - Added `app.cleanup_client_onboarding_prefills(p_retention_days integer default 7)` for scheduled deletion of stale consumed/expired prefill rows.
  - Recommended ops cadence: run at least daily via scheduler/cron and alert on consecutive failures.

## 2026-03-13 Playwright MCP Production Verification

- Executed a live route verification in production via Playwright MCP (`https://app.allincompassing.ai`).
- Confirmed admin route access:
  - `/clients/new` renders the client onboarding wizard.
  - `/therapists/new` renders the therapist onboarding wizard.
- Confirmed super_admin route access:
  - `/clients/new` renders the client onboarding wizard.
  - `/therapists/new` renders the therapist onboarding wizard.
- Confirmed therapist route behavior:
  - `/clients/new` is allowed and renders the client onboarding wizard.
  - `/therapists/new` is blocked and redirects to `/unauthorized` with an `Access Denied` screen.
- Confirmed unauthenticated guard behavior:
  - direct visit to `/clients/new` redirects to `/login`.
  - direct visit to `/therapists/new` redirects to `/login`.
- Captured evidence artifacts:
  - `onboarding-admin-clients-new-verified-all-routes.png`
  - `onboarding-admin-therapists-new-verified-all-routes.png`
  - `onboarding-superadmin-clients-new-verified.png`
  - `onboarding-superadmin-therapists-new-verified.png`
  - `onboarding-therapist-clients-new-allowed.png`
  - `onboarding-therapist-therapists-new-blocked.png`
  - `onboarding-unauthenticated-clients-new-redirect-2.png`
  - `onboarding-unauthenticated-therapists-new-redirect.png`
