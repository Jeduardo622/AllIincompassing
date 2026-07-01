## Summary

Critical-lane Supabase follow-up for hosted project `wnnjeqheqxxyrgsjmygy`.

Scope:

- keep the FK covering-index SQL unchanged
- align the source-controlled migration version with the live hosted ledger version `20260701135309`
- keep verification limited to the targeted migration test plus required repo checks

Why:

- Supabase Preview on PR #708 failed even after merge because hosted branch-action reconciliation reported `Remote migration versions not found in local migrations directory`
- the live project ledger recorded `20260701135309_repair_supervision_session_note_request_fk_covering_indexes`
- `origin/main` carried the same SQL body under `20260701135040`, so preview could not reconcile the merged repo with the hosted migration history

Files:

- `supabase/migrations/20260701135309_repair_supervision_session_note_request_fk_covering_indexes.sql`
- `tests/supervisionSessionNoteRequestIndexAdvisorMigration.test.ts`

Verification plan:

- `npx vitest run tests/supervisionSessionNoteRequestIndexAdvisorMigration.test.ts`
- `npm run ci:check-focused`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local`

Tracking:

- Linear: `WIN-190`
- follow-up branch: `codex/supabase-preview-migration-version-align`
