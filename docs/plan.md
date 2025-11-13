# Onboarding Remediation Delivery Plan

## Workstream Overview
- **Goal**: Restore the therapist onboarding flow in staging and operationalize regression protection.
- **Stakeholders**: Platform (runtime-config), Product Eng (onboarding UI & automation), QA/RevOps (validation + sign-off).

## Task Breakdown & Owners
1. **Runtime-config patch** *(Platform)*
   - Update `/api/runtime-config` to include `defaultOrganizationId` (and keep anon key, Supabase URL, edge URL).
   - Smoke test API locally/staging before release.
2. **Manual onboarding verification** *(Product Eng + QA)*
   - Use fresh test account (`onboarding.cto+<ts>@example.com` / `TempPass!<ts>`) to complete onboarding.
   - Upload placeholder docs located in `artifacts/` and confirm therapist record + storage objects.
3. **Playwright smoke implementation** *(Product Eng)*
   - Add script `scripts/playwright-therapist-onboarding.ts` with CLI hook `npm run playwright:therapist-onboarding`.
   - Ensure script provisions account, completes flow, asserts success toast + storage upload, and saves artifacts.
4. **Automation wiring + reporting** *(Product Eng + CI)*
   - Integrate new smoke into `npm run ci:playwright` (optional gating) and publish artifacts to `artifacts/playwright/`.
   - Update runbook with rerun steps and alert thresholds.

## Timeline & Checkpoints
- **Day 0 (Now)**: Runtime-config fix deployed; confirm error cleared.
- **Day 0 + 2h**: Manual onboarding verification complete with evidence (screenshots, storage listing).
- **Day 0 + 1 day**: Playwright smoke ready, running locally and in CI.
- **Day 0 + 2 days**: Documentation updated, Lighthouse spot-check (optional) if UI touched.

## Risks & Mitigations
- **Config regression**: Add contract test hitting `/api/runtime-config`; use Supabase MCP monitor to validate post-deploy.
- **Storage permission issues**: Ensure service role key remains rotated; add Supabase policy checks in Playwright run (API call).
- **Auth rate limits**: Throttle test account creation; reuse sign-up script with timestamp suffix.

## Evidence & Sign-off Checklist
- API response screenshot / curl output with `defaultOrganizationId` present.
- Manual run artifact bundle (screenshots + storage object list).
- Playwright smoke logs + screenshot attached to CI job.
- Tone/style guidance acknowledged by design/CS if UI messaging changes.

## MCP Tooling Reference
- Supabase MCP for config validation, user provisioning, storage inspection.
- MCP_DOCKER browser & Playwright for manual/automated runs.
- Lighthouse MCP for post-change audits (optional but recommended).

| Tool | Primary Use | Example Invocation |
| --- | --- | --- |
| Supabase MCP | Fetch runtime config, manage users, inspect storage buckets | `supabase api get https://app.allincompassing.ai/api/runtime-config` (via MCP) |
| MCP_DOCKER · Browser | Manual navigation, snapshots, console logs | `browser_navigate url=https://app.allincompassing.ai/login` |
| MCP_DOCKER · Playwright | Scripted smoke runs, artifact capture | `browser_take_screenshot filename=artifacts/onboarding.png` |
| Lighthouse MCP | Perf/Accessibility regression check | `run_audit url=https://app.allincompassing.ai/login device=mobile` |
| Docker MCP Gateway | Containerized diagnostics (if needed) | `docker exec`-style commands exposed via gateway |
