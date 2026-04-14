# Supabase MCP advisor baseline (2026-04-14)

Target project: `wnnjeqheqxxyrgsjmygy`

## Capture method

- `plugin-supabase-supabase.get_advisors` with `project_id` = `wnnjeqheqxxyrgsjmygy`.
- Raw JSON:
  - Performance: [advisors-2026-04-14-performance.json](./advisors-2026-04-14-performance.json)
  - Security: [advisors-2026-04-14-security.json](./advisors-2026-04-14-security.json)

## Performance lint counts (baseline)

| name | count |
| --- | ---: |
| unused_index | 179 |
| multiple_permissive_policies | 112 |
| unindexed_foreign_keys | 5 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| auth_db_connections_absolute | 1 |
| **total** | **304** |

## Security lint counts (baseline)

| name | count |
| --- | ---: |
| function_search_path_mutable | 2 |
| **total** | **2** |

## Notes

- `multiple_permissive_policies` appears under the **performance** advisor type in this API run; security type returned only `function_search_path_mutable`.
- WIN-35 index work for this cycle: migration `20260414153000_unused_index_drop_batch3.sql` and post-apply summary [advisors-2026-04-14-post-apply.md](./advisors-2026-04-14-post-apply.md).
