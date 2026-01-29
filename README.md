# AllIncompassing Scheduling Platform

AllIncompassing delivers therapist scheduling, billing, and operational telemetry for behavioral health practices. The application couples a React front end with Supabase-backed APIs, database policies, and edge functions so that teams can manage session holds, confirmations, cancellations, and downstream reporting from a single workspace.

## At a glance

- **Therapy-specific booking flows** – Session holds coordinate with confirmation and cancellation paths, rounding durations to compliant 15-minute blocks while preventing double booking across therapists and clients.
- **Billing-ready data** – CPT code derivation, modifier enrichment, and hold lifecycles persist structured billing rows that mirror the database schema and analytics jobs.
- **Role-aware access** – Row Level Security (RLS) and the RBAC roles in Supabase ensure clients, therapists, admins, and super admins can only reach the data they are permitted to view or mutate.
- **User documentation hub** – Centralized Documentation page with search, categorized sections (AI session notes, therapist uploads, client documents, authorization files), and download capabilities for all authenticated users.
- **Operational diagnostics** – Health reports, route audits, and automated security checks keep migrations, RPCs, and edge functions aligned with production expectations.

## Architecture overview

### Frontend (React + Vite)

- **Framework** – React 18 + Vite with TypeScript, Tailwind CSS, TanStack Query, and React Hook Form provide the scheduling UI, dashboards, and workflow modals defined in `src/`.
- **Runtime configuration bootstrap** – `ensureRuntimeSupabaseConfig` loads `/api/runtime-config` before rendering `<App />`, guaranteeing that `supabaseUrl`, `supabaseAnonKey`, and optional `supabaseEdgeUrl` values are ready for API clients and feature flags.
- **Developer diagnostics** – `BootDiagnostics` and the development error boundary expose Supabase bootstrap errors with actionable messaging while retaining a strict-mode React tree.

### Supabase platform

- **Postgres schema & migrations** – SQL migrations under `supabase/migrations` capture session holds, CPT bookkeeping, telemetry hardening, and auth policies. Generated TypeScript types (`npm run typegen`) keep the front end synchronized with schema drift.
- **Edge functions** – Deployed functions cover auth flows, schedule automation (e.g., hold confirmations, alternative suggestions), AI-assisted tooling, and reporting. The routing audit script tracks expected `/functions/v1/*` endpoints.
- **Security controls** – RLS, role-specific policies, and automated audits (`npm run db:check:security`) guard telemetry tables, AI caches, and booking data from overexposure.

### Data & workflow orchestration

- **Hold → confirm pipeline** – Booking requests go through an idempotent hold workflow backed by Supabase edge functions, guaranteeing consistent responses when clients retry with the same `Idempotency-Key`.
- **CPT enrichment** – Server utilities compute CPT codes, modifiers, and rounded durations before persisting them for billing reconciliation and analytics.
- **Concurrency safety** – Integration tests simulate conflicting hold attempts to ensure that only one session confirmation succeeds and competing holds are cancelled cleanly.

## Environment & setup

### Prerequisites

- **Node.js 18+** and npm or another package manager supported by the repo (pnpm, yarn).
- **Supabase CLI** (installed globally or via `npx`) with access to the project reference `wnnjeqheqxxyrgsjmygy`.
- **Environment variables** available in your shell: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ACCESS_TOKEN`.
- **Vite runtime env file** – copy `.env.example` to `.env.codex` (preferred) or `.env`, then replace every `****` placeholder. The runtime loader in `src/server/env.ts` reads `.env.codex` by default, so keeping that filename avoids additional configuration. Provide `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPABASE_EDGE_URL` values that mirror the non-prefixed Supabase settings.

> ℹ️ Run `./scripts/setup.sh` to validate Supabase credentials, generate database types, and create the `.env` file automatically. The script also configures `~/.supabase/config.toml` for non-interactive CLI sessions.

### Bootstrapping the app

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.codex` and populate the placeholders (or rerun `./scripts/setup.sh` after exporting Supabase variables).
3. Start the development server: `npm run dev`
4. Optional helpers:
   - `npm run dev:clean` – clear caches before launching Vite.
   - `npm run clear-cache` – remove cached API responses and generated artifacts used during tests.

