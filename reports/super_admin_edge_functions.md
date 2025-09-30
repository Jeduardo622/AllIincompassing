# Super Admin Edge Function Inventory

| Function | Purpose | Input Validation | Key Dependencies |
| --- | --- | --- | --- |
| `admin-users-roles` | Global role & activation management. | Validates UUIDs, restricts role enum, blocks self-demotion. | `profiles`, `admin_actions`, Supabase auth admin API. |
| `admin-invite` | Multi-tenant admin onboarding. | zod schema, duplicate invite detection, SHA-256 hashing. | `admin_invite_tokens`, external email webhook. |
| `generate-report` | Organization-wide exports for leadership. | Requires reportType/start/end, enforces therapist scope restrictions. | Complex Supabase queries across sessions, clients, billing. |
| `ai-agent-optimized` | GPT-4o orchestration for operations automation. | Confirms authenticated caller; ensures message string. | OpenAI API, conversation cache tables, Supabase admin client. |
| `process-message` | Fallback GPT-3.5 assistant. | Checks message string present; minimal validation. | OpenAI API only. |
| `assign-therapist-user` | Links auth users to therapist/client records across tenants. | Requires userId/therapistId, verifies org alignment, therapist active status. | Supabase auth admin API, `clients`, `admin_actions`. |
| `ai-transcription` & `transcription-retention` | Handle audio transcription + retention policies. | Validate signed URLs/durations; manage retention TTL. | Storage buckets, OpenAI Whisper / supabase storage. |

## Security Risks
- AI-related functions rely on `OPENAI_API_KEY` in environment; compromise would allow arbitrary API spend and potential PHI leakage.
- `assign-therapist-user` writes to `clients` with caller-supplied `userId`; ensure auditing monitors for cross-tenant tampering.
- `transcription-retention` enforces deletion schedules; misconfiguration could leave PHI audio accessible longer than policy allows. 
