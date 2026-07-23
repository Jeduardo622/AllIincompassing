# WIN-244 BCBA Supervision RPC Handoff

## Scope

- Restore the BCBA dashboard supervision queue by aligning
  `get_pending_supervision_review_packets().supervision_template_name` with its
  declared `text` return type.
- Keep the existing return columns, tenant filters, role checks, grants,
  correction behavior, and frontend contract unchanged.
- Non-goals: table changes, data backfills, RLS changes, UI changes, or broader
  supervision workflow changes.

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering path: `supabase/migrations/**`
- Linear: `WIN-244`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `supabase-reviewer`

## Files Touched

- `supabase/migrations/20260723133526_align_supervision_review_packet_template_name_type.sql`
- `tests/supervisionReviewPacketTemplateNameTypeMigration.test.ts`
- `docs/ai/WIN-244-bcba-supervision-rpc-handoff.md`

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database migration, tenant-scoped RPC
- required checks:
  - focused migration, workflow, and consumer tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - focused Vitest set: pass, 4 files and 39 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail on existing unrelated Windows baseline failures
  - `npm run verify:local`: fail because it includes the same unrelated baseline failures
- blocked checks:
  - database-backed preview drift and grant checks: local `SUPABASE_DB_URL` is not configured
- result: `pass-with-blocked-checks`
- residual risk: the SQL contract is statically and structurally verified, but
  the applied function and ACLs still require hosted verification after human
  review and migration deployment.

## Review

- code-review-engineer: approve, no findings
- security-engineer: approve, no auth, tenant, or ACL widening
- supabase-reviewer: approve, `CREATE OR REPLACE FUNCTION` is compatible and the
  only function-body change is the explicit `::text` cast
- test-engineer: targeted coverage is adequate; hosted execution remains required

## PR Hygiene

- branch-ready: yes, `codex/win-244-bcba-supervision-rpc`
- linear-ready: yes, `WIN-244`
- single-purpose: yes
- unrelated changes: `.superpowers/brainstorm/`, `.tmp/`, `pnpm-lock.yaml`, and
  `pnpm-workspace.yaml` remain untracked and excluded
- protected-path drift: none beyond the routed migration
- pr handoff: ready after staging only the three files above
- reviewer: completed

## Post-Merge Proof

1. Confirm the hosted function definition contains
   `template.template_name::text as supervision_template_name`.
2. Confirm execute remains limited to `authenticated` and `service_role`.
3. Refresh the live BCBA dashboard and capture the supervision queue without the
   prior result-structure error.
