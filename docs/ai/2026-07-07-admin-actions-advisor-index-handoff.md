## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: this slice adds a migration under `supabase/migrations/**` and applies index DDL to the linked hosted Supabase project
- triggering paths:
  - `supabase/migrations/20260707125557_repair_live_admin_actions_advisor_covering_index.sql`
  - `tests/adminActionsAdvisorCoveringIndexMigration.test.ts`

## Scope

- task intent: repair the live `public.admin_actions.admin_user_id` Supabase advisor warning with the smallest migration-backed covering index change
- Linear issue: `WIN-201`
- files touched:
  - `supabase/migrations/20260707125557_repair_live_admin_actions_advisor_covering_index.sql`
  - `tests/adminActionsAdvisorCoveringIndexMigration.test.ts`
  - `docs/ai/2026-07-07-admin-actions-advisor-index-handoff.md`
- single-purpose diff: yes
- non-goals:
  - no RLS, grant, RPC, trigger, or table DDL changes
  - no advisor cleanup beyond `public.admin_actions.admin_user_id`
  - no unrelated migration replay or backlog reduction

## Tenant Boundary

- `public.admin_actions` remains org-scoped under existing policies
- the change adds only a single-column foreign-key covering index on `admin_user_id`
- no cross-tenant read or write path changed

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - Codex performed routing, hosted verification, implementation, focused testing, and local review directly
- reviewer: completed locally; human review remains required before merge

## Verification Card

- required checks:
  - `npx vitest run tests/adminActionsAdvisorCoveringIndexMigration.test.ts`
  - `npm run validate:tenant`
  - `npm run verify:local`
- executed checks:
  - `npx vitest run tests/adminActionsAdvisorCoveringIndexMigration.test.ts`: pass
  - `npm run validate:tenant`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - none
- result: pass
- residual risk: the hosted index was applied directly for live repair, so the repo migration still needs normal PR review and later migration-chain application to keep schema history aligned across environments

## Hosted Evidence

- Supabase project: `wnnjeqheqxxyrgsjmygy`
- pre-fix advisor state: performance advisor reported `unindexed_foreign_keys` for `public.admin_actions.admin_actions_admin_user_id_fkey`
- live repair applied: `create index if not exists public.admin_actions_admin_user_id_idx on public.admin_actions (admin_user_id)`
- post-fix verification:
  - `pg_indexes` returns `admin_actions_admin_user_id_idx`
  - performance advisor no longer lists `public.admin_actions.admin_user_id`

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-201`)
- protected-path drift: expected `supabase/migrations/**`
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up:
  - push `codex/repair-admin-actions-advisor-index`
  - open PR for human review

## Handoff Summary

This slice restores the missing `public.admin_actions.admin_user_id` covering index that had been dropped earlier, using one index-only migration plus one focused Vitest guard. The linked Supabase project was checked before and after the fix: the advisor warning was present before the change, the index now exists in `pg_indexes`, and the advisor item is gone afterward. Local verification passed with the targeted migration contract, `validate:tenant`, and the full `verify:local` baseline. The remaining risk is procedural rather than behavioral: the repo migration still needs the usual PR review and downstream migration application flow.
