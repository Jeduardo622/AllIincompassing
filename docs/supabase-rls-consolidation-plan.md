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

## Phase 2 Consolidation Targets (2025-11-11)

| Table | Action(s) | Existing Redundant Policies | Planned Merge Strategy |
| --- | --- | --- | --- |
| `public.ai_session_notes` | `UPDATE` | `"Therapists can update their AI session notes"` (public) overlaps with `ai_session_notes_update_scope` (public) for every inherited role. | Drop the legacy therapist-specific policy; rely on the scoped policy (which already covers therapist access via `app.can_access_session`) and ensure it targets `authenticated`. |
| `public.ai_performance_metrics` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `ai_performance_metrics_admin_manage_admin_manage` (`authenticated`,`ALL`) overlaps with per-action admin/public policies. | Fold admin pathways into the per-action policies and drop the legacy `ALL` policy; scope admin-only mutations to `authenticated` with explicit `app.is_admin()` checks. |
| `public.therapists` | `INSERT`, `SELECT`, `UPDATE` | Combination of `therapists_admin_write`, `org_write_therapists`, `consolidated_select_700633`, `therapists_select`, `therapists_update_self`. | Replace the mix of `public` + `authenticated` policies with three consolidated policies (`therapists_insert_scope`, `therapists_select_scope`, `therapists_update_scope`) that combine admin, self, and org-admin conditions per action. Consider a fourth `DELETE` policy if org admins require it. |

These merges will reduce the Supabase `multiple_permissive_policies` warnings for the highlighted tables while preserving existing behavior for administrators, therapists, and organization managers.

### Phase 2 Outcomes

- Migrations `20251111095000_rls_phase2.sql` + hosted Supabase apply eliminated the duplicate-policy advisories for `public.therapists`, `public.ai_session_notes`, and `public.ai_performance_metrics`.
- Post-migration advisor run shows `multiple_permissive_policies` WARNs reduced from 288 → 159 overall (zero on the phase-2 targets).

### Phase 3 Targets (Work-in-progress)

| Table | Primary Overlaps | Proposed Direction |
| --- | --- | --- |
| `public.billing_records` | `billing_records_modify` (`public`,`ALL`) + `org_write_billing_records` (`authenticated`,`ALL`) + `billing_records_select` (`public`,`SELECT`) + consolidated select | Replace with scoped `billing_records_mutate_scope` (`authenticated`) and `billing_records_select_scope` (admins + org members) to avoid broad `public` `ALL` policies. |
| `public.clients` | `consolidated_all_4c9184` (`public`,`ALL`) + org read/write policies | Split into `clients_select_scope` and `clients_mutate_scope` per role; restrict admin-only actions and rely on org-specific policies. |
| `public.sessions` | `consolidated_all_4c9184` (`public`,`ALL`) + org write/select | Refine to admin/org-specific insert/update/delete and selective public read (if needed). |
| `public.ai_processing_logs` / `public.ai_cache` | Legacy `admin_all_*` `public` `ALL` policies overlapping with authenticated admin manage policies | Drop `public` `ALL` policies; rely on authenticated admin checks + targeted SELECT/INSERT rules. |
| `public.authorization_services` / `public.authorizations` et al. | Shared `consolidated_all_4c9184` `public` `ALL` policies | Rework to organization-scoped SELECT/UPDATE without `public` `ALL`. |

