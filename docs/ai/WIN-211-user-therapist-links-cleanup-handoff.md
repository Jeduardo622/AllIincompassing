# WIN-211 User Therapist Link Cleanup Handoff

## Scope

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-211
- branch: codex/cleanup-stale-therapist-links
- protected surface: `supabase/migrations/**`, tenant-scoped link data, role-scoped session/admin link behavior

## Route Task

- why: the slice changes Supabase data hygiene for `public.user_therapist_links`, a tenant-sensitive table used by session authorization and admin therapist-link RPCs.
- triggering paths:
  - `supabase/migrations/20260709170000_quarantine_stale_user_therapist_links.sql`
  - `tests/integration/user-therapist-links-cleanup-migration.contract.test.ts`
  - `docs/ai/WIN-211-user-therapist-links-cleanup-handoff.md`
- required agents:
  - specification-engineer
  - software-architect
  - implementation-engineer
  - code-review-engineer
  - test-engineer
  - security-engineer
  - supabase-reviewer
- reviewer required: yes
- verify-change required: yes
- linear required: yes

## Tenant Boundary

`public.user_therapist_links` rows must only connect a supported active user role to an active therapist in the same organization. Cross-tenant links, links whose user organization cannot be resolved by `app.resolve_user_organization_id`, links with a missing therapist, links to inactive/deleted therapists, and links whose user has no active supported role are stale.

The cleanup intentionally preserves supported semantics currently present in the codebase:

- provider/session links: `therapist`, `bt`
- scoped staff read or route fallback paths: `midtier`, `admin_schedule`, `bcba`
- admin therapist-link RPCs: `admin`, `super_admin`, `org_admin`, `org_super_admin`

## Hosted Pre-Apply Evidence

Supabase project: `wnnjeqheqxxyrgsjmygy`

Aggregate-only evidence from the Supabase connector, with no row identifiers copied into this file:

- total `user_therapist_links`: 4
- resolver-based total links: 4
- resolver-based stale link count: 1
- resolver-based missing user org count: 1
- resolver-based missing therapist count: 0
- resolver-based cross-org count: 0
- resolver-based inactive/deleted therapist count: 0
- resolver-based no supported active role count: 1
- resolver-based duplicate pair count: 0
- proposed quarantine/delete count: 1

## Hosted Apply And Post-Apply Evidence

Applied through the Supabase connector with logical migration name `quarantine_stale_user_therapist_links`.

- hosted migration ledger row: version `20260709161951`, name `quarantine_stale_user_therapist_links`
- live total links after apply: 3
- live stale links after apply: 0
- quarantine batch count: 1
- quarantined rows absent from live table: 1
- rerun delete candidates for this batch: 0
- live duplicate pair count: 0
- quarantine table grants:
  - `postgres`: owner privileges
  - `service_role`: `SELECT`
- quarantine RLS policies:
  - `user_therapist_links_quarantine_service_role_select`: `SELECT` to `{service_role}`, `USING (true)`, no `WITH CHECK`
- quarantine RLS enabled: true
- quarantine RLS forced: true

The local filename remains `20260709170000_quarantine_stale_user_therapist_links.sql` so it sorts after the merged `20260709162000_*` migration in this repository. The hosted connector assigned its own ledger version during apply. If a later Supabase CLI deploy checks only migration versions and reruns this file, the cleanup DML is idempotent for the current hosted state: there are zero stale live links and zero rerun delete candidates.

## Implementation

Migration `20260709170000_quarantine_stale_user_therapist_links.sql`:

- creates `public.user_therapist_links_quarantine`
- enables and forces RLS on the quarantine table
- adds an explicit `service_role` select policy on the quarantine table
- revokes all access from `public`, `anon`, `authenticated`, and `service_role`
- grants only `select` to `service_role` for privileged inspection; no post-migration insert/delete grant is left on the quarantine table
- resolves user-side organization with `app.resolve_user_organization_id`, not `profiles.organization_id` alone
- inserts matching stale rows into quarantine using a predicate, not hardcoded IDs
- deletes only rows from the named quarantine batch that still match the computed `is_stale` predicate on rerun
- leaves admin-users RPC exposure out of scope

