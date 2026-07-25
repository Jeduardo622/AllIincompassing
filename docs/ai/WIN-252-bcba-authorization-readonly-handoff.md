# WIN-252 BCBA Authorization Read-Only Handoff

## Task

Make authorization access read-only for exact BCBA profiles. BCBA users keep authorization
and unit visibility but cannot create, renew, edit, delete, or attach authorization documents.

## Routing

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths:
  - `src/lib/roles.ts`
  - `src/pages/Authorizations.tsx`
  - `src/components/ClientDetails/PreAuthTab.tsx`
  - `supabase/migrations/**`
- Linear: `WIN-252`
- Human review: required before merge

## Scope

Allowed surfaces:

- Frontend authorization capability matrix
- Authorization list and client pre-authorization mutation affordances
- Exact authorization management and read helpers
- Focused role, UI, migration, and tenant smoke tests

Non-goals:

- Changing BCBA route visibility
- Changing Mid Tier, admin schedule, admin, or super-admin authorization authority
- Changing BCBA scheduling, staff, programs/goals, billing, or clinical-review authority
- Redesigning authorization forms or document-download behavior

Stop conditions:

- Any requirement for assignment-dependent BCBA write access
- Any broader role-matrix change
- Any cross-organization read expansion

## Boundary

- `bcba` retains `viewAuthorizations`.
- `bcba` loses `manageAuthorizations`, including profiles with lower-ranked manager grants.
- `midtier`, `admin_schedule`, `admin`, and `super_admin` remain authorization managers.
- The Authorizations page and client Pre-Authorization tab hide mutation controls and guard
  handlers when `manageAuthorizations` is absent.
- `app.current_user_can_manage_authorizations` removes exact BCBA authority. Existing table
  write policies and authorization RPCs already depend on this helper.
- `app.current_user_can_read_authorization_row` adds an explicit same-organization exact BCBA
  read branch so the write restriction does not remove authorization visibility.
- A shared trigger guard blocks exact BCBA writes to `authorizations` and
  `authorization_services`, including provider-self RLS paths and security-definer RPCs.
- The hosted SQL smoke gives its BCBA actor a lower `admin_schedule` grant and still expects
  authorization and authorization-service writes to fail with `42501`.
- Cross-organization authorization reads remain denied.

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: UI/component, role authorization, database/RLS/migration, tenant isolation
- Required checks:
  - focused role, UI, and migration contract tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright`
  - `npm run verify:local`
- Executed checks:
  - focused Vitest: passed, 5 files and 56 tests
  - `npm run ci:check-focused`: passed; database-backed checks skipped without
    `SUPABASE_DB_URL`
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run validate:tenant`: passed
  - `npm run ci:verify-coverage`: passed
  - `npm run test:routes:tier0`: passed, 7 specs and 220 tests
  - `npm run build`: passed
  - `npm run test:ci`: failed on four unrelated baseline tests in untouched workflow and PDF
    helper surfaces
  - `npm run ci:playwright`: stopped at preflight because no admin or super-admin credentials
    are configured in the worktree
  - `npm run verify:local`: policy, lint, and typecheck passed before the same four
    `test:ci` baseline failures stopped the aggregate
- Blocked checks:
  - hosted Playwright smoke requires protected credentials
  - database-backed migration proof requires the Supabase PR preview
- Result: focused authorization, tenant, route, and build gates passed; aggregate repository
  verification remains red on four failures unrelated to this diff
- Residual risk: hosted migration and exact-role behavior require synthetic branch-preview
  proof before merge

## Rollback

Forward recovery only. A later migration may restore BCBA to the exact authorization manager
array if product policy changes. The UI capability must be restored in the same recovery.
