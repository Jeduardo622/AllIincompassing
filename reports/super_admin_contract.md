# Super Admin Request/Response Contract

| Endpoint | Method | Required Payload / Params | Optional Controls | Response Shape |
| --- | --- | --- | --- | --- |
| `/admin/users/:id/roles` | PATCH | `{ role: 'client'|'therapist'|'admin'|'super_admin' }`. | `is_active`. | `{ message, user }` or `{ error }` with 400/403/500. |
| `/admin/invite` | POST | `{ email, organizationId?, expiresInHours?, role? }`. | `role` may be `super_admin` (only allowed when caller is super admin). | `{ success: true, inviteUrl, message }` or `{ error, details }`. |
| `/generate-report` | POST | `{ reportType, startDate, endDate }`. | `therapistId`, `clientId`, `status`. | `{ report, metadata }` or `{ error }`. |
| `/ai/agent/optimized` | POST | `{ message: string, context?: Record<string, unknown> }`. | `conversationId`, cached context hints. | `{ response, action?, suggestions?, tokenUsage?, cacheHit? }` or `{ error }`. |
| `/process-message` | POST | `{ message: string, context?: Record<string, unknown> }`. | None. | `{ response, fallback: true, conversationId?, responseTime }` or `{ error }`. |
| `/assign-therapist-user` | POST | `{ userId, therapistId }`. | None. | `{ success, message, data: { userId, therapistId, action, client } }` or `{ error }`. |

## Security Risks
- AI endpoints echo request context verbatim to OpenAI; sanitize before logging to avoid storing PHI in function logs.
- `/assign-therapist-user` implicitly trusts Supabase auth metadata for organization scoping; if metadata missing, admins may assign across tenants inadvertently.
- `/admin/invite` returns `inviteUrl`; ensure the frontend never logs the raw token to prevent reuse. 
