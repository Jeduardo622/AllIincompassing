# WIN-261 Live Program, Goal, and Skill Editing Handoff

## Scope

- Issue: WIN-261
- Branch: `codex/editingofgoalblocks`
- Classification: high-risk human-reviewed
- Lane: critical
- Live records only: manual and assessment-promoted programs/goals use the same editors.
- Retained assessment draft rows remain immutable after publish.
- Managers: `admin`, `midtier`, `bcba`, `super_admin`.
- Read-only Programs & Goals viewers: `therapist` and assigned `bt`; `admin_schedule` remains outside Programs & Goals capability access.

## Implemented

- Added inline live program editing for name and description.
- Added inline live goal/skill editing for approved clinical fields.
- Kept `source`, `original_text`, organization identity, and client identity out of goal update payloads.
- Added canonical baseline precedence, fail-closed objective-point parsing, and failed-save state retention.
- Gated create, edit, archive, assessment review/publish, note creation, and assessment deletion controls with `manageProgramsGoals`.
- Aligned server mutation handlers to `current_user_can_manage_programs_goals`.
- Gated assessment-document deletion with the canonical capability.
- Added migration `20260727214202_align_program_goal_edit_authority.sql`:
  - manager writes: `admin`, `midtier`, `bcba`, plus the existing `super_admin` short circuit;
  - therapist and assigned-BT reads preserved;
  - program-note reads separated from manager-only writes;
  - same-organization and referenced-program/client scope retained;
  - service-role access retained.

## Verification Card

- Lane: critical
- Result: review-ready with external baseline blockers; hosted migration not applied.
- Passed:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused Vitest set: 10 files, 307 tests
  - `npm run validate:tenant`
  - `npm run ci:verify-coverage` (92.88% lines; required 86%)
  - `npm run build`
  - `npm run test:routes:tier0` (220/220)
  - per-slice component/helper verification after final fixes: 118/118, then 115/115
- Blocked or failing outside WIN-261 scope:
  - `npm run test:ci` and `npm run verify:local` stop on three reproducible failures in unchanged files:
    - `src/lib/__tests__/supabase.edge.test.ts`: `blob.text is not a function`
    - `tests/ci/check-e2e-reliability-gates.test.ts`: missing expected synthetic-BCBA workflow publishable-key contract
    - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`: missing expected `codex/return-bt-correction` workflow branch
  - `npm run ci:playwright` was not run because local credentials/base URL are unavailable (`SUPABASE_SERVICE_ROLE_KEY`, test email/password, and test base URL absent).
  - DB-backed policy checks were skipped locally because `SUPABASE_DB_URL`/`DATABASE_URL` is absent.

## Review

- Code review: approved after goal-archive gating correction.
- Security review: approved; no remaining mutation or tenant-boundary blocker.
- Supabase review: safe to apply after program-note read/write policy correction.
- Test review: no feature blocker; low-severity gaps remain for independent admin/super-admin goal-save paths, explicit cache invalidation spies, and program-save failure retention.

## Hosted State

- Connected project: `wnnjeqheqxxyrgsjmygy`.
- The migration list was inspected after local verification.
- Migration `20260727214202_align_program_goal_edit_authority` is not applied.
- Hosted apply and synthetic role/RLS proof were intentionally held because the required `test:ci` gate is failing outside this slice.
- No Edge Function source changed, so Edge Function deployment is not applicable.

## Residual Risk And Next Action

- Human review is mandatory for the migration and protected server changes.
- Required next action: resolve or explicitly disposition the three baseline `test:ci` failures, then apply the reviewed migration and run hosted synthetic role/RLS proof before merge.
