# Therapist Onboarding Status (2025-12-01)

## TL;DR
- `/api/runtime-config` now returns `defaultOrganizationId` everywhere; `npm run contract:runtime-config` passes locally and in CI.
- Playwright smoke (`npm run playwright:therapist-onboarding`) is active in `npm run ci:playwright` and stores artifacts under `artifacts/latest/`.
- Manual onboarding succeeded using `therapist.onboarding+latest@example.com`; storage uploads appear under `therapist-documents/<therapist-id>/`.
- Outstanding: route contract/smoke failures to Slack/PagerDuty so regressions are visible without manual log reviews.

## Next Actions
1. Keep the runtime-config contract wired into CI (stop-ship if a key disappears).
2. Forward Playwright smoke failures to Slack/PagerDuty (owners: platform + QA).
3. Extend storage verification automation (list uploaded objects, confirm access rules).
4. Periodically recycle the staged therapist account via the Playwright script to ensure doc uploads continue to work.

Refer to `docs/tone.md` & `docs/style.md` for stakeholder comms/UI messaging guidance.


