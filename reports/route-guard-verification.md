# Route Guard Verification – 2025-10-09

## Preview smoke availability
- `CI=1 npm run preview:build` succeeded, producing static preview assets and a baseline URL output. [Log chunk `9c31cc`]
- `CI=1 npm run preview:smoke` passed against the local preview server with Supabase stubs. [Log chunk `e179ff`]
- `CI=1 npm run preview:smoke -- --reporter=junit` re-ran the suite for artifact generation; all checks remained green. [Log chunk `d001ed`]
- Evidence: [`reports/evidence/preview-build-log.txt`](./evidence/preview-build-log.txt), [`reports/evidence/preview-smoke-log.txt`](./evidence/preview-smoke-log.txt), [`reports/evidence/preview-smoke-junit-log.txt`](./evidence/preview-smoke-junit-log.txt)

## Route guard enforcement tests
- `npm run test -- --runInBand --grep "route guard"` executes only the guard-related suites and passes. [Log chunk `0d89c3`]
- `npm run test:routes` (Cypress) runs against the preview build with stubbed Supabase data and finished green. [Log chunks `d75994`, `a59919`, `5de341`]
- `npm run audit:routes` (Playwright) now boots the preview server automatically and confirms all protected routes render without backend mismatches. [Log chunk `c90426`]
- Generated report: [`reports/evidence/route-audit-report-2025-10-09T20-01-26-211Z.json`](./evidence/route-audit-report-2025-10-09T20-01-26-211Z.json)
- Supabase policy review: [Supabase Dashboard – RLS overview (`wnnjeqheqxxyrgsjmygy`)](https://app.supabase.com/project/wnnjeqheqxxyrgsjmygy/editor)

## Monitoring baseline confirmation
- Preview runtime config (`/api/runtime-config`) and Supabase health checks return 200s with masked keys. [Log chunks `e179ff`, `d001ed`]
- Dashboard threshold review logged in [`reports/evidence/preview-monitoring-baseline.txt`](./evidence/preview-monitoring-baseline.txt)

## Follow-up actions
- Track preview pipeline in CI (`jobs.preview`) for remote environments and attach smoke reports to each run.
- When real Supabase credentials are restored, extend coverage with integration tests that validate live policy responses alongside stubs.
# Route Guard Verification – 2025-02-21

## Preview smoke availability
- `CI=1 npm run preview:build` succeeded, producing static preview assets and baseline URL output. [Log chunk `04a215`]
- `CI=1 npm run preview:smoke` passed against the local preview server with Supabase stubs. [Log chunk `5a4481`]
- `CI=1 npm run preview:smoke -- --reporter=junit` re-ran the suite for artifact generation; all checks remained green. [Log chunk `eab9d8`]

## Route guard enforcement tests
- `npm run test -- --runInBand --grep "route guard"` now executes only the guard-related suites and passes. [Log chunk `a73221`]
- New unit coverage: `src/server/routes/__tests__/guards.test.ts` validates guard matrices, role hierarchy, and Supabase policy alignment; `src/components/__tests__/RoleGuard.test.tsx` confirms UI redirection semantics.

## Blocked verification commands
- `npm run audit:routes` remains blocked because Playwright cannot launch Chromium in the container; missing system libraries prevent execution. [Log chunk `933d1b`]
- `npm run test:routes` fails due to the absence of the Xvfb display server required by Cypress. [Log chunk `e53fab`]

## Follow-up actions
- Provision a container image (or CI job) with Playwright system dependencies and Xvfb to clear the remaining Day-0 verification gates.
- Once the environment supports browser automation, re-run `npm run audit:routes` and `npm run test:routes`, capturing artifacts for the execution spec.
