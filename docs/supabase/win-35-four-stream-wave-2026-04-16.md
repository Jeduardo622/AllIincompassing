# WIN-35 four-stream wave — S4 triage (2026-04-16)

Target project: `wnnjeqheqxxyrgsjmygy`  
Raw export: [advisors-2026-04-16-win35-four-stream-performance.json](./advisors-2026-04-16-win35-four-stream-performance.json)

## Wave-start performance lint counts

| name | count |
| --- | ---: |
| unused_index | 175 |
| multiple_permissive_policies | 110 |
| unindexed_foreign_keys | 8 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| **total** | **301** |

## `unused_index` — top tables (ranked)

Excludes scheduling-hot paths from **implementation** picks (`session_holds`, `sessions`, etc. remain in advisor output for visibility only).

| count | table |
| ---: | --- |
| 7 | session_holds |
| 6 | client_guardians |
| 5 | sessions |
| 5 | authorizations |
| 5 | query_performance_metrics |
| 5 | feature_flag_audit_logs |
| 4 | profiles |
| 4 | session_note_pdf_exports |
| 4 | session_cpt_entries |
| 4 | service_contracts |
| 4 | goal_versions |
| 4 | session_goals |
| 4 | impersonation_audit |
| 4 | client_onboarding_prefills |
| 4 | guardian_link_queue |
| 4 | ai_cache |
| 4 | organization_feature_flags |
| 3 | clients |
| 3 | feature_flag_plan_history |

## `multiple_permissive_policies` — sample targets (by table)

Notable overlaps include `public.ai_cache` (`ai_cache_admin_manage` vs org-scoped `*_scope` policies with equivalent admin predicates per `20251111103000_rls_phase3.sql`), `insurance_providers`, `service_areas`, `user_therapist_links`, `ai_processing_logs`, `ai_session_notes`, `authorization_services`.

## Pre-assigned migration version bands (this wave)

| stream | version | file (planned) |
| --- | --- | --- |
| **S1 — Index Alpha** | `20260416100000` | `20260416100000_unused_index_drop_alpha_win35.sql` |
| **S2 — Index Beta** | `20260416110000` | `20260416110000_unused_index_drop_beta_win35.sql` |
| **S3 — Policy (one table)** | `20260416120000` | `20260416120000_ai_cache_admin_manage_policy_drop.sql` |

Merge order: S1 → S2 → S3 (numeric).

## Disjoint index picks (S1 vs S2)

**S1 (Alpha)** — `client_guardians` + `clients` audit-style `*_by_idx` (4 drops):

1. `public.client_guardians_created_by_idx`
2. `public.client_guardians_deleted_by_idx`
3. `public.client_guardians_updated_by_idx`
4. `public.clients_deleted_by_idx`

**S2 (Beta)** — disjoint tables: `feature_flags`, `organization_plans`, `function_idempotency_keys` (4 drops):

1. `public.feature_flags_created_by_idx`
2. `public.feature_flags_updated_by_idx`
3. `public.organization_plans_assigned_by_idx`
4. `public.function_idempotency_keys_endpoint_created_idx`

## S3 — single-table policy consolidation

**Table:** `public.ai_cache`  
**Action:** `DROP POLICY IF EXISTS ai_cache_admin_manage` inside `DO $$ … to_regclass` guard.  
**Rationale:** `ai_cache_insert_scope`, `ai_cache_select_scope`, and `ai_cache_delete_scope` already express the same admin-only access pattern introduced in `20251111103000_rls_phase3.sql`, so `ai_cache_admin_manage` is redundant permissive overlap (advisor `multiple_permissive_policies`).

## Linear ownership

Child issues under **WIN-35**: [WIN-104](https://linear.app/winningedgeai/issue/WIN-104) (S1), [WIN-105](https://linear.app/winningedgeai/issue/WIN-105) (S2), [WIN-106](https://linear.app/winningedgeai/issue/WIN-106) (S3). PR link and advisor deltas are recorded at wave close on the parent issue.

## Post-apply (hosted, 2026-04-16)

After applying S1–S3 in numeric order (`node scripts/apply-single-migration.mjs` per file):

| name | count |
| --- | ---: |
| unused_index | 167 |
| multiple_permissive_policies | 107 |
| unindexed_foreign_keys | 15 |
| auth_rls_initplan | 5 |
| duplicate_index | 2 |
| **total** | **297** |

Raw export: [advisors-2026-04-16-win35-four-stream-performance-post-apply.json](./advisors-2026-04-16-win35-four-stream-performance-post-apply.json)

Delta vs wave-start table above: `unused_index` **−8**, `multiple_permissive_policies` **−3**; `unindexed_foreign_keys` churn documented in [advisors-migration-summary.md](../advisors-migration-summary.md).

**PR:** https://github.com/Jeduardo622/AllIincompassing/pull/431
