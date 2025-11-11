# RLS Consolidation Draft

Drawn from the Supabase performance inventory, this migration focuses on collapsing overlapping permissive policies that were triggering the `multiple_permissive_policies` advisory. The key moves implemented in `supabase/migrations/20251111090000_perf_rls_consolidation.sql` are:

- remove legacy `ALL` policies (`roles_admin_write`, `therapists_access_optimized`, `ai_session_notes_modify`, `admin_all_ai_perf`, `chat_history_owner`, `session_transcript_segments_modify`, and `session_transcripts_modify`);
- rehome the necessary logic into command-specific policies so that each role/action pair has exactly one permissive path;
- widen surviving `SELECT` policies to include administrators when the legacy `ALL` policy previously provided that capability; and
- add targeted `UPDATE`/`DELETE` policies to preserve therapist/org workflows now that the broad `ALL` policies are gone.

## Verification Checklist

- **Policy coverage** – For each touched table, confirm that `SELECT`, `INSERT`, `UPDATE`, and `DELETE` are all still authorized for the intended identities (admin, therapist, org members) via `pg_policies` and Supabase row-level access tests.
- **Regression tests** – Re-run the existing API integration suites that touch:
  - therapist rostering (`therapists` table),
  - AI note capture (`ai_session_notes` plus `ai_performance_metrics`),
  - chat transcript flows (`chat_history`, `session_transcripts`, `session_transcript_segments`).
- **Manual smoke** – Use Supabase MCP to execute representative queries as `anon`, `authenticated`, and `service_role` to guarantee no gaps introduced by policy consolidation.
- **Supabase advisories** – Re-run `get_advisors(type='performance')` to confirm the duplicate-policy warnings for the affected tables clear after the migration is applied.

