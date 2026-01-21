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

## Communication Aids
- Use `docs/tone.md` for stakeholder messaging templates.
- UI copy / style updates should follow `docs/style.md`.

## Outstanding Actions
- Keep the runtime-config contract wired into CI and add PagerDuty notifications if needed.
  - **PagerDuty integration**: If configured, route SEV1 alerts (production onboarding failures) to PagerDuty. For SEV2/SEV3, Slack alerts are sufficient.
- Extend Supabase storage verification (list objects under `therapist-documents/<therapist-id>/`) in CI after Playwright runs.
- **Alerting gaps addressed**: Slack alerting is now documented. PagerDuty integration remains optional and should be configured separately if needed for on-call escalation.


