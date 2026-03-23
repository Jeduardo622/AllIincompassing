---
name: verify-change
description: Select, run, and report mandatory verification for implementation changes using lane-based hard gates in this repository.
---
# Verify Change

## Description

Use this skill after any implementation change to select mandatory verification and report what was actually validated.
For non-trivial code/config work, this is a hard gate: no completion without the verification card.

## When to use

- Any non-doc code or config change
- Any change where verification scope is not obvious
- Always for auth, routing, runtime config, server/API, database, tenant-isolation, CI, or workflow changes

## Inputs

- The task summary
- Changed files
- `route-task` output (`classification` + `lane`)
- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/verification-matrix.md`

## Steps

1. Read `AGENTS.md`, `docs/ai/cto-lane-contract.md`, and `docs/ai/verification-matrix.md`.
2. Confirm `route-task` output exists and includes:
   - `classification`
   - `lane`
3. If lane is missing or ambiguous, stop and mark verification as blocked.
4. Map the change to one or more change types:
   - UI/component/page
   - auth/routing/runtime config
   - server/API/edge integration
   - database/RLS/migrations/tenant isolation
   - CI/workflow/policy
   - docs/process only
5. Choose the union of required checks for all matching change types and lane rules.
6. Use the repo's real commands:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run test:ci`
   - `npm run test:routes:tier0`
   - `npm run ci:playwright`
   - `npm run validate:tenant`
   - `npm run build`
   - `npm run ci:check-focused`
   - `npm run verify:local`
7. Run the smallest required set that satisfies lane and change-type obligations.
8. If browser/auth checks are required, include:
   - `npm run test:routes:tier0`
   - `npm run ci:playwright`
9. If tenant boundaries, RLS, grants, RPC exposure, migrations, or tenant-scoped writes are affected, include:
   - `npm run validate:tenant`
10. If the change touches `.github/workflows/**`, `scripts/ci/**`, Husky hooks, or verification policy docs, validate the affected workflow/script directly in addition to standard commands.
11. When required checks do not need protected systems/secrets, include `npm run verify:local`.
12. If a required check cannot run because secrets/services/environment are missing, keep it in required checks and record a blocked reason.
13. Before finalizing any non-trivial change, use `reviewer`. Prioritize auth, org-scope, API-boundary, CI-policy, and security regressions.
14. Produce the verification card in the required output format below.

## Hard Gate Rules

- Do not mark verification complete when:
  - required checks are missing and not explicitly blocked
  - lane is missing/ambiguous
  - command outcomes are not reported
- Do not collapse blocked checks into pass status.
- For non-trivial code/config work, missing verification card means task is not done.

## Required Verification Card

- `classification`: from `route-task`
- `lane`: `fast` | `standard` | `critical` | `blocked`
- `change type`: one or more categories
- `required checks`: exact command list
- `executed checks`: command -> pass/fail
- `blocked checks`: command -> reason (or `none`)
- `result`: pass | pass-with-blocked-checks | fail
- `residual risk`: short statement

## Output format

- Classification
- Lane
- Change type
- Required checks
- Executed checks
- Blocked checks
- Result
- Residual risk
