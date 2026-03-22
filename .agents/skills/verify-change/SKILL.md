---
name: verify-change
description: Select and report the minimum required verification for implementation changes in this repository. Use after non-trivial code or config changes, especially for auth, routing, server/API, database, tenant-isolation, or CI work.
---
# Verify Change

## Description

Use this skill after any implementation change to select the minimum required verification for this repository and report what was actually validated.

## When to use

- Any non-doc code or config change
- Any change where verification scope is not obvious
- Always for auth, routing, runtime config, server/API, database, tenant-isolation, CI, or workflow changes

## Inputs

- The task summary
- Changed files
- `AGENTS.md`
- `docs/ai/verification-matrix.md`

## Steps

1. Read AGENTS.md and docs/ai/verification-matrix.md.
2. Map the change to one or more change types:
   - UI/component/page
   - auth/routing/runtime config
   - server/API/edge integration
   - database/RLS/migrations/tenant isolation
   - CI/workflow/policy
   - docs/process only
3. Choose the union of the required checks for all matching change types.
4. Use the repo's real commands:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run test:ci`
   - `npm run test:routes:tier0`
   - `npm run ci:playwright`
   - `npm run validate:tenant`
   - `npm run build`
   - `npm run ci:check-focused`
5. Run the smallest required set that is possible in the current environment.
6. If browser/auth checks are required, include:
   - `npm run test:routes:tier0`
   - `npm run ci:playwright`
7. If tenant boundaries, RLS, grants, RPC exposure, migrations, or tenant-scoped writes are affected, include:
   - `npm run validate:tenant`
8. If the change touches `.github/workflows/**`, `scripts/ci/**`, Husky hooks, or verification policy docs, validate the affected workflow or script directly in addition to the standard commands.
9. If a required check cannot run because secrets, services, or environment are missing, say so explicitly and leave the check in the required list.
10. Before finalizing any non-trivial change, use `reviewer`. Prioritize auth, org-scope, API-boundary, CI-policy, and security regressions.
11. Summarize:
    - change type
    - required checks
    - checks executed
    - pass/fail status
    - blocked checks
    - residual risk

## Output format

- Change type
- Required verification
- Executed verification
- Blocked verification
- Result
- Residual risk
