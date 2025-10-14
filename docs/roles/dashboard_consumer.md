### Dashboard Consumer Role

- **Purpose**: Grants read-only access to analytics RPCs (e.g., `get_dashboard_data`) without broad table privileges; intended for BI tooling and dashboards that must never mutate tenant data.  
- **Provisioning**: Create the database role via SQL (`CREATE ROLE dashboard_consumer;`) and grant execute on `get_dashboard_data()` only—see `supabase/migrations/20251223104500_harden_dashboard_access.sql`. No direct table grants are required because RLS remains in force.  
- **Client Configuration**: Applications authenticating as `dashboard_consumer` should use a dedicated service key or impersonation flow, ensuring the role is mapped to a trusted Supabase user context. Document the credential hand-off in your secrets manager.  
- **Operational Notes**: Monitor usage through the structured logs emitted by `getLogger` (look for `functionName=generate-report` or dashboards invoking the RPC). If dashboards require new datasets, add corresponding RLS-safe views rather than widening grants.  
- **Revocation & Rotation**: Rotate credentials alongside other service accounts; remove EXECUTE on the RPC before dropping the role to avoid orphaned privileges. Track role membership changes in change-management tickets.  
