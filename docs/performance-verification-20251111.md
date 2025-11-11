# Verification Notes – 2025-11-11

## Supabase Performance Advisories

- `mcp_supabase_get_advisors(type='performance')` re-run at 2025-11-11 still reports the original 394 findings because the newly added migrations have not been applied to the hosted project yet.
- Once `supabase db push -p wnnjeqheqxxyrgsjmygy` is executed, re-run the advisor to confirm that:
  - `multiple_permissive_policies` clears for the targeted tables (`roles`, `therapists`, `ai_session_notes`, `ai_performance_metrics`, `chat_history`, `session_transcripts`, `session_transcript_segments`);
  - `unused_index` counts drop for the tables covered by `20251111091000_prune_unused_indexes.sql`.

## JS Toolchain

- No frontend/backend TypeScript source files were modified in this iteration, so lint/test/type-check runs are expected to remain unchanged.
- Recommended post-migration smoke:
  - `npm test` – confirm integration coverage for therapist roster, AI notes, chat flows.
  - `eslint .` – ensure SQL-driven changes do not introduce generated type diffs.
  - `tsc --noEmit` – verify generated Supabase types continue to compile once the schema diff is pushed.

## Follow-up Actions

- Apply migrations to staging before production to validate query plans and collect real `pg_stat_user_indexes` deltas.
- Monitor for index regression by capturing `pg_stat_statements` after rollout; restore any dropped index needed by emergent workloads.

