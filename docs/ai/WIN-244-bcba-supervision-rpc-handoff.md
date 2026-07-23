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
  - local database-backed drift and grant checks: local `SUPABASE_DB_URL` is not configured
- hosted checks:
  - Supabase preview migration: pass
  - production migration promotion: pass; runtime ledger recorded `20260723212535/align_supervision_review_packet_template_name_type`
  - production function definition: pass; `template.template_name::text as supervision_template_name` is present
  - production ACL: pass; execute remains granted to `authenticated` and denied to `anon` and `PUBLIC`
  - authenticated hosted dashboard: pass; Supervision Notes Due loaded three review packets without the prior result-structure error
  - browser evidence: `.tmp/live-bcba-route-audit-2026-07-23/19-supervision-queue-runtime-fixed.jpg` (local audit artifact, not committed)
- pending checks:
  - refreshed GitHub runtime migration parity and aggregate CI gate
- result: `pass-with-blocked-local-checks`; hosted preview, production runtime, and browser verification passed
- residual risk: fresh CI must recognize the production ledger entry before auto-merge proceeds

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
- pr handoff: ready; production runtime and browser verification are documented
- reviewer: completed

## Post-Merge Proof

1. Confirm refreshed runtime migration parity and aggregate CI pass.
2. Allow the existing auto-merge request to merge only after all required checks pass.
3. Continue the remaining BCBA route audit from the corrected supervision dashboard.