## Development workflow

### Quality gates & local testing

| Task | Command |
| --- | --- |
| Lint TypeScript & React files | `npm run lint` |
| Unit tests (Vitest) | `npm test` |
| CI-aligned unit tests + coverage | `npm run test:ci` |
| Coverage report | `npm run test:coverage` |
| Secrets preflight | `npm run ci:secrets` |
| Focused/Skipped test guard | `npm run ci:check-focused` |
| Coverage threshold verification | `npm run ci:verify-coverage` |
| Type checking | `npm run typecheck` |
| UI test runner | `npm run test:ui` |
| Cypress end-to-end suite | `npm run test:e2e` or `npm run test:e2e:open` |
| Route integrity tests | `npm run test:routes` or `npm run test:routes:open` |

> CI fails if `.only`/`.skip` usages slip outside `tests/utils/testControls.ts` or if line coverage drops below 85% in
> `coverage/coverage-summary.json`. Run the focus guard and coverage verification commands locally before opening a PR.

### CI pipeline stages

The main CI workflow (`.github/workflows/ci.yml`) runs the following stages in order:

1. Secrets validation, service-role audit, conditional Supabase type generation, lint, and type-check.
2. Unit tests with coverage enforcement and an RLS guard to ensure the Supabase environment executed correctly.
3. **Build canary** – `npm run build` compiles the production bundle so build regressions are caught before deploy previews.
4. **Preview smoke** – when a deploy-preview URL is exposed (`PREVIEW_URL`, `DEPLOY_PRIME_URL`, or `URL`), CI runs `npm run preview:smoke -- --url "$PREVIEW_URL"` to verify `/api/runtime-config` responds with Supabase credentials, Supabase auth is healthy, and the root HTML renders. The job fails automatically on non-200 responses or missing runtime config keys.

If the smoke test fails, re-run it locally with the preview URL shown in the workflow logs. Use `npm run preview:smoke -- --url <deploy-preview>` to reproduce the failure, and inspect the masked runtime-config output to confirm Supabase values are wired correctly.

### Supabase connection diagnostics

- Connection diagnostics automatically execute only in Vite development builds so production deployments do not trigger auth, table, or RPC probes on every boot.
- To force diagnostics in another environment, export `VITE_ENABLE_CONNECTION_DIAGNOSTICS=true` before running the app (e.g., `VITE_ENABLE_CONNECTION_DIAGNOSTICS=true npm run dev`). Set the flag to `false` to explicitly disable the checks.
- The helper `verifyConnection()` in `src/lib/supabase.ts` can be invoked manually from dev tools or scripts. Each intentional run logs `[supabase] Running connection diagnostics` and `[supabase] Starting connection diagnostics checks` in the console for easy traceability.

### Supabase migrations & health tooling

- Create a new database branch for experimentation: `npm run db:branch:create`
- Remove stale preview branches: `npm run db:branch:cleanup`
- Generate diff-based migrations with the Supabase CLI (`supabase migration new` or `supabase db diff --use-migrations`) and commit SQL under `supabase/migrations/`.
- After applying migrations, regenerate types with `npm run typegen`.
- Review database security, performance, and health dashboards:
  - `npm run db:check:security`
  - `npm run db:check:performance`
  - `npm run db:health:report` (markdown summary)
  - `npm run db:health:production` (production-grade diagnostics)
  - `npm run pipeline:health` (aggregates the security, performance, and health report checks)

### Edge function & API workflows

- Audit Supabase routes against expected edge and RPC functions: `npm run audit:routes`
- Generate stubs for missing routes and functions when scaffolding new APIs: `npm run fix:routes`
- Deploy updates with the Supabase CLI: `supabase functions deploy <name> --project-ref wnnjeqheqxxyrgsjmygy`
- Authentication utilities:
  - `npm run verify-auth` – ensure required auth functions and policies exist.
  - `npm run auth:fix` and `npm run auth:test` – apply and validate auth repairs.
