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

### Repo-Defined Agents (`.cursor/agents`)

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
- Specialist subagents activated based on task/risk:
  - `research-engineer`
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
- Supabase platform subagents are used when data/auth/RLS/migrations/functions are in scope.

## 3) Installed Skills

### Repo Workflow Skills (`.agents/skills`)

- `route-task`
- `verify-change`
- `pr-hygiene`
- `auth-routing-guard`
- `supabase-tenant-safety`
- `playwright-regression-triage`

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

- Always inspect the MCP tool schema/descriptor before calling an MCP tool.
- If an MCP server exposes an `mcp_auth` tool, authenticate it before use.

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

