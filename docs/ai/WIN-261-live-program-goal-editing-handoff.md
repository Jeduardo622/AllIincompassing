# WIN-261 Live Program, Goal, and Skill Editing Handoff

## Scope

- Issue: WIN-261
- Branch: `codex/win-261-live-program-goal-editing`
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
  - `PUBLIC` and `anon` execution removed from the protected `app` helpers;
  - service-role access retained.

## Verification Card

- Lane: critical
- Result: hosted implementation applied and role/RLS behavior proven; PR is review-ready with all required live checks green and remains intentionally unmerged pending human review.
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
  - ACL hardening TDD: expected failure before the migration correction, then 20/20 migration-contract tests passed
  - live CI runtime migration parity
  - hosted synthetic manager/viewer/denial role proof with zero residual rows
- Live PR run `30315242047`:
  - `ci-gate`, unit tests and coverage, build, lint/typecheck, policy, runtime migration parity, both tenant-safety workflows, Tier-0 browser, auth browser smoke, IEHP assessment import smoke, Lighthouse, and the Netlify deploy preview passed.
- Local-only Windows baseline failures outside WIN-261 scope:
  - `npm run test:ci` stops on five reproducible failures in unchanged files (3,506 passed, 5 failed):
    - `tests/authorizations/authorization-bcba-readonly.test.ts`: BCBA authorization read-only migration contract mismatch
    - `src/lib/__tests__/supabase.edge.test.ts`: `blob.text is not a function`
    - `tests/ci/check-e2e-reliability-gates.test.ts`: missing expected synthetic-BCBA workflow publishable-key contract
    - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`: generated super-admin/unconditional-cleanup path contract mismatch
    - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`: missing expected `codex/return-bt-correction` workflow branch
  - `npm run verify:local` was not rerun because its required `test:ci` sub-gate has the same decisive failures.
  - `npm run ci:playwright` was not run because local credentials/base URL are unavailable (`SUPABASE_SERVICE_ROLE_KEY`, test email/password, and test base URL absent).
  - DB-backed policy checks were skipped locally because `SUPABASE_DB_URL`/`DATABASE_URL` is absent.

## Review

- Code review: approved after goal-archive gating correction.
- Security review: approved after adding explicit `PUBLIC`/`anon` revokes to both protected helpers.
- Supabase review: safe to apply after program-note read/write policy and live helper-ACL corrections.
- Test review: no feature blocker; low-severity gaps remain for independent admin/super-admin goal-save paths, explicit cache invalidation spies, and program-save failure retention.

## Hosted State

- Connected project: `wnnjeqheqxxyrgsjmygy`.
- Migration history contains logical migration `align_program_goal_edit_authority` at hosted version `20260727234007`.
- Hosted function definitions match the requested authority contract.
- `anon` cannot execute either protected `app` helper; `authenticated` and `service_role` retain execution.
- Hosted authenticated-JWT probes proved:
  - `admin`, `midtier`, `bcba`, and `super_admin` can manage and write same-org program notes, with cross-org rows hidden;
  - `therapist` can read same-org program notes but cannot manage or write;
  - assigned `bt` can read only assigned-client program notes and cannot write;
  - `admin_schedule` cannot manage, read, or write program notes.
- Synthetic proof cleanup returned `synthetic_residue = 0`.
- No Edge Function source changed, so Edge Function deployment is not applicable.

## Residual Risk And Next Action

- Human review is mandatory for the migration and protected server changes.
- Required next action: obtain human review and merge only when live branch protection allows it.
- Follow-up, separate from WIN-261: make the unchanged workflow/config contract tests line-ending agnostic on Windows.

## CI Baseline Follow-Up

- WIN-262 / PR #872 made the synthetic-BCBA publishable-key contract, the IEHP smoke contract, and the BT/ABA `codex/return-bt-correction` contract line-ending agnostic on Windows.
- WIN-264 covers the `src/lib/__tests__/supabase.edge.test.ts` Blob-read failure by reading the returned Blob through the jsdom-supported `FileReader` API in the test only; the separate `tests/authorizations/authorization-bcba-readonly.test.ts` Windows CRLF baseline remains out of scope. See `docs/ai/handoffs/WIN-264-windows-blob-test.md`.
- No migration, hosted Supabase, workflow, CI-script, or program/goal editing implementation changes are part of WIN-264.
