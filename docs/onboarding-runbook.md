# Therapist Onboarding Remediation Runbook

## Overview
- **Objective**: Restore and guard the therapist onboarding flow (document uploads, storage writes, therapist creation).
- **Current status (2025-11-13)**:
  - Runtime config fallback shipped in code (`src/server/runtimeConfig.ts`) – pending deploy to staging.
  - Playwright smoke script prepared (`npm run playwright:therapist-onboarding`).
  - Runtime-config contract check available (`npm run contract:runtime-config`) – currently failing on staging due to missing `defaultOrganizationId`.
  - Manual onboarding flow still blocked on staging until runtime-config endpoint returns the default organization id.

## Step-by-step Playbook
1. **Validate Runtime Config**
   - Run `npm run contract:runtime-config`.
   - Success criteria: JSON payload includes `supabaseUrl`, `supabaseAnonKey`, `defaultOrganizationId`.
   - Artifacts:
     - `artifacts/runtime-config-before.json`
     - `artifacts/runtime-config-after.json`
     - Contract output logs (CI artifact recommended).

2. **Provision Test Account**
   - Command: use the `@supabase/supabase-js` signup helper (`scripts/account-create` snippet inside `playwright-therapist-onboarding.ts`).
   - Credentials stored under `artifacts/accounts/<timestamp>.json`.

3. **Manual Onboarding Verification** _(blocked until config fix)_  
   - Login at `https://app.allincompassing.ai/login`.
   - Complete all five steps of onboarding, upload placeholder docs from `artifacts/`.
   - Capture screenshots per step (`artifacts/manual/onboarding-step-*.png`) and export storage listing.
   - Flagged as **blocked** in this runbook because staging still omits `defaultOrganizationId`.

4. **Automated Smoke Test**
   - Command: `npm run playwright:therapist-onboarding`
   - Environment:
     - `PW_EMAIL` / `PW_PASSWORD` → admin credentials.
     - `PW_BASE_URL` → defaults to production staging URL.
   - Outputs:
     - Screenshots/JSON under `artifacts/latest/playwright-therapist-onboarding-<timestamp>.*`.
   - CI integration: `npm run ci:playwright` now chains auth, schedule-conflict, therapist onboarding smokes.

5. **Observability & Alerting**
   - Contract test `npm run contract:runtime-config` should run in CI and alert on missing config keys.
   - Recommend wiring Playwright smoke failure to Slack/PagerDuty (future action).

## Communication Aids
- Use `docs/tone.md` for stakeholder messaging templates.
- UI copy / style updates should follow `docs/style.md`.

## Outstanding Actions
- Deploy runtime-config patch so `/api/runtime-config` returns `defaultOrganizationId`.
- Re-run manual onboarding once fix is live.
- Extend Supabase storage verification (list objects under `therapist-documents/<therapist-id>/`) when manual flow succeeds.
- Hook contract + smoke runs into monitoring alerts.


