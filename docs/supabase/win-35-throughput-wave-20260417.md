# WIN-35 throughput wave (2026-04-17)

Target project: `wnnjeqheqxxyrgsjmygy`

## PR closure

- [PR #431](https://github.com/Jeduardo622/AllIincompassing/pull/431) merged to `main` before this wave (four-stream slice + prior parallel migrations).

## `route-task` (per stream)

Each stream touches only `supabase/migrations/**` (index-only DDL).

| stream | classification | lane | why |
| --- | --- | --- | --- |
| **Alpha** | high-risk human-reviewed | critical | migrations path; bounded `DROP INDEX IF EXISTS` |
| **Beta** | high-risk human-reviewed | critical | migrations path; disjoint tables from alpha |
| **Gamma** | high-risk human-reviewed | critical | migrations path; disjoint tables from alpha/beta |

- **Linear required:** yes (WIN-35 linkage via comment).
- **Mandatory checks:** `node scripts/ci/check-migration-governance.mjs`, `npm run lint`, `npm run typecheck`, `npm run ci:check-focused`, `npm run validate:tenant` (belt-and-suspenders after DDL batch).

## Wave size (3 streams, 15 index drops)

**Why three streams:** Fifteen drops split across **three disjoint table groups** (5+5+5) keeps each migration reviewable, preserves numeric ledger order (`17100000` → `17110000` → `17120000`), and avoids mixing unrelated high-risk surfaces (no `session_holds` / `sessions` FK helpers in this wave).

**Rejected**

- **Fourth parallel stream:** Would add shared doc churn without more disjoint low-risk index surfaces already validated in the same advisor export; not justified vs three mechanical lanes.
- **Policy stream (`insurance_providers` / `service_areas` / `ai_processing_logs`):** Policy names and overlap semantics are not fully anchored in-repo for a one-line redundant drop; `ai_processing_logs` INSERT overlap is not clearly equivalent to dropping `ai_processing_logs_admin_manage_admin_manage` without deeper review.
- **FK / `unindexed_foreign_keys` remediation:** Explicitly out of scope for this wave (higher blast radius than unused-index retirement).

## Migrations (apply order)

1. `20260417100000_unused_index_drop_throughput_alpha_win35.sql`
2. `20260417110000_unused_index_drop_throughput_beta_win35.sql`
3. `20260417120000_unused_index_drop_throughput_gamma_win35.sql`

## Pre-wave advisor snapshot

Raw: [advisors-2026-04-17-win35-throughput-pre.json](./advisors-2026-04-17-win35-throughput-pre.json) (captured after PR #431 merge; same logical state as hosted post–2026-04-16 wave).

Post-apply row counts are recorded below after hosted apply.

## Post-apply advisor snapshot (hosted)

| name | count |
| --- | ---: |
| unused_index | 152 |
| multiple_permissive_policies | 107 |
| unindexed_foreign_keys | 23 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| auth_db_connections_absolute | 1 |
| **total** | **290** |

Raw: [advisors-2026-04-17-win35-throughput-post.json](./advisors-2026-04-17-win35-throughput-post.json)

**Delta vs pre-wave:** `unused_index` **167 → 152** (−15). `multiple_permissive_policies` unchanged. `unindexed_foreign_keys` **15 → 23** (advisor churn; no FK DDL in this wave).

## Specialist / delegated review

- **code-review-engineer (Task):** approved with minor nits — standard `unused_index` caveats (stats-based signal; watch audit/orchestration/notes/EDI latency after deploy).
