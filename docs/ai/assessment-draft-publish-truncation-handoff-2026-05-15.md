# Assessment Draft / Publish Truncation Handoff

Issue: `WIN-148`
Branch: `codex/fix-assessment-program-goal-truncation`
Route-task: `classification=high-risk human-reviewed`, `lane=critical`

## Scope

- Removed artificial `20` child / `6` parent goal gates from:
  - deterministic/manual draft creation
  - draft promotion to live Programs/Goals
  - Programs/Goals UI readiness and disabled-state messaging
- Removed AI generation schema/prompt caps that truncated larger extracted sets.
- Updated the assessment upload/promote Playwright smoke harness to expect an above-cap synthetic fixture.
- Added regression coverage for:
  - smaller valid draft/promotion sets
  - deterministic persistence of more than `20` goals / more than `6` programs
  - AI parser acceptance of above-cap outputs

## Non-goals

- No auth, routing, or session-flow behavior changes.
- No schema, RLS, grants, RPC exposure, or migration changes.
- No deploy or Netlify config changes.

## Verification

- Passed:
  - `npx vitest run src/server/__tests__/assessmentDraftsHandler.test.ts src/server/__tests__/assessmentPromoteHandler.test.ts src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - `deno test --node-modules-dir=auto --allow-env supabase/functions/generate-program-goals/index.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
- Blocked / failed outside this slice:
  - `npm run test:ci`
    - unrelated timeout in `tests/vitest.env-isolation.test.ts`
    - unrelated timeout in `tests/edge/initiate-client-onboarding.utils.test.ts`
    - one Vitest worker timeout surfaced during the same full-suite run
  - `npm run playwright:assessment-upload-promote-smoke`
    - blocked locally because `PW_ASSESSMENT_CLIENT_ID` is not configured

## Residual Risk

- The targeted workflow code is covered, but the full repo test suite is not green because of unrelated timeouts.
- The dedicated live upload/promote smoke could not be executed locally without the required smoke-client env binding.
