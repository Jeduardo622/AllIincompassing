# 🏥 Database Health Report

## 📊 Overall Health: 🔴 POOR

| Metric | Score | Status |
|--------|-------|--------|
| 🔒 Security | 0/100 | 🔴 Poor |
| ⚡ Performance | 0/100 | 🔴 Poor |
| 📋 Total Issues | 123 | ⚠️ Found |
| 🚨 Critical Issues | 3 | ❌ Action Required |

---

## 🔒 Security Analysis

### 🛡️ Security Advisors (5 issues)

- ⚠️ **WARNING**: Role supabase_admin: superuser=t bypassrls=t canlogin=t
- ⚠️ **WARNING**: Role postgres: superuser=f bypassrls=t canlogin=t
- ⚠️ **HIGH**: Role service_role: superuser=f bypassrls=t canlogin=f
- ⚠️ **HIGH**: Role supabase_etl_admin: superuser=f bypassrls=t canlogin=t
- ⚠️ **HIGH**: Role supabase_read_only_user: superuser=f bypassrls=t canlogin=t

### 🔐 Row Level Security Issues (3 tables)

- ❌ **edi_claim_denials**: RLS not enabled
- ❌ **edi_claim_statuses**: RLS not enabled
- ❌ **edi_export_files**: RLS not enabled

### 🔓 Exposed Functions (27 functions)

- ⚠️ **create_authorization_with_services**: Function is not SECURITY DEFINER
- ⚠️ **update_authorization_documents**: Function is not SECURITY DEFINER
- ⚠️ **current_org_id**: Function is not SECURITY DEFINER
- ⚠️ **has_care_role**: Function is not SECURITY DEFINER
- ⚠️ **update_authorization_with_services**: Function is not SECURITY DEFINER
- ⚠️ **_is_admin**: Function is not SECURITY DEFINER
- ⚠️ **has_role**: Function is not SECURITY DEFINER
- ⚠️ **enforce_session_status_transition**: Function is not SECURITY DEFINER
- ⚠️ **enforce_authorization_status_transition**: Function is not SECURITY DEFINER
- ⚠️ **get_ai_cache_metrics**: Function is not SECURITY DEFINER
- ⚠️ **prevent_feature_flag_plan_history_mutations**: Function is not SECURITY DEFINER
- ⚠️ **log_organization_flag_history**: Function is not SECURITY DEFINER
- ⚠️ **log_organization_plan_history**: Function is not SECURITY DEFINER
- ⚠️ **get_dashboard_data**: Function is not SECURITY DEFINER
- ⚠️ **_is_therapist**: Function is not SECURITY DEFINER
- ⚠️ **get_db_version**: Function is not SECURITY DEFINER
- ⚠️ **enqueue_impersonation_revocation**: Function is not SECURITY DEFINER
- ⚠️ **enqueue_impersonation_revocation**: Function is not SECURITY DEFINER
- ⚠️ **validate_feature_flag_metadata**: Function is not SECURITY DEFINER
- ⚠️ **get_organization_id_from_metadata**: Function is not SECURITY DEFINER
- ⚠️ **trigger_set_timestamp**: Function is not SECURITY DEFINER
- ⚠️ **is_super_admin**: Function is not SECURITY DEFINER
- ⚠️ **set_updated_at**: Function is not SECURITY DEFINER
- ⚠️ **temp_validate_time**: Function is not SECURITY DEFINER
- ⚠️ **update_updated_at_column**: Function is not SECURITY DEFINER
- ⚠️ **validate_organization_metadata**: Function is not SECURITY DEFINER
- ⚠️ **validate_time_interval_new**: Function is not SECURITY DEFINER

---

## ⚡ Performance Analysis

### 🐌 Slow Queries (10 queries)

- 🐌 **3.66ms avg**: SELECT wal->>$5 as type,
       wal->>$6 as schema,
       wal->>$7 as table,
  ...
- 🐌 **3.41ms avg**: SELECT wal->>$5 as type,
       wal->>$6 as schema,
       wal->>$7 as table,
  ...
- 🐌 **3.39ms avg**: select * from realtime.list_changes($1, $2, $3, $4)...
- 🐌 **70.61ms avg**: WITH pgrst_source AS ( SELECT "public"."therapists"."id", "public"."therapists"....
- 🐌 **109.80ms avg**: WITH pgrst_source AS ( SELECT "public"."clients"."id", "public"."clients"."full_...
- _... and 5 more slow queries_

### 📊 Index Issues (73 tables)

- 📊 **user_roles**: More sequential than index scans
- 📊 **roles**: More sequential than index scans
- 📊 **user_therapist_links**: More sequential than index scans
- 📊 **error_logs**: No index usage
- 📊 **sessions**: More sequential than index scans
- _... and 68 more index issues_

### 📦 Largest Tables

- 📦 **clients**: 840 kB
- 📦 **error_logs**: 632 kB
- 📦 **client_therapist_links**: 368 kB
- 📦 **therapists**: 344 kB
- 📦 **assessment_checklist_items**: 336 kB

---

## 💡 Recommendations

- ❌ **SECURITY**: Enable RLS on 3 tables
  - 💡 _Action: ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;_
- ❌ **PERFORMANCE**: Optimize 10 slow queries
  - 💡 _Action: Review query execution plans and add indexes_
- ⚠️ **PERFORMANCE**: Add indexes to 73 tables
  - 💡 _Action: CREATE INDEX ON table_name (column_name);_

---

*Report generated at 3/11/2026, 7:49:25 AM*
*Branch: `local`*
