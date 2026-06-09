# IEHP Live Program Goals Repair Handoff

- Linear issue: `WIN-173`
- Assessment document: `4f1cad9b-ba5e-4ba4-8898-f5b25048e2d7`
- Route-task classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `src/server/api/assessment-promote.ts`, tenant-scoped production `programs` and `goals` repair

## Scope

Fix the IEHP publish path so approved IEHP structured goal sections create active, session-visible `programs` and `goals`.

Repair only the already-approved June 8, 2026 IEHP document above after proving it had approved goal sections but zero live session rows.

## Tenant Boundary

All repair rows are constrained to the assessment document's `organization_id` and `client_id`.

The repair does not change schema, RLS, grants, RPC exposure, secrets, or cross-tenant access rules.

## Live Repair Evidence

Before repair:

- document status: `approved`
- template type: `iehp_fba`
- approved IEHP goal-section candidates: `31`
- invalid candidate count: `0`
- live programs for document client/org: `0`
- live goals for document client/org: `0`
- latest publish payload: `completion_mode = assessment_only`

Repair guardrails:

- abort unless the document is `approved` and `iehp_fba`
- abort unless candidates are exactly `31`
- abort unless distinct program names are exactly `31`
- abort unless invalid candidate count is `0`
- abort unless existing live program and goal counts are both `0`

After repair:

- active programs for document client/org: `31`
- active goals for document client/org: `31`
- repair audit event: `reviewed_assessment_live_repair`
- repair payload: `completion_mode = live_program_goals`, `created_program_count = 31`, `created_goal_count = 31`

## Verification

- `npx vitest run src/server/__tests__/assessmentPromoteHandler.test.ts --reporter=verbose -t "promotes approved IEHP structured goals"`: pass
- `npx vitest run src/server/__tests__/assessmentPromoteHandler.test.ts --reporter=verbose`: pass, `25/25`
- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run build`: pass
- `npm run ci:check-focused`: pass
- `npm run validate:tenant`: pass
- `git diff --check`: pass, CRLF warnings only
- `npm run test:ci`: timed out locally after about 302 seconds with unrelated existing test noise visible

## Residual Risk

This is a critical protected-path change and production data repair. Human review is still required before merging the publish-path code.

The production document is now live for sessions, but the original publish event remains historically accurate as `assessment_only`; the later repair event records the live row creation.
