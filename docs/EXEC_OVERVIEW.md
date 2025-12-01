# Executive Overview & Context

This document gives leaders and future contributors a concise snapshot of what we are building, how it is hosted, and the operational guardrails already in place.

## Product Mission

- **Audience**: ABA therapy practices that need compliant scheduling, documentation, and analytics tooling.
- **North-star outcomes**:
  - 70 % reduction in therapist documentation time through AI transcription + session-note generation.
  - ≥ 92 % California compliance (objective language, ABA terminology, insurance-ready exports).
  - Secure multi-tenant access model (organizations, admins, therapists, guardians).
- **Recent initiatives**:
  - Tenant isolation hardening (RLS helpers, `app.user_has_role_for_org`, audit logging).
  - Therapist onboarding remediation (runtime-config contract tests, Playwright smoke).
  - AI transcription testing plan (Whisper integration, behavioral markers, compliance scoring).

## Architecture Snapshot

| Layer            | Technologies / Services                                                 |
|------------------|-------------------------------------------------------------------------|
| Frontend         | React + Vite, TypeScript, Tailwind; hosted on Netlify (preview/staging/prod). |
| Backend API      | Supabase Edge Functions (`sessions-hold`, `generate-report`, `admin-*`). |
| Database         | Supabase (Postgres) with preview branching per PR; shared hosted project `wnnjeqheqxxyrgsjmygy`. |
| Auth & Roles     | Supabase Auth; roles (`client`, `therapist`, `admin`, `super_admin`, `dashboard_consumer`). |
| AI Services      | OpenAI (transcription + LLM note generation) via Supabase Edge Functions. |
| Observability    | Structured JSON logging (`getLogger`), metrics (`org_scoped_query_total`, `tenant_denial_total`), GitHub Action artifacts, MCP browser/Lighthouse tooling. |

## Release & Environment Flow

1. **Per-PR previews**
   - Supabase auto-provisions a preview DB for each branch (limit 50).
   - Netlify deploy previews run `npm run preview:smoke:remote`.
2. **Staging (`develop`)**
   - Deploys to Netlify staging context automatically.
   - Migrations applied to the shared Supabase project via branch promotion or `supabase db push`.
   - Secrets: Netlify env vars + GitHub Actions secrets (synced from 1Password).
3. **Production (`main`)**
   - Supabase GitHub integration auto-runs migrations.
   - Netlify production deploy after CI success; preview smoke must pass.
4. **Backups & rollback**
   - Netlify: redeploy prior build from UI.
   - Supabase: restore from backups/PITR; re-run migrations locally to confirm fix.

## Security, Compliance & Access

- **Tenant isolation**: RLS enforced via `organization_id`; helpers (`app.current_user_organization_id`, `app.user_has_role_for_org`, `app.can_access_session/client`). `npm run validate:tenant` ensures no unscoped queries ship.
- **Guardian access**: `public.client_guardians` table with RLS allowing caregivers to see only linked clients (documented in `docs/security/client-guardians.md`).
- **Session holds**: Idempotent hold/confirm/cancel pipeline, conflict codes, audit logging (`session_audit_logs`).
- **Dashboard access**: `dashboard_consumer` role provides read-only RPC access (`get_dashboard_data`).
- **Secrets**: Rotation steps defined in `docs/SECRET_ROTATION_RUNBOOK.md`; Supabase/OpenAI/AWS/SMTP/Test JWTs each have owners and procedures.

## Testing & Tooling Overview

- **Core commands**
  - `npm run lint`, `npm run typecheck`, `npm test`
  - `npm run preview:build`, `npm run preview:smoke`, `npm run preview:smoke:remote`
  - `npm run ci:playwright` (auth + schedule-conflict + therapist onboarding)
  - `npm run contract:runtime-config`, `npm run validate:tenant`, `npm run db:check:security|performance`
- **AI transcription plan**: detailed in `docs/TRANSCRIPTION_TESTING_PLAN.md` (unit, integration, compliance, performance, E2E).
- **MCP tooling**: supabase-database, Lighthouse, Playwright; `scripts/mcp-routing-fix.js` handles server conflicts.

## Current Risks & Watch Items

1. **Tenant isolation regressions** – mitigated by `npm run validate:tenant`, structured logging, and session-hold audit trails.
2. **Secret sprawl** – rotation runbook + 1Password source of truth reduce accidental exposure; `npm run ci:secrets` enforces presence before builds.
3. **AI transcription reliability** – still in staged rollout; confidence + compliance metrics tracked per `docs/TRANSCRIPTION_TESTING_PLAN.md`.
4. **Preview branch limits** – Supabase allows 50 preview DBs; clean up unused PRs promptly or request extension.
5. **MCP routing conflicts** – addressed with server disambiguation, but watch `docs/MCP_ROUTING_TROUBLESHOOTING.md` for new guidance.

## Key References

- `docs/DATABASE_PIPELINE.md` – end-to-end CI/CD flow
- `docs/ENVIRONMENT_MATRIX.md` – environment ↔ secrets matrix
- `docs/STAGING_OPERATIONS.md` – Netlify & Supabase staging playbook
- `docs/security/tenant-isolation.md` – multi-tenant access model
- `docs/onboarding-runbook.md` & `docs/onboarding-status.md` – therapist onboarding remediation
- `AGENTS.md` – hands-on agent workflow & MCP tooling

Keep this overview updated whenever architecture, release practices, or compliance expectations shift so leadership and on-call engineers share the same source of truth.***

