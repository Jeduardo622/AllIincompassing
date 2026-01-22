---
description: 
alwaysApply: true
---

---
description: 
alwaysApply: true
---

# Agent Operations Guide

This guide gives Codex agents and future automation a single place to reference project guardrails, tool access, and expected workflows.

## Repository Boundaries

- **Writable directories**
  - `src/**`, `supabase/migrations/**`, `supabase/functions/**`
  - `docs/**`, `AGENTS.md`, runbooks, and other markdown documentation
  - `.github/**`, `infra/**`, `Dockerfile`, `.supabase/config.toml`, `.env`
  - Any credentials stored outside version control (1Password, Supabase dashboard)
- **Coding standards**
  - TypeScript/React follow the repo ESLint + Prettier rules; run `npm run lint` before submitting patches.
  - Use **named exports** only; no default exports.
  - Every logic change requires a Jest/Vitest test (minimum command: `npm test` or the relevant focused suite).
  - Maintain ≥ 90 % coverage; CI (`npm run ci:verify-coverage`) enforces this threshold.

## MCP Tooling

| MCP server              | Command / location                                           | Primary tools                                               | Notes |
|-------------------------|-------------------------------------------------------------|-------------------------------------------------------------|-------|
| `supabase-database`     | `npx -y @supabase/mcp-server-supabase@latest --project-ref=wnnjeqheqxxyrgsjmygy` | `list_tables`, `list_branches`, `execute_sql`, `apply_migration`, etc. | Use hosted Supabase project only; never point to localhost. |
| `github-mcp` *(optional)* | `npx -y @modelcontextprotocol/server-github`                | Repo inspection, issue metadata                            | Enable only when GitHub automation is required. |
| Lighthouse MCP          | See `docs/MCP_ROUTING_TROUBLESHOOTING.md`                   | `run_audit`, `get_performance_score`                       | Requires Chromium; set `CHROME_PATH` if not auto-detected. |
| Playwright MCP          | Browser automation utilities (smoke/baseline screenshots)   | `browser_navigate`, `browser_click`, `browser_take_screenshot` | Prefer MCP browser tooling for quick validation before running full Playwright suites. |

> When conflicts arise between MCP servers (e.g., overlapping tool names), use `node scripts/mcp-routing-fix.js supabase-only` or `github-only` to disambiguate. See `docs/MCP_ROUTING_TROUBLESHOOTING.md` for step-by-step guidance.

## Operational Workflow

1. **Scout & Plan**
   - Gather context from the relevant doc (runbooks, specs, or issue threads).
   - If work spans multiple files or systems, create a brief plan before editing (the `create_plan` tool keeps changes reviewable).
2. **Implement**
   - Update code and/or documentation, keeping modifications within the writable directories above.
   - For Supabase schema changes: create a migration under `supabase/migrations/`, run `supabase db lint` locally, and document the change.
3. **Verify**
   - Run targeted commands:
     - Docs-only: `npm run lint:md` *(if applicable)* or rely on markdown lint extension.
     - Backend/frontend: `npm run lint`, `npm run typecheck`, `npm test`.
     - Supabase diff: `supabase db diff --schema public --linked` or `npm run db:check:security`.
   - Preview builds: `npm run preview:build && npm run preview:smoke`.
4. **Summarize & Hand-off**
   - Provide a concise summary referencing the files or migrations touched.
   - Mention any MCP artifacts (runtime-config output, Playwright screenshots, etc.) so reviewers can validate quickly.

## Secrets & Credentials

- Source of truth for Supabase, Netlify, and other production secrets is 1Password (`Platform / Supabase` vault).
- Use `npm run ci:secrets` locally to ensure required env vars are set; CI runs the same script before tests.
- Never commit raw keys. When discussing secrets in comments or docs, redact to `****`.

## Release & Branching Quick Reference

- **Preview databases**: Every PR receives an auto-provisioned Supabase preview branch. Treat them as ephemeral; they disappear when the PR closes.
- **Staging (`develop`)**: We share the same hosted Supabase project; apply migrations via Supabase branches or direct `supabase db push --project-ref wnnnjeqheqxxyrgsjmygy` after smoke tests.
- **Production (`main`)**: Merges auto-deploy via the Supabase GitHub integration. Monitor dashboard logs and run `npm run preview:smoke:remote` against the production URL if needed.

## Incident & Support

- Tenant isolation, guardian access, session hold resiliency, and onboarding flows each have dedicated runbooks in `docs/`.
- For MCP routing or tooling conflicts, consult:
  - `docs/MCP_ROUTING_TROUBLESHOOTING.md`
  - `scripts/mcp-routing-fix.js`
  - Preview smoke instructions in `docs/PREVIEW_SMOKE.md`

Keep this guide updated as tooling or processes evolve so every agent executes work with the same context.***
# AGENTS.md – Operating Rules for Codex Agents

