# WIN-219 Supabase preview seed organization ordering

## Chosen slice

Repair the data-less Supabase Preview seed failure that inserted `auth.users` before the deterministic preview organization existed. The existing issue `WIN-219` is reused because Linear rejected creation of a new issue after the workspace reached its issue limit.

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering surface: `supabase/seed.sql` writes auth metadata that the trusted profile-sync trigger persists into tenant-scoped `profiles.organization_id`
- allowed files: `supabase/seed.sql`, one focused contract test, and this handoff
- non-goals: migrations, functions, RLS, grants, CI, runtime configuration, hosted mutation, deployment, payroll activation, capability grants, or production/customer data
- stop condition: any repair requiring a protected authority surface outside the seed file

## Root cause and repair

The seed previously omitted organization metadata from its four synthetic auth users and created organization `00000000-0000-0000-0000-000000000001` only after those auth writes. On a data-less preview, `sync_user_profile()` therefore resolved the legacy fallback organization and attempted to persist a profile foreign key before that organization existed.

The bounded repair:

- creates the deterministic preview organization before the auth-user loop
- writes both `organization_id` and `organizationId` to every synthetic seed user's metadata
- removes the later duplicate organization insert
- leaves profile synchronization, migrations, RLS, grants, functions, and downstream fixture organization IDs unchanged

## Verification card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: `database/RLS/migrations/tenant isolation` (seed/bootstrap only; no RLS or migration change)
- Required checks: `npx vitest run tests/supabase-preview-seed-organization-order.test.ts --reporter=verbose`; `npx supabase db reset --local --yes`; existing-user `supabase/seed.sql` replay; post-replay synthetic SQL assertions; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`
- Executed checks: focused RED proof -> failed both assertions on the original seed as expected; focused GREEN -> passed `2/2`; clean local database replay -> passed all migrations and seed; existing-user seed replay -> passed with `BEGIN`, `DO`, and `COMMIT`; post-replay SQL -> passed with one seed org, all four synthetic profiles and both metadata keys on `00000000-0000-0000-0000-000000000001`, and zero fallback profiles; `npm run ci:check-focused` -> passed; `npm run lint` -> passed; `npm run typecheck` -> passed; `npm run test:ci` -> failed on two unrelated `ProgramsGoalsTab` full-suite timeouts after `4,967` tests passed; isolated `ProgramsGoalsTab` file -> passed `120/120`; `npm run validate:tenant` -> passed; `npm run build` -> passed; `npm run verify:local` -> failed first on default-heap exhaustion and then on the same two unrelated full-suite UI timeouts with an 8 GB heap; `git diff --check` -> passed with only the existing Windows line-ending warning; `npm run preview:build` -> passed; `npm run preview:smoke` -> passed local index, runtime-config, auth health, and anonymous auth checks
- Blocked checks: hosted fresh-preview replay -> not manually dispatched because hosted mutation remains outside authorization; dynamic database checks within `npm run ci:check-focused` -> skipped because `SUPABASE_DB_URL`/`DATABASE_URL` was not configured
- Result: `fail`
- Residual risk: the repaired seed path has decisive clean-reset and existing-user replay proof, but exact-head CI must resolve the two inherited full-suite UI timeouts before this critical slice can become review-ready

## PR hygiene

- `pr-ready`: no
- `lane`: `critical`
- `branch-ready`: yes (`codex/win-219-preview-seed-organization-order`)
- `linear-ready`: yes (`WIN-219`, reused after Linear rejected a new issue at the workspace limit)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none; build outputs are ignored and no generated source artifact is required for a seed-only change
- `protected-path drift`: none beyond the routed tenant-sensitive seed surface; no migration, function, RLS, grant, CI, auth helper, or runtime-config file changed
- `change summary`: present
- `verification summary`: present
- `pr handoff`: ready for a draft PR; exact-head CI is required before marking it review-ready
- `reviewer`: completed with no code findings; security approved
- `required follow-up`: open a draft PR, inspect exact-head checks, keep human critical-lane review mandatory, and do not merge or dispatch protected workflows
- `handoff summary`: The data-less preview seed now creates its synthetic organization before auth writes and binds both supported org metadata keys to every seed user. Clean reset, existing-user replay, tenant checks, focused tests, builds, and preview smoke pass; full local verification remains non-green only because two unrelated `ProgramsGoalsTab` tests time out under full-suite load and pass `120/120` in isolation.

## Specialist review

- specification and architecture: confirmed seed-only containment and `critical` routing
- implementation: moved the existing organization insert and added explicit metadata without changing protected authority code
- security: approved; no authz, RLS, grant, secret, PHI, or cross-tenant widening found
- code review: no code findings; final PR readiness remains contingent on this verification and PR hygiene evidence
- Supabase: confirmed the fresh-preview root cause and requested runtime replay; clean reset, existing-user replay, and synthetic SQL evidence were completed locally

## Residual risk and merge boundary

The full local suite remains non-green because of two unrelated full-suite UI timeouts that pass in isolation. Exact-head CI is required for final attribution. Hosted preview recreation was not performed because it is a hosted mutation and remains outside authorization. Human critical-lane review is mandatory before merge, and Codex must not merge or dispatch any protected workflow.
