# Verification Matrix

Use the minimum sufficient verification set that matches the full bounded change. Do not split implementation solely to avoid appropriate verification for a safely bounded end-to-end slice. If a change spans multiple categories, run the union of those checks.
For lane routing and hard-gate rules, see `docs/ai/cto-lane-contract.md`.

## Lane Baseline

`route-task` must assign exactly one lane before implementation:

- `fast`: docs/process only or small low-risk updates
- `standard`: non-trivial code/config outside protected paths
- `critical`: any protected path or blast-radius-heavy behavior

Lane output does not replace category checks below. Always run the union of:

- lane baseline checks
- category-specific checks from this document
- any explicit task-specific checks

## Baseline

- Install dependencies: `npm ci`
- Run policy checks when the change touches auth, server, database, CI, routing, or runtime boundaries: `npm run ci:check-focused`
- If a required check cannot run locally because secrets or environment are missing, call that out explicitly in the PR summary.
- When required checks do not need secrets or protected external systems, include `npm run verify:local` before finalizing.

## UI And Component Changes

Use for changes limited to `src/components/**`, `src/pages/**`, styling, copy, or non-auth UX.

- `npm run lint`
- `npm run typecheck`
- Run targeted tests when they exist, otherwise `npm test`
- `npm run build`

Browser/auth checks are not required unless the change affects routing, login, guards, session flows, or browser-only regressions.

## Auth, Routing, And Runtime Config

Use for changes touching login, signup, password recovery, route guards, role handling, navigation rules, `src/lib/auth*`, `src/lib/runtimeConfig*`, `src/main.tsx`, `src/App.tsx`, `src/server/api/runtime-config.ts`, or `netlify.toml`.

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`

Browser/auth checks required:

- `npm run ci:playwright`

If Playwright secrets are unavailable locally, state that clearly and rely on CI for the final browser/auth gate.

## Server, API, And Edge Integration

Use for changes in `src/server/**`, transport adapters, request/response contracts, API boundary code, or app-to-edge integration.

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add browser checks when the server/API change affects routed user flows, auth, or session lifecycle:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

## Database, RLS, Migrations, And Tenant Isolation

Use for changes in `supabase/migrations/**`, `supabase/functions/**`, tenant scoping, grants, RLS, RPC exposure, or data access policy.

- `npm run ci:check-focused`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`

Tenant validation is required for:

- schema or migration changes
- RLS or grant changes
- authz or org-scope changes
- RPC or edge-function changes that read or write tenant-scoped data

Add browser/auth checks when these changes affect login, route access, session booking, or other user-facing protected flows:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

## CI, Workflow, And Policy Changes

Use for changes in `.github/workflows/**`, `scripts/ci/**`, Husky hooks, or verification policy docs.

- validate the affected workflow/script directly
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`

If the change can affect app build or required checks, also run:

- `npm run test:ci`
- `npm run build`

## Docs And Process Changes

Use for docs-only or process-only changes with no code or config impact.

- verify links, commands, and file paths manually

Run additional commands only if the doc changes alter required developer workflow or verification guidance.
