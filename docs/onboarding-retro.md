# Therapist Onboarding Remediation – Retrospective Notes

## What Worked
- Quick identification of runtime-config gap with MCP browser + console logs.
- Supabase PAT refresh allowed scripted account provisioning without dashboard access.
- Playwright smoke design mirrors manual flow with reusable artifact handling.

## Gaps / Follow-ups
- **Staging config drift**: Add automated deploy hook to verify `/api/runtime-config` before promoting changes.
- **Document storage validation**: Enhance smoke script to call Supabase Storage REST (requires secure service key injection).
- **Alerting & visibility**: Contract test currently manual; integrate into CI and send Slack/PagerDuty alerts on failure.
- **Local dev ergonomics**: `npm run dev` background workflow is clunky on Windows (investigate cross-platform runner).

## Action Items
1. Platform: rotate staging secrets and ensure `DEFAULT_ORGANIZATION_ID` set post-deploy.
2. Product Eng: extend Playwright smoke with Supabase Storage verification once service role access is available.
3. DevOps: wire `npm run contract:runtime-config` + `npm run ci:playwright` into nightly job with alerting.
4. DX: document Windows-friendly approach for long-running dev servers (PowerShell job wrapper or npm script).

Track these in Jira/Linear and close the mission after smoke passes on two consecutive runs.


