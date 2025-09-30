# Admins Edge Function Inventory

| Function | Purpose | Input Validation | Key Dependencies |
| --- | --- | --- | --- |
| `admin-users` | Lists admin/staff users for an organization. | Validates `organization_id`, enforces numeric pagination bounds. | `get_admin_users` RPC, `logApiAccess`. |
| `admin-users-roles` | Updates roles/activation flags. | Checks UUID format, restricts role enum, prevents self-demotion or deactivation. | `profiles` table, `admin_actions` log, Supabase auth admin API. |
| `admin-invite` | Issues invite emails for admins. | zod schema ensures email/UUID/hours; deduplicates invites. | `admin_invite_tokens`, `crypto.subtle`, external email service. |
| `get-dashboard-data` | Produces aggregated KPIs for monitoring. | zod schema for date params + request rate limiting. | `sessions`, `clients`, `therapists`, `authorizations`, `billing_records`. |
| `get-authorization-details` | Returns a single authorization with joins. | Requires JSON body `authorizationId`. | `authorizations` table and relations. |
| `generate-report` | Builds CSV-style datasets for admins/therapists. | Checks required fields, ensures role scope, denies clients. | Supabase queries across sessions/clients/billing plus helper resolvers. |

## Security Risks
- `admin-users` logs errors but still returns 500 on RPC failure; repeated attempts could leak stack traces if logging misconfigured.
- `admin-invite` constructs invite URLs using environment variables; mis-set `ADMIN_PORTAL_URL` could generate open redirects. 
