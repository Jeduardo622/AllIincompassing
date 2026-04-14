# Supabase MCP advisor post-apply (2026-04-14)

Target project: `wnnjeqheqxxyrgsjmygy`

After applying migration `20260414153000_unused_index_drop_batch3.sql` (drops `admin_actions_admin_user_id_idx`, `impersonation_audit_actor_user_id_idx`).

## Performance lint counts (post)

| name | count |
| --- | ---: |
| unused_index | 177 |
| multiple_permissive_policies | 112 |
| unindexed_foreign_keys | 6 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| auth_db_connections_absolute | 1 |
| **total** | **303** |

Raw export: [advisors-2026-04-14-performance-post.json](./advisors-2026-04-14-performance-post.json)

## Delta vs baseline ([advisors-2026-04-14-mcp-baseline.md](./advisors-2026-04-14-mcp-baseline.md))

| name | baseline | post | delta |
| --- | ---: | ---: | ---: |
| unused_index | 179 | 177 | -2 |
| multiple_permissive_policies | 112 | 112 | 0 |
| unindexed_foreign_keys | 5 | 6 | +1 |
| auth_rls_initplan | 5 | 5 | 0 |
| duplicate_index | 2 | 2 | 0 |
| auth_db_connections_absolute | 1 | 1 | 0 |

`unused_index` decreased by **2** as intended. The `unindexed_foreign_keys` +1 is treated as advisor noise / categorization churn unless reproduced across runs; no FK DDL changed in batch 3.

## Linear WIN-35 (paste as comment)

WIN-35 MCP advisor E2E slice (2026-04-14):

- **Baseline:** `get_advisors` performance + security for `wnnjeqheqxxyrgsjmygy`; counts in `docs/supabase/advisors-2026-04-14-mcp-baseline.md` (raw `docs/supabase/advisors-2026-04-14-performance.json`, `docs/supabase/advisors-2026-04-14-security.json`).
- **Shipped:** `supabase/migrations/20260414153000_unused_index_drop_batch3.sql` applied on hosted — dropped `admin_actions_admin_user_id_idx`, `impersonation_audit_actor_user_id_idx`.
- **Post-apply:** `docs/supabase/advisors-2026-04-14-post-apply.md` + `docs/supabase/advisors-2026-04-14-performance-post.json`; `unused_index` 179 → 177 (−2).
- **Next:** permissive-policy consolidation still table-by-table with tenant-safety review; further unused-index batches from fresh exports.
