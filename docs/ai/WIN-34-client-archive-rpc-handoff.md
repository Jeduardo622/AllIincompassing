# WIN-34 Client Archive RPC Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: The fix restores a PostgREST RPC through a database migration and changes function grant exposure.
- triggering paths: `supabase/migrations/**`, RPC exposure, grants, tenant-scoped client writes

## Scope

- task intent: Restore the existing client archive action without duplicating or weakening the authoritative tenant and role checks in `app.set_client_archive_state`.
- files touched: `supabase/migrations/20260810172500_restore_client_archive_public_rpc.sql`, `tests/clients/client-archive-public-wrapper-migration.contract.test.ts`, `docs/ai/WIN-34-client-archive-rpc-handoff.md`
- single-purpose diff: yes
- non-goals: No frontend changes, therapist archive changes, authorization-policy rewrites, or hosted migration application.

## Required Agents

- required sequence: specification-engineer, software-architect, implementation-engineer, code-review-engineer, test-engineer, security-engineer
- agents used: specification-engineer, software-architect, implementation-engineer, code-review-engineer, test-engineer, security-engineer, supabase-reviewer
- reviewer: completed; final security review reported no findings

## Verification Card

- required checks: `npx vitest run tests/clients/client-archive-public-wrapper-migration.contract.test.ts`, `npm run ci:check:migrations`, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, local migration/runtime smoke
- executed checks:
  - `npx vitest run tests/clients/client-archive-public-wrapper-migration.contract.test.ts`: pass, 1 test
  - `npm run ci:check:migrations`: pass
  - `npm run ci:check-focused`: pass; database-backed grant and preview-drift checks skipped because no database URL is configured
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm run test:ci`: blocked after a 183-second timeout while unrelated AI-documentation tests attempted unavailable network calls
- blocked checks:
  - `npm run test:ci`: bounded run timed out; an earlier run also failed during coverage aggregation because a generated `coverage/.tmp/coverage-47.json` file was missing
  - `npm run verify:local`: cannot complete while its required `test:ci` phase is blocked
  - local migration/runtime smoke: Docker Desktop Linux engine is unavailable, so the migration could not be replayed against local Postgres/PostgREST
- result: pass-with-blocked-checks
- residual risk: SQL behavior has not been exercised against a running Postgres/PostgREST instance. Production remains unchanged until a human-reviewed migration is applied, after which authorized, anonymous, and cross-organization behavior must be verified.

## PR Hygiene

- branch-ready: yes, `codex/win-34-client-archive-rpc`
- linear-ready: yes, `WIN-34`
- protected-path drift: none beyond the declared migration
- unrelated changes: none in the isolated worktree
- generated artifact drift: none
- verification summary: present
- pr-ready: yes, with blocked checks disclosed
- required follow-up: Human review, CI, migration deployment through the normal protected workflow, and hosted archive smoke verification.

## Handoff Summary

The client page calls `public.set_client_archive_state`, but hosted PostgREST only has the tenant-authorized implementation in the unexposed `app` schema. This change adds a restricted public wrapper that delegates to that authority with an empty search path and grants execution only to authenticated users. Targeted, policy, tenant, lint, typecheck, and build checks pass; full CI and runtime database proof remain blocked locally and must be completed by CI and the reviewed deployment workflow.
