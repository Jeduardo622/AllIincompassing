# Supabase Branching Runbook

This runbook documents how Supabase branching works for this repository and how engineers should operate within the workflow that the GitHub integration provisions.

> ⚠️ Preview databases are billed resources. Treat them as ephemeral sandboxes—never rely on them for long-term storage.

## Overview

Supabase is connected to this GitHub repository with the following settings:

- **Supabase directory:** repository root (`.`)
- **Deploy to production:** enabled for the `main` branch
- **Automatic branching:** enabled with preview branches created for each pull request (limit 50)
- **Supabase changes only:** enabled so migrations under `supabase/migrations/` trigger previews

Configuration files live at `supabase/config.toml` and `supabase/migrations/` in the repo root, matching the integration defaults.【F:supabase/config.toml†L1-L95】 Keep all SQL migrations timestamped in UTC to preserve ordering.

## Preview Database Lifecycle

1. **PR opened:** Supabase detects the branch, provisions a preview project, and runs `supabase db push` using the migrations that shipped with the branch.
2. **Updates pushed:** New migrations in the pull request automatically apply to the preview database. Keep migrations additive to avoid destructive data loss between pushes.
3. **PR merged or closed:** Supabase tears down the preview project (database, auth, storage). Capture any data you need before closing.

If a preview project fails to provision, open the Supabase dashboard’s activity feed for details and rerun the migrations locally with `supabase db push --dry-run -p wnnjeqheqxxyrgsjmygy` to reproduce errors.

## Verifying Preview Automation

- **Creation:** For every PR, navigate to **Supabase → Branches → <PR number>** and confirm that a preview project exists with the latest commit hash.
- **Migrations:** Inspect the preview project’s *Deployments* tab to confirm each migration in `supabase/migrations/` applied successfully. Re-run failed migrations locally before retrying the deploy.
- **Destruction:** When a PR closes, refresh the Branches tab to make sure the preview project disappears. If it persists, delete it manually to avoid billing drift.

## Testing Against a Preview Database

1. In the Supabase dashboard, copy the preview project credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`).
2. Copy `.env.example` to `.env.codex` (preferred) and populate those keys for your branch’s preview project.【F:.env.example†L1-L56】
3. Install dependencies and run checks:
   ```bash
   npm install
   npm test
   npm run lint
   npm run typecheck
   ```
   Database-aware tests will use the preview credentials.
4. For frontend testing, export `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` or populate them in `.env.codex`. Never expose the service role key to browser bundles.

## Preview Secrets & Automation

- **Dashboard source of truth:** Preview keys surface under the branch entry in the Supabase dashboard. Refresh before each test run; keys rotate if you reprovision the preview project.
- **GitHub Actions:** The `.github/workflows/supabase-validate.yml` workflow relies on Supabase-synced secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) to lint migrations on pull requests.【F:.github/workflows/supabase-validate.yml†L1-L45】 Keep the GitHub integration connected so these values stay synchronized.
- **Local hygiene:** Store sensitive keys in `.env.codex` or your shell session. Never check real secrets into git and never expose the service role key client-side.

## Migration Workflow & Hygiene

- Generate migrations with `supabase db diff --use-migrations` or `supabase migration new` so Supabase can apply them deterministically.
- Review every migration for destructive statements. For example, `supabase/migrations/20250501150957_withered_heart.sql` drops `authorized_hours` without a data backfill—plan a staged rollout before applying to production.【F:supabase/migrations/20250501150957_withered_heart.sql†L1-L24】
- Prefer additive changes (`ALTER TABLE ... ADD COLUMN`, `CREATE INDEX CONCURRENTLY`) and wrap any cleanup in guard clauses (`IF EXISTS`) with a data migration path.
- Before opening a PR, run `supabase db lint` or `supabase db push --dry-run` locally. The validation workflow mirrors this check on CI.

## Merge & Conflict Resolution

Conflicts most often occur when multiple branches edit this runbook or the diagnostic report simultaneously. To resolve them:

1. Fetch the latest `main` and rebase your branch (`git fetch origin && git rebase origin/main`).
2. Open the conflicted files and integrate both sets of changes, keeping the most current diagnostic findings.
3. Run `npm test`, `eslint . --max-warnings=0`, and `tsc --noEmit` before committing to ensure documentation edits did not break tooling (linting checks markdown links).
4. Force-push the rebased branch once conflicts are resolved. The Supabase preview project will automatically rebuild from the updated migrations and docs.

## Promoting to Production (`main`)

1. Ensure all review feedback is addressed and that the Supabase Validate workflow is green.
2. Merge the PR into `main`. Because “Deploy to production” is enabled, Supabase applies migrations in `supabase/migrations/` to the production project automatically.
3. Monitor the Supabase dashboard deployment logs. If a migration fails, execute the documented rollback or forward-fix plan immediately.
4. Regenerate Supabase types (`supabase gen types typescript --schema public -p wnnjeqheqxxyrgsjmygy > src/lib/generated/database.types.ts`) so application code remains in sync with schema changes.

## Troubleshooting Checklist

- **Preview project missing:** Confirm the branch name matches the PR slug and that `supabase/config.toml` remains in the repository root.
- **Migrations fail to apply:** Run `supabase db push --dry-run` locally and inspect the SQL for destructive operations or missing dependencies.
- **Service role leakage:** Never embed `SUPABASE_SERVICE_ROLE_KEY` in frontend bundles. Restrict usage to backend scripts and CI workflows.
- **Exceeded branch limit:** Prune old preview branches from the Supabase dashboard or raise the limit before opening new PRs.