`src/lib/generated/database.types.ts` is intentionally unchanged. The new table is a service-role-only forensic table with no app or server typed consumer in this slice; generated type exposure should be added only if a reviewed typed consumer is introduced.

Rollback path requires reviewed service-role restore from `public.user_therapist_links_quarantine` for the named batch. Suggested restore shape:

```sql
insert into public.user_therapist_links (id, user_id, therapist_id, created_at)
select q.link_id, q.user_id, q.therapist_id, q.link_created_at
from public.user_therapist_links_quarantine q
where q.quarantine_batch = '20260709170000_quarantine_stale_user_therapist_links'
  and not exists (
    select 1
    from public.user_therapist_links utl
    where utl.id = q.link_id
  );
```

## Verification Card

- classification: high-risk human-reviewed
- lane: critical
- change type:
  - database/RLS/migration/tenant isolation
  - tenant-scoped data cleanup
- required checks:
  - `npx vitest run tests/integration/user-therapist-links-cleanup-migration.contract.test.ts --reporter=verbose`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local` when locally meaningful
- executed checks:
  - Supabase connector pre-apply aggregate check: passed; 1 stale link identified, no row identifiers copied
  - Supabase connector migration apply: passed
  - Supabase connector post-apply aggregate check: passed; 0 stale live links, 1 quarantined row, 0 rerun delete candidates
  - `npx vitest run tests/integration/user-therapist-links-cleanup-migration.contract.test.ts --reporter=verbose`: passed, 1 file / 4 tests
  - `WIN211_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:<ephemeral-port>/postgres npx vitest run tests/integration/user-therapist-links-cleanup-migration.postgres.test.js --reporter=verbose`: passed against a disposable `postgres:16` Docker container, 1 file / 1 test
    - executed the actual migration SQL twice
    - verified stale rows are quarantined then deleted
    - verified restored links already present in the quarantine batch are not deleted when they no longer evaluate stale
    - verified newly stale links are quarantined/deleted on a later run
    - verified forced RLS and service-role-only quarantine grants after migration execution
  - `npx vitest run tests/integration/user-therapist-links-cleanup-migration.contract.test.ts tests/integration/user-therapist-links-cleanup-migration.postgres.test.js --reporter=verbose`: passed for default local mode, 4 contract tests passed and 1 Postgres-backed test skipped without `WIN211_POSTGRES_URL`
  - `npm run verify:local`: passed
    - includes `npm run ci:check-focused`
    - includes `npm run lint`
    - includes `npm run typecheck`
    - includes `npm run test:ci`
    - includes `npm run ci:verify-coverage`
    - includes `npm run build`
    - includes `npm run test:routes:tier0`, 7 Cypress specs / 220 tests passed
  - `npm run lint`: passed after adding the seeded cleanup rerun test
  - `npm run typecheck`: passed after adding the seeded cleanup rerun test
- blocked checks:
  - `npm run verify:local` skipped branch protection outside CI.
  - `npm run verify:local` skipped privileged function DB grant check and Supabase preview drift check because `SUPABASE_DB_URL`/`DATABASE_URL` is not configured locally; hosted Supabase connector evidence above covers this slice's applied database state.
- result:
  - pass for local verification and hosted post-apply evidence
- residual risk:
  - critical-lane human review and live PR checks remain required before merge
  - hosted `service_role` bypasses RLS, so the quarantine table intentionally keeps only a minimal explicit `SELECT` grant and no authenticated/anon grants
  - hosted ledger version was assigned by the Supabase connector and differs from the local filename timestamp; the SQL is idempotent if later applied by local version

## PR Hygiene Verdict

- pr-ready: yes, after final diff check and PR creation
- lane: critical
- branch-ready: yes
- linear-ready: yes, WIN-211
- single-purpose: yes
- unrelated changes: no; generated test reliability timestamp drift restored
- generated artifact drift: none required; database types intentionally unchanged because the quarantine table is service-role-only and has no typed app/server consumer
- protected-path drift: expected `supabase/migrations/**`
- change summary: present
- verification summary: present
- pr handoff: ready after PR URL is created
- reviewer: approved by final code-review-engineer after the Postgres-backed migration test was added; security-engineer and supabase-reviewer approved current SQL
- required follow-up:
  - open PR for human review
  - keep admin-users RPC exposure audit as a separate slice
