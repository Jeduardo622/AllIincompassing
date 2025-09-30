# Admins Supabase Static Assets

| Object | Type | Source Reference | Purpose | Security Controls |
| --- | --- | --- | --- | --- |
| `profiles` table | Postgres table | Patched via `admin-users-roles` and read in UI management screens. | Stores role assignments, names, activation flags. | Policies must block admins from modifying users outside their organization except super admins. |
| `admin_invite_tokens` table | Postgres table | Inserted/read in `admin-invite` flow. | Tracks pending invites with hashed tokens + expiration. | Should only be accessible to admin service role; ensure tokens hashed before persistence. |
| `admin_actions` table | Postgres table | Logged inside `admin-users-roles` after role changes. | Provides audit trail of administrative actions. | Requires append-only policy; normal admins should not edit historical rows. |
| `authorizations` table | Postgres table | Accessed by `get-authorization-details` and dashboard metrics. | Contains payer approval metadata and linked services. | Must enforce client-organization scoping; leaking cross-org authorizations exposes PHI. |
| `billing_records` table | Postgres table | Summed in `get-dashboard-data` for revenue metrics. | Captures payment ledger. | Should restrict reads to finance staff; currently any admin hitting the dashboard sees global totals. |

## Security Risks
- Dashboard queries run with `createRequestClient`, inheriting caller's RLS scope; if policies allow cross-org reads, aggregated KPIs could reveal multi-tenant revenue and attendance data.
- `admin_invite_tokens` cleanup is absent; expired rows may accumulate, increasing chance of brute-forcing hashed tokens if size grows without rotation.
- `admin_actions` logging failures are swallowed; if policies reject insert due to missing org context, no alert surfaces for compliance teams. 
