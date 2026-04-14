# WIN-35 parallel streams — advisor snapshot (2026-04-15)

Target project: `wnnjeqheqxxyrgsjmygy`

After applying:

- `20260415100000_unused_index_drop_batch4.sql` (Stream A — unused indexes)
- `20260415110000_admin_actions_consolidated_policy_drop.sql` (Stream B — `admin_actions` legacy `consolidated_*` policies)

## Performance lint counts (post)

| name | count |
| --- | ---: |
| unused_index | 175 |
| multiple_permissive_policies | 110 |
| unindexed_foreign_keys | 8 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| auth_db_connections_absolute | 1 |
| **total** | **301** |

Raw export: [advisors-2026-04-15-performance-post-parallel.json](./advisors-2026-04-15-performance-post-parallel.json)

## Delta vs 2026-04-14 post-apply baseline

Reference prior counts from [advisors-2026-04-14-post-apply.md](./advisors-2026-04-14-post-apply.md): `unused_index` **177**, `multiple_permissive_policies` **112**.

| name | prior (2026-04-14 post) | 2026-04-15 post | delta |
| --- | ---: | ---: | ---: |
| unused_index | 177 | 175 | -2 |
| multiple_permissive_policies | 112 | 110 | -2 |
| unindexed_foreign_keys | 6 | 8 | +2 |

`unused_index` and `multiple_permissive_policies` moved as intended. `unindexed_foreign_keys` churn is treated as advisor noise (no FK DDL in these migrations).

## Verification

- `npm run validate:tenant` — passed after Stream B.
