# Super Admin Supabase Static Assets

| Object | Type | Source Reference | Purpose | Security Controls |
| --- | --- | --- | --- | --- |
| `admin_actions` table | Postgres table | Appended by `admin-users-roles` and `assign-therapist-user`. | Central audit log for privileged changes. | Should be append-only with super-admin read access for compliance review. |
| `admin_invite_tokens` table | Postgres table | Seeded when super admins invite other tenants. | Stores hashed tokens + expiry for onboarding. | Must ensure hashed tokens remain secret; cleanup jobs should purge expired entries. |
| `profiles` table | Postgres table | Modified globally by super admins for cross-tenant management. | Houses roles/activation state for all users. | Enforce RLS that only super admins bypass `organization_id` filters. |
| `ai_conversations` store | Table/Bucket (see `ai-agent-optimized` references). | Persists conversation context between AI calls. | Should limit read/write to system automation keys; may contain PHI. |
| `clients` table | Postgres table | Upserted cross-tenant by `assign-therapist-user`. | Allows forced linkage between auth users and client records. | Without `organization_id` constraints, super admins could accidentally attach to wrong tenant. |

## Security Risks
- Super admins wield service role clients; any compromised credential allows unrestricted modification of `profiles` and `clients` tables.
- AI conversation storage retains prompts/responses; apply encryption or TTL to reduce PHI retention risk.
- Lack of cross-tenant guardrails when super admins run reports may inadvertently expose aggregated metrics in shared dashboards. 
