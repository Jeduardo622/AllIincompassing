# Database-First CI/CD Pipeline

This document describes the current database-related CI behavior in this repository and the supporting local scripts.

## Overview

The current model has three tracks:

1. `supabase-validate.yml` for migration lint and hosted DB test coverage.
2. `ci.yml` for repository-wide quality and policy gates.
3. `supabase-preview.yml` for on-demand local Supabase preview runs.

The repository does not create per-PR Supabase branches automatically. Branch creation remains manual via `npm run db:branch:create` when isolation is needed.

## Pipeline Flow

1. Pull request touches `supabase/migrations/**`.
   - `supabase-validate.yml` runs `lint-migrations`.
   - The lint step runs `supabase db lint --project-ref "$SUPABASE_PROJECT_REF"` when a project ref is configured.
2. Push to `main` touches `supabase/migrations/**`.
   - `supabase-validate.yml` runs `test-main`.
   - `test-main` runs `npm test -- --run --reporter=verbose` with `RUN_DB_IT=1`.
3. Pull request, push, or merge queue (`merge_group`) to `main`/`develop`.
   - `ci.yml` runs either:
     - docs-only path: `change-scope` -> `docs-guard` -> `ci-gate`
     - non-doc path: `change-scope` -> `policy` -> parallel gates:
       - chain A: `lint-typecheck` + `unit-tests` -> `build` -> `tier0-browser`
       - chain B: `auth-browser-smoke`
       - both chains feed `ci-gate`
4. Manual preview run.
   - `supabase-preview.yml` can be triggered with `workflow_dispatch` to run local Supabase startup/reset plus preview build/smoke checks.

## GitHub Actions Workflows

### `supabase-validate.yml`

- Triggered by:
  - pull requests that touch `supabase/migrations/**` or `.github/workflows/supabase-validate.yml`
  - pushes to `main` that touch `supabase/migrations/**`
- Jobs:
  - `lint-migrations` (PR only): checks migrations with Supabase CLI.
  - `test-main` (push only): runs unit/integration suites with hosted Supabase env vars and `RUN_DB_IT=1`.

### `ci.yml`

- Triggered on `pull_request`, `push`, and `merge_group` for `main` and `develop`.
- Uses `change-scope` to select docs-only vs non-doc path.
- `docs-guard` validates `npm run` examples for docs-path markdown changes (for example `docs/**`, `reports/**`, `README*.md`, `AGENTS.md`, and skill `SKILL.md` docs paths) when docs-only changes are detected.
- `policy` runs prerequisite validations, secret checks, session-edge deployment parity checks, and `npm run ci:check-focused`.
- Test and build gates include:
  - `lint-typecheck`
  - `unit-tests` (includes coverage verification)
  - `build`
  - `tier0-browser`
  - `auth-browser-smoke`
- `ci-gate` is the final required status gate for branch protection.

### `supabase-preview.yml`

- Manual only (`workflow_dispatch`).
- Starts local Supabase (`supabase start`), applies migrations locally (`supabase db reset --local --yes`), optionally generates types, then runs:
  - `npm run preview:build`
  - `npm run preview:smoke`
- Optional type generation runs only when repository variable `SUPABASE_PROJECT_ID` is set.

## Setup Requirements

### CI secrets

Typical secrets used by database-related workflows:

```bash
SUPABASE_URL
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
```

`supabase-preview.yml` and `ci.yml` may also reference additional environment-specific secrets when preview and policy checks run.

For local hosted-db parity runs, export the Supabase variables and set `RUN_DB_IT=1` before running `npm test`.

### Local tooling

```bash
npm install -g supabase
supabase login
npm ci
```

## Manual Commands

### Supabase branch management

```bash
npm run db:branch:create branch-name
npm run db:branch:cleanup branch-name
```

### Database health checks

```bash
npm run db:check:security
npm run db:check:performance
npm run db:health:report
npm run db:health:production
npm run pipeline:health
```

### CI parity commands

```bash
npm run ci:check-focused
npm run ci:playwright
```

`ci:playwright` is broader than the CI `auth-browser-smoke` job and includes additional Playwright suites (for example schedule conflict and therapist onboarding) used for local parity checks.

## Troubleshooting

- If migration lint is skipped in `supabase-validate.yml`, confirm `SUPABASE_PROJECT_REF` is configured.
- If docs-only changes fail `docs-guard`, verify every `npm run <script>` in changed docs exists in `package.json`.
- If policy checks fail branch-protection validation, align required checks with the current `ci-gate` contract documented in `docs/ai/pr-merge-queue-settings.md`.
