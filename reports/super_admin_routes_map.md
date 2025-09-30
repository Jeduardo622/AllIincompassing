# Super Admin Route Map

| Surface | Method | Path | Source | Auth Guard | Primary Data Touchpoints |
| --- | --- | --- | --- | --- | --- |
| Edge Function | PATCH | `/admin/users/:id/roles` | `supabase/functions/admin-users-roles/index.ts` | `RouteOptions.superAdmin` blocks non-super-admin access. | Updates `profiles` row, logs to `admin_actions`, touches Supabase auth admin API. |
| Edge Function | POST | `/admin/invite` | `supabase/functions/admin-invite/index.ts` | Super admins can target arbitrary organizations; zod validation enforced. | Inserts hashed tokens in `admin_invite_tokens`, calls external email service. |
| Edge Function | POST | `/generate-report` | `supabase/functions/generate-report/index.ts` | Allows super admins to bypass org filters; ensures therapist scope via helper functions. | Aggregates multi-tenant session/billing data via Supabase admin client. |
| Edge Function | POST | `/ai/agent/optimized` | `supabase/functions/ai-agent-optimized/index.ts` | Requires authenticated caller via `getUserOrThrow`; assumed super admin for automation controls. | Calls OpenAI GPT-4o, reads/writes conversation caches via Supabase. |
| Edge Function | POST | `/process-message` | `supabase/functions/process-message/index.ts` | No auth guard—designed as fallback, should be restricted by routing. | Invokes OpenAI `gpt-3.5-turbo` to craft assistant responses; no DB touches. |
| Edge Function | POST | `/assign-therapist-user` | `supabase/functions/assign-therapist-user/index.ts` | Admin route but super admin can cross organizations; ensures org alignment via metadata. | Reads Supabase auth admin user metadata, upserts `clients` rows, logs `admin_actions`. |

## Security Risks
- `process-message` lacks authentication and could expose OpenAI API to anonymous callers; rate limiting or routing controls must block public access.
- `ai-agent-optimized` streams prompts containing PHI into OpenAI; ensure BAA and redaction pipelines exist before production use.
- `/generate-report` grants organization-wide exports; without explicit tenant filters for super admins, a compromised token exposes the entire dataset. 
