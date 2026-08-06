# Repo Memo: Tech Stack, Agents, Skills, MCP, Workflow

This memo captures the current repository operating baseline in one place.

## 1) Tech Stack

### Application

- Frontend: React 18 + TypeScript
- Build/dev server: Vite
- Routing: React Router (`react-router-dom`)
- Forms/validation: React Hook Form + Zod
- Client state: Zustand
- Async state/data fetching: TanStack React Query
- Charts/date utilities: Chart.js, `react-chartjs-2`, `date-fns`, `date-fns-tz`

### Backend/Data Platform

- Primary backend platform: Supabase (`@supabase/supabase-js`)
- Postgres access/tooling: `pg`

### Styling

- Tailwind CSS + PostCSS + Autoprefixer

### Testing/Quality

- Unit/integration: Vitest + Testing Library + jsdom
- Browser/e2e: Cypress + Playwright
- Linting/type safety: ESLint + TypeScript (`tsc --noEmit`)

### CI/Delivery Context

- Policy-heavy CI checks (`scripts/ci/**`)
- Netlify deployment context (see high-risk handling in `AGENTS.md`)
- Husky enabled for local git hooks

## 2) Agents and Subagents

### Codex Custom Agents (`.codex/agents`)

The lane-contract agent names below should exist as Codex custom-agent TOML files:

- `specification-engineer`
- `software-architect`
- `implementation-engineer`
- `code-review-engineer`
- `test-engineer`
- `security-engineer`
- `performance-engineer`
- `devops-engineer`
- `documentation-engineer`
- `debugging-specialist`
- `refactoring-specialist`

Compatibility / repo-specific Codex agents:

- `reviewer` — compatibility alias for `code-review-engineer`
- `tester` — compatibility alias for `test-engineer`
- `test-isolation` — low-risk deterministic-test specialist
- `ui-hardener` — low-risk UI hardening specialist
- `supabase-reviewer` — migrations, RLS, grants, RPC exposure, functions, and tenant-boundary review
- `netlify-deploy-reviewer` — Netlify build/deploy, redirect, function, and env-var review

### Repo-Defined Cursor Agents (`.cursor/agents`)

- `aba-ops-coordinator`
- `code-reviewer`
- `docs-updater`
- `supabase-architect`
- `supabase-auth-engineer`
- `supabase-edge-functions-engineer`
- `supabase-engineer`
- `supabase-migration-engineer`
- `supabase-performance-engineer`
- `supabase-rls-engineer`
- `supabase-schema-engineer`

### Operational Subagent Model

- One primary orchestrator (AI CTO operating pattern)
- `route-task` chooses the lane and emits the required Codex agent sequence.
- Named Codex agents should map directly to the lane-contract roles.
- Use Supabase and Netlify specialist agents whenever platform, deploy, tenant, or runtime boundaries are in scope.

## 3) Installed Skills

### Repo Workflow Skills (`.agents/skills`)

- `route-task`
- `verify-change`
- `pr-hygiene`
- `auth-routing-guard`
- `supabase-tenant-safety`
- `playwright-regression-triage`
- `clinical-data-parity-auditor`

### Cursor Skills In Repo (`.cursor/skills`)

- `database-seeding`
- `db-health-check`
- `mcp-routing-troubleshooting`
- `migration-workflow`
- `playwright-e2e-execution`
- `preview-smoke-testing`
- `rls-policy-testing`
- `secret-rotation-runbook`
- `session-hold-booking-workflow`
- `staging-deployment-operation`
- `supabase-branch-management`
- `tenant-isolation-validation`
- `therapist-onboarding-workflow`

## 4) MCP Servers

The workspace has these MCP servers enabled:

- `user-playwright`
- `user-eamodio.gitlens-extension-GitKraken`
- `plugin-linear-linear`
- `plugin-postman-postman`
- `plugin-supabase-supabase`
- `cursor-ide-browser`

### Typical Usage

- `plugin-linear-linear`: Linear issue/project workflows
- `plugin-postman-postman`: API collections/specs/testing workflows
- `plugin-supabase-supabase`: Supabase operations and platform tasks
- `user-playwright` and `cursor-ide-browser`: browser automation, UI checks, and interactive page validation
- `user-eamodio.gitlens-extension-GitKraken`: Git/GitLens-integrated repository context

### MCP Operating Rule

Codex-specific MCP servers belong in `.codex/config.toml`. Cursor plugin MCP servers remain configured in Cursor/plugin settings. Do not assume project `.env` files are injected into MCP server processes.

- Always inspect the MCP tool schema/descriptor before calling an MCP tool.
- If an MCP server exposes an `mcp_auth` tool, authenticate it before use.
- Treat deploy-capable MCP tools as production-sensitive even when CLI command rules exist; require explicit approval and repo policy review before invoking them.

## 5) Workflow Contract (How Work Gets Done)

Source of truth: `AGENTS.md` + `docs/ai/cto-lane-contract.md` + `docs/ai/verification-matrix.md`.

### Lane Routing (before implementation)

Choose exactly one lane:

- `fast`: docs/process or small low-risk UI/content updates
- `standard`: non-trivial code/config outside high-risk paths
- `critical`: any high-risk paths or high-risk behavior (auth, RLS, tenant boundaries, CI/deploy sensitive)
- `blocked`: unclear scope; no implementation until clarified

### Required Sequence (non-trivial)

1. Create `codex/*` branch
2. Create/confirm Linear issue (required for high-risk)
3. Run `route-task` and emit `classification` + `lane`
4. Execute implementation with required specialist agents
5. Run required checks (per verification matrix/lane)
6. Run `verify-change` and produce verification card
7. Run `pr-hygiene` and get `pr-ready` verdict
8. Push branch and open PR for human review

### Mandatory Check Pattern (lane-based)

- `fast`: lint, typecheck, targeted tests (or `npm test`), build
- `standard`: `ci:check-focused`, lint, typecheck, `test:ci`, build (+ route/auth browser checks as needed)
- `critical`: `ci:check-focused`, lint, typecheck, `test:ci`, build + domain gates (tenant validation, route/auth/session browser checks)

When no secrets/protected systems are needed, run `npm run verify:local`.

### Hard Rules

- Never bypass lint/typecheck/tests/policy checks.
- Escalate immediately to `critical` if scope touches high-risk paths/behaviors.
- Do not complete non-trivial work without verification artifact + PR hygiene verdict.
- Use bounded PR check polling; no indefinite waits.

### Agent Work Ledger Boundary

- Use Linear plus the relevant markdown handoff for engineering planning, execution evidence, and review state. Do not send engineering issues, prompts, code, or review content to the tenant-scoped Agent Work Ledger.
- Application callers may invoke only the fixed IEHP assessment-preparation and CalOptima draft-review workflows documented in `docs/ops/agent-work-ledger-caller-adoption.md`.
- The authenticated Edge boundary derives actor, organization, client, graph, approval, and runtime authority. Callers provide only the fixed route payload and stable identifiers defined by the contract.
- `disabled`, `shadow`, and `advisory` are the complete runtime set; `active` is forbidden. Any Ledger boundary change routes `critical` and requires `supabase-tenant-safety` plus human review.

