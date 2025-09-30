# Admins Request/Response Contract

| Endpoint | Method | Required Payload / Params | Optional Controls | Response Shape |
| --- | --- | --- | --- | --- |
| `/admin/users` | GET | `organization_id` query param (UUID). | `page`, `limit`, `search`. | `{ users: User[], pagination, filters }` or `{ error }` with 4xx/5xx. |
| `/admin/users/:id/roles` | PATCH | JSON `{ role: 'client'|'therapist'|'admin'|'super_admin' }`. | `is_active` boolean. | `{ message, user }` or `{ error }`; 403 when attempting to demote self. |
| `/admin/invite` | POST | `{ email, organizationId?, expiresInHours?, role? }`. | None beyond defaults. | `{ inviteUrl, expiresAt, deliveryStatus }` (implicit via success message) or structured error. |
| `/dashboard/data` | GET | Headers only. | `start_date`, `end_date` query parameters. | `{ success: true, data: DashboardData, parameters, lastUpdated, requestId }` or error envelope. |
| `/get-authorization-details` | POST | `{ authorizationId }`. | None. | `{ authorization }` or `{ error }` with status 400 on missing ID. |
| `/generate-report` | POST | `{ reportType, startDate, endDate }`. | `therapistId`, `clientId`, `status`. | `{ report: { rows, metadata } }` or structured error with 400/403/500. |

## Security Risks
- `/admin/invite` surfaces detailed zod validation errors; leaking schema keys is acceptable, but ensure error payloads never echo normalized email or organization IDs in plaintext logs.
- `/dashboard/data` calculates attendance/utilization on the fly; repeated invocations could create timing side-channels revealing session volume trends even when data masked elsewhere.
- `/admin/users/:id/roles` writes `admin_actions` without verifying logging success; if insert fails silently, audit trail gaps emerge. 