> **Scope** – These rules apply to *all* files under this repository. Any PR opened by an AI agent **must** respect the constraints below. Failures to comply will cause the CI pipeline to reject the change.  (See Codex system‑prompt spec ([baoyu.io](https://baoyu.io/blog/codex-system-prompt?utm_source=chatgpt.com)).)

---

## 📁 Directory‑level permissions

| Path                                                                    | May the agent modify? | Notes                                                                                                                                                               |
| ----------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/src/**`                                                               | **YES**               | Application code only. Follow code‑style rules below.                                                                                                               |
| `/supabase/migrations/**`                                               | **YES**               | Add/adjust SQL migrations generated by `supabase db diff --use-migrations` ([datacamp.com](https://www.datacamp.com/tutorial/openai-codex?utm_source=chatgpt.com)). |
| `/supabase/functions/**`                                                | **YES**               | Deploy with `supabase functions deploy --use-api` (no Docker) ([supabase.com](https://supabase.com/docs/guides/functions/deploy?utm_source=chatgpt.com)).           |
| `/docs/**`, `README.md`, `AGENTS.md`                                    | **YES**               | Keep docs in sync with code changes.                                                                                                                                |
| `.github/**`, `infra/**`, `Dockerfile`, `.env`, `.supabase/config.toml` | **NO**                | Infrastructure and secrets are human‑only; propose but never commit changes.                                                                                        |

---

## 🔑 Secrets & Environment

1. **Secrets live in Codex → Secrets**, never hard‑code or print them. Mask as `****` in logs ([datacamp.com](https://www.datacamp.com/tutorial/openai-codex?utm_source=chatgpt.com)).
2. Use the following env vars, already injected at runtime:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` – read‑only client creds.
   - `SUPABASE_SERVICE_ROLE_KEY` – write/migration power.
   - `SUPABASE_ACCESS_TOKEN` – CLI auth token.
3. Generate Vite‑friendly keys in `.env` **during setup only**; do **not** commit `.env` to git.
4. Always run the Supabase CLI with `--project-ref wnnjeqheqxxyrgsjmygy` **or** ensure `.supabase/project.toml` contains that ref to avoid interactive prompts ([supabase.com](https://supabase.com/docs/reference/cli/start?utm_source=chatgpt.com)).
5. **Never** invoke Docker‑dependent commands (`supabase status`, `start`, `serve`, `db reset`) inside Codex—they fail without a Docker daemon ([baoyu.io](https://baoyu.io/blog/codex-system-prompt?utm_source=chatgpt.com)).

---

## 🧰 MCP Tooling

The project standardizes on the following MCP servers. These are configured locally via `.cursor/mcp.json` and must not be committed.

- **supabase**: Hosted Supabase project access for docs, database, functions, branching, storage, logs. No self‑hosted/local DB.
- **MCP_DOCKER**: Docker MCP gateway for containerized tools. Use for exploratory tooling; do not commit infra changes.
- **lighthouse**: Web audits for performance, accessibility, best‑practices, SEO, PWA. Requires a Chromium browser. If needed, set `CHROME_PATH` to the browser executable.
  - Typical tools: `get_performance_score`, `run_audit` ([lighthouse-mcp GitHub](https://github.com/priyankark/lighthouse-mcp)).
- **playwright**: Browser automation for E2E smoke/regression and artifact capture (screenshots, console logs, timings).
  - Typical tools: `browser_navigate`, `browser_click`, `browser_wait_for`, `browser_take_screenshot`.

Notes
- `.cursor/mcp.json` is user‑local. Propose changes in PRs, but never commit secrets or environment‑specific paths.
- Prefer testing against hosted/staging URLs; avoid `localhost` for Supabase endpoints.

---

## 🏗️ Coding‑standards

- **TypeScript / React** – follow Airbnb style via project ESLint + Prettier settings ([gist.github.com](https://gist.github.com/ruvnet/ba1497632143ea9f12062c9c2c1879ad?utm_source=chatgpt.com)).
- **Exports** – use **named exports**; no default exports.
- **Testing** – every logic change needs a Jest test; run `npm test`, `eslint .`, and `tsc --noEmit` before opening a PR ([datacamp.com](https://www.datacamp.com/tutorial/openai-codex?utm_source=chatgpt.com)).
- **Commits** – use Conventional Commits (`feat(scope): summary`) ([gist.github.com](https://gist.github.com/ruvnet/ba1497632143ea9f12062c9c2c1879ad?utm_source=chatgpt.com)).
- **Coverage** – maintain ≥ 90 % line coverage; CI fails below this threshold.

---

## 📐 MCP Usage Rules & Boundaries

- **Supabase (hosted only)**: Do not point to self‑hosted or `localhost:54321`. The app must source `SUPABASE_URL` from `.env.local` and use the hosted project.
- **Secrets**: Never echo/API‑return secrets in MCP outputs. Mask tokens as `****` in logs/artifacts.
- **User management**: Prefer Supabase CLI for admin tasks (e.g., create/reset users). Avoid dashboard‑only workflows in automation.
- **Config locality**: Keep `.cursor/mcp.json` local; do not commit environment‑specific paths such as `CHROME_PATH`.
- **Infra boundaries**: Do not commit changes to `.github/**`, `infra/**`, `Dockerfile`, `.env`, `.supabase/config.toml`. Propose instead.

---

## 🔁 Standard Workflows (MCP‑first)

### Frontend performance audit (Lighthouse)
- When: new pages, major UI changes, or regressions suspected.
- Run:
  - Mobile (default throttling): `get_performance_score url=<page>`
  - Full audit (desktop): `run_audit url=<page> device=desktop throttling=false categories=[performance,accessibility,best-practices,seo]`
- Output expectations: overall scores, top opportunities (LCP, CLS, TBT), and concrete fix list.

### E2E smoke/regression (Playwright)
- When: critical flows (sign‑in, checkout, settings), before release.
- Run minimal path:
  - `browser_navigate url=<page>` → `browser_wait_for text="<selector/text>"`
  - `browser_click element="<desc>"` → `browser_take_screenshot`
- Output expectations: screenshots per step, timing notes, any console/network errors.

### Database changes (Supabase)
- Migrations: create locally (`supabase migration new` or `db diff --use-migrations`), apply via cloud: `supabase db push -p wnnjeqheqxxyrgsjmygy`.
- Types: regenerate after push:
  ```bash
  supabase gen types typescript \
    --schema public \
    -p wnnjeqheqxxyrgsjmygy \
    > src/lib/generated/database.types.ts
  ```
- Security: enable RLS on new tables and add at least one policy matching intended access.

---

## 🗄️ Database & Migrations

1. **Create migrations locally** with `supabase migration new` or via `db diff --use-migrations` ([datacamp.com](https://www.datacamp.com/tutorial/openai-codex?utm_source=chatgpt.com)).
2. **Apply migrations** with `supabase db push -p wnnjeqheqxxyrgsjmygy` (cloud‑only).
3. After every push, **regenerate types**:
   ```bash
   supabase gen types typescript \
     --schema public \
     -p wnnjeqheqxxyrgsjmygy \
     > src/lib/generated/database.types.ts
   ```
4. Ensure **Row‑Level Security** is enabled on new tables and at least one policy allows the intended access ([docs.supabase.com](https://docs.supabase.com/?utm_source=chatgpt.com)).

---

## 🚦 CI Gate

The CI pipeline will:

1. Re‑run the setup script (see `/scripts/setup.sh`).
2. Enforce lint, tests, type‑check.
3. Reject PRs touching forbidden paths or failing any step.

---

## 🤖 Pull‑Request template the agent must use

```
### Summary
<one‑sentence overview>

### Proposed changes
- Bullet 1
- Bullet 2

### MCP Evidence
- Lighthouse:
  - URL(s): <page>
  - Device: mobile/desktop; Throttling: on/off
  - Scores: performance / accessibility / best‑practices / SEO / PWA
  - Top opportunities/regressions: <brief list>
- Playwright:
  - Flows covered: <list>
  - Artifacts: <screenshots/logs links or attachments>

### Tests added/updated
- jest/path/to/test.ts

### Checklist
- [ ] `npm test` passed
- [ ] `eslint .` passed
- [ ] `tsc --noEmit` passed
- [ ] Supabase types regenerated
- [ ] Lighthouse audit attached (with scores + opportunities)
- [ ] Critical flows validated via Playwright (artifacts attached)
- [ ] No secrets present in artifacts/logs
```

PR body rules sourced from Codex docs on AGENTS.md PR‑guidance ([baoyu.io](https://baoyu.io/blog/codex-system-prompt?utm_source=chatgpt.com)).

---

## 🛠️ MCP Troubleshooting

- Lighthouse
  - Ensure a Chromium family browser is installed. If detection fails, set `CHROME_PATH` to the browser executable (e.g., `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`).
  - If `npx` is blocked by proxy/SSL interception, install globally and run via `lighthouse-mcp`.
  - For CI or headless desktops, add `--chrome-flags="--headless=new"` if invoking Lighthouse directly.
- Playwright
  - Use `browser_wait_for` before interactions; capture `browser_take_screenshot` at key checkpoints.
  - If downloads or popups are blocked by policy, run locally or adjust browser permissions.
- Docker gateway
  - Ensure containers are running and labeled per gateway requirements if you rely on containerized MCP servers.

## 📜 Changelog

- **v1.0 (2025‑06‑23)** – Initial agent guidelines drafted from OpenAI Codex best‑practices and Supabase CLI docs ([agentsmd.net](https://agentsmd.net/?utm_source=chatgpt.com), [supabase.com](https://supabase.com/docs/guides/functions/deploy?utm_source=chatgpt.com), [baoyu.io](https://baoyu.io/blog/codex-system-prompt?utm_source=chatgpt.com), [github.com](https://github.com/orgs/supabase/discussions/12639?utm_source=chatgpt.com)).
