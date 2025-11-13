# Therapist Onboarding Remediation – Execution Specs

## Objective
- Restore the therapist onboarding flow in staging so that document uploads succeed end-to-end.
- Provide clear signals for operations and automation to rerun onboarding and validate storage integrations.

## Key Tasks
- **Runtime-config remediation**: Ensure `/api/runtime-config` returns `defaultOrganizationId` (and any other required fields) for the SPA bootstrap.
- **Flow verification**: Repeat the onboarding process using the staging test account (`onboarding.cto+<ts>@example.com`) and confirm therapist record creation plus document uploads to `therapist-documents` bucket.
- **Automation coverage**: Implement Playwright smoke that walks the onboarding workflow and asserts storage + navigation success.

## Success Criteria
- Login page no longer throws `[Supabase] Failed to initialise client: Supabase runtime config missing defaultOrganizationId`.
- Manual onboarding run completes with success toast and files present in Supabase Storage (`therapist-documents/` path scoped to therapist ID).
- Playwright smoke script exits 0 and captures screenshot/log artifacts for regression tracking.

## Dependencies & Prerequisites
- Updated Supabase secret key set in `.env.local` (publishable + secret) – already exchanged 2025-11-13.
- Staging configuration owner (Platform) updates runtime-config API response.
- Test account credentials provisioned (scripted via `supabase-js` sign-up; see repo notes) before each run.
- Placeholder documents prepared in `artifacts/` (`onboarding-license.pdf`, `onboarding-resume.pdf`, `onboarding-background.pdf`).

## Validation Steps
1. Hit `https://app.allincompassing.ai/api/runtime-config` and confirm response includes `defaultOrganizationId`.
2. Login as the staging test therapist and complete onboarding, uploading all required documents. Capture screenshots + Supabase storage listing.
3. Run the Playwright smoke (future `npm run playwright:therapist-onboarding`) and store artifacts under `artifacts/playwright/`.
4. Document outcomes in project runbook; flag regressions through PagerDuty if runtime-config breaks again.

## Observability Hooks
- Supabase Storage logs for `therapist-documents` bucket (enable object access auditing for new uploads).
- Application console errors captured via MCP Playwright runner.
- Lighthouse audit (mobile + desktop) optional after UI changes.

## MCP Tooling Available
- **Supabase MCP**: Query project config, manage users, inspect storage.
- **MCP_DOCKER / Playwright**: Drive browser automation, capture screenshots, console logs, network traces.
- **MCP_DOCKER / Browser**: Manual navigation with snapshots for debugging.
- **Lighthouse MCP**: Performance/accessibility audits on staging URLs post-fix.