- Bolt sync utilities (`npm run bolt:sync:create`, `npm run bolt:sync:from`) mirror Supabase state into documentation or regression tests.

## Reference documentation

- [docs/AUTH_ROLES.md](docs/AUTH_ROLES.md) – RBAC hierarchy, permissions, and RLS policies across profiles, sessions, and billing tables.
- [docs/DATABASE_PIPELINE.md](docs/DATABASE_PIPELINE.md) – Step-by-step ingestion pipeline for Supabase migrations, seeds, and CI validation.
- [docs/MCP_ROUTING_TROUBLESHOOTING.md](docs/MCP_ROUTING_TROUBLESHOOTING.md) – Troubleshooting guide for multi-channel routing and API backplanes.
- [docs/SEEDING.md](docs/SEEDING.md) – Controlled data seeding flows for Supabase environments.
- [docs/SESSION_HOLD_CONTRACT.md](docs/SESSION_HOLD_CONTRACT.md) & [docs/SESSION_HOLD_CONFLICT_CODES.md](docs/SESSION_HOLD_CONFLICT_CODES.md) – Session hold payload contracts, retry semantics, and conflict reason catalogues.
- [README_SCHEDULING_TESTS.md](README_SCHEDULING_TESTS.md) – Detailed coverage of scheduling UI and server tests.
- [reports/diagnostic_summary.md](reports/diagnostic_summary.md) – Narrative walkthrough of the booking pipeline and outstanding considerations.
- [reports/feature_matrix.md](reports/feature_matrix.md) – Evidence-backed status of booking, billing, and concurrency features.

## Troubleshooting

### Runtime configuration bootstrap

- Confirm `/api/runtime-config` returns JSON with `supabaseUrl` and `supabaseAnonKey`. Missing keys trigger the red error state rendered by `RuntimeConfigError` in `src/main.tsx`.
- Validate that `ensureRuntimeSupabaseConfig` is called before attempting to construct clients (e.g., `src/lib/supabaseClient.ts`, `src/lib/ai.ts`). Accessing Supabase helpers before the promise resolves will throw `Supabase runtime configuration has not been initialised`.
- If the client cached an outdated config, run `npm run dev:clean` and restart the dev server to clear local storage and cached runtime settings.

### Data refresh & caching

- React Query refreshes on window focus, so switching tabs or returning to the browser should refetch active queries.
- Route changes and Settings tab switches invalidate active queries; if a view still looks stale, confirm it uses TanStack Query instead of local-only state.
- Use `npm run dev:clean` if you suspect cached responses or runtime settings are masking fresh data.

### Telemetry & logging

- Use the PHI-safe logger utilities in `src/lib/logger` for any console or telemetry emission. Direct `console.*` calls bypass redaction and will fail under the Vitest console guard.
- Update `redactPhi` and associated console guard patterns when introducing new sensitive identifiers, and add regression tests in `src/lib/__tests__/loggerRedaction.test.ts` to confirm masking.
- When telemetry ingestion fails, inspect generated health reports (`npm run db:health:report`) for exposed functions or missing policies across telemetry tables.

### Supabase CLI hiccups

- Re-export Supabase environment variables and rerun `./scripts/setup.sh` if CLI commands begin prompting for auth.
- Ensure `CYPRESS_INSTALL_BINARY=0` when you do not require Cypress binaries in CI (the setup script sets this automatically unless `CYPRESS_RUN=true`).

With these workflows and references, contributors can confidently extend AllIncompassing’s scheduling, billing, and telemetry capabilities while keeping Supabase infrastructure in sync.

### Accessibility conventions

- Provide `aria-label` for icon-only buttons and controls.
- Ensure every `input`, `select`, and `textarea` has a corresponding `label` with `htmlFor`/`id`.
- Hide decorative icons with `aria-hidden="true"`.
- Maintain a single `role="main"` landmark per page.

### Route canonicalization

- Monitoring route canonicalized to `/monitoring` (was `/monitoringdashboard`). Update links accordingly.
