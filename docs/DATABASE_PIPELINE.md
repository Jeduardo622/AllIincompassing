# 🚀 Database-First CI/CD Pipeline

This document describes the comprehensive database-first CI/CD pipeline implemented for the AllIncompassing project. This pipeline provides isolated database environments, automated testing, security checks, and seamless deployments.

## 📋 Table of Contents

- [Overview](#overview)
- [Pipeline Flow](#pipeline-flow)
- [Setup Requirements](#setup-requirements)
- [GitHub Actions Workflows](#github-actions-workflows)
- [Database Health Monitoring](#database-health-monitoring)
- [Manual Commands](#manual-commands)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

The “database-first” workflow combines a focused GitHub Action (`supabase-validate.yml`), the general CI pipeline, and a set of Supabase CLI scripts. Together they lint migrations, run integration tests against the hosted project (`wnnjeqheqxxyrgsjmygy`), and give contributors tools to spin up Supabase branches when they need isolated data.

The current implementation does **not** create per-PR Supabase branches automatically. Instead, engineers run the supplied scripts (see [Manual Commands](#-manual-commands)) whenever a feature actually requires a dedicated database copy. CI reuses the shared project and enforces safety via linting and tests.

### Key Components & Benefits

- ✅ **Migration linting on PRs** – `supabase-validate.yml` runs `supabase db lint` whenever a PR touches `supabase/migrations/**`.【.github/workflows/supabase-validate.yml†L4-L26】
- ✅ **Hosted-integration tests on push** – the same workflow runs `npm test` with `RUN_DB_IT=1` for pushes to `main`, guaranteeing RLS-aware suites execute against real Supabase credentials.【.github/workflows/supabase-validate.yml†L27-L46】
- ✅ **Full project CI** – `.github/workflows/ci.yml` adds linting, coverage, Netlify deploys, and smoke tests so schema changes are exercised together with the app code.【.github/workflows/ci.yml†1-L215】
- ✅ **On-demand previews** – `supabase-preview.yml` provides a manual workflow for rapidly bringing up an ephemeral Supabase stack when deeper QA is needed.【.github/workflows/supabase-preview.yml†1-L37】
- ✅ **Branch utilities** – `npm run db:branch:create|cleanup` wrap the Supabase CLI so engineers can create, reuse, and destroy database branches without crafting CLI commands by hand.

## 🔄 Pipeline Flow

1. **Pull request touches migrations**
   - `supabase-validate.yml` triggers `lint-migrations`, which checks out the PR, installs the Supabase CLI, and runs `supabase db lint --project-ref wnnjeqheqxxyrgsjmygy`. Failures block the PR until policies, functions, and grants pass lint.
2. **Push to `main`**
   - `supabase-validate.yml` runs the `test-main` job. It installs dependencies, sets `RUN_DB_IT=1`, injects hosted Supabase credentials, and executes `npm test` so database-backed Vitest suites run with live data.
3. **Repo-wide CI (`ci.yml`)**
   - For every PR/push, the standard CI pipeline validates secrets, runs ESLint/TypeScript, executes Vitest with Supabase credentials, enforces coverage, builds canary bundles, and (on `develop`) deploys to Netlify staging before running smoke tests.
4. **Optional Supabase preview**
   - When needed, maintainers run `Supabase Preview` via the **Actions** tab to start a local Supabase stack (`supabase start`, `supabase db reset`) for exploratory testing.
5. **Manual Supabase branch workflow**
   - If a change needs an isolated database, run `npm run db:branch:create pr-123` locally, apply migrations, and work against that branch. Cleanup via `npm run db:branch:cleanup pr-123` when done. These scripts are not wired into Actions yet, keeping branch creation intentional rather than automatic.

## ⚙️ Setup Requirements

### GitHub Secrets

Add these secrets to your GitHub repository:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ACCESS_TOKEN=your_supabase_access_token
SUPABASE_PROJECT_REF=wnnjeqheqxxyrgsjmygy
SUPABASE_DB_PASSWORD=your_database_password
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI for AI features
OPENAI_API_KEY=your_openai_api_key

# Netlify for deployments
NETLIFY_AUTH_TOKEN=your_netlify_auth_token
NETLIFY_SITE_ID=your_netlify_site_id
```

> 🔒 Provide these values via your CI/CD secret store. Scripts that require elevated access, including `scripts/admin-password-reset.js`, will abort if `SUPABASE_SERVICE_ROLE_KEY` is missing or blank; no fallback credentials are embedded.

Expose the read-only Supabase credentials to CI jobs so the RLS security tests can authenticate:

```yaml
env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

For local runs, export the same variables and set `RUN_DB_IT=1` before invoking `npm test` to opt into the database-backed suites.

### Local Development Setup

1. **Install Supabase CLI**:
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

## 🤖 GitHub Actions Workflows

### `supabase-validate.yml`
- **Triggers**: Pull requests that modify `supabase/migrations/**` and pushes to `main` touching those paths.【.github/workflows/supabase-validate.yml†4-L13】
- **PR behavior**: Runs `supabase db lint --project-ref wnnjeqheqxxyrgsjmygy` to ensure policies, grants, and SQL syntax conform before review.【.github/workflows/supabase-validate.yml†15-L26】
- **Push behavior**: Installs dependencies and executes `npm test` with `RUN_DB_IT=1`, pointing to the hosted Supabase environment so RLS and RPC tests run against real data.【.github/workflows/supabase-validate.yml†27-L46】

### `ci.yml`
- **Triggers**: All PRs and pushes.
- **Focus**: Validates secrets, runs ESLint/TypeScript, executes Vitest with Supabase credentials, enforces coverage, builds canary bundles, deploys to Netlify staging on `develop`, and runs smoke tests plus route audits.【.github/workflows/ci.yml†1-L248】
- **Why it matters for the database**: Because `RUN_DB_IT` is set for Vitest, schema and RLS regressions surface during the general CI build even when migrations are untouched.

### `database-first-ci.yml`
- **Triggers**: Pushes to `main` and `develop`. (It intentionally omits PR events for now.)【.github/workflows/database-first-ci.yml†1-L12】
- **Scope**: Currently a thin placeholder that checks out the repository and is ready for future branch automation. We keep it documented so future automation work has a home and we remember it runs on every protected branch push.

### `supabase-preview.yml`
- **Triggers**: Manual `workflow_dispatch`.
- **Focus**: Starts a local Supabase stack via `supabase start`, resets the database, optionally runs type generation, and surfaces connection info so developers can point their local app at the ephemeral environment.【.github/workflows/supabase-preview.yml†1-L37】
- **Use case**: Great for QA/debug sessions when you need a clean Supabase instance but don’t want to create a managed branch.

## 🏥 Database Health Monitoring

CI currently surfaces schema issues through tests and linting; deeper health checks remain opt-in via the supplied scripts. Run them locally, in a Codespace, or from a scheduled job when needed:

- `npm run db:check:security <branch-id>` – wraps Supabase advisors and our RLS/policy checks.
- `npm run db:check:performance <branch-id>` – scrapes pg_stat views for slow queries, missing indexes, and bloat.
- `npm run db:health:report <branch-id>` – produces a consolidated Markdown report using the outputs above.
- `npm run db:health:production` – shortcuts to the production reference (`wnnjeqheqxxyrgsjmygy`) for release audits.
- `npm run pipeline:health <branch-id>` – convenience script that runs security + performance + report in one go.

### Security Checks

The security script focuses on:

- **RLS coverage** – fails if tables under `public` miss RLS or if policies conflict with helper functions.
- **Function hardening** – verifies `SECURITY DEFINER` and locked-down `search_path` on helper functions.
- **Supabase advisors** – relays any high/critical recommendations Supabase emits for the project.

### Performance Analysis

The performance script highlights:

- **Slow queries** – anything over ~1000 ms cumulative time.
- **Missing/unused indexes** – looks for high seq scans vs. tuples returned.
- **Table bloat** – flags tables with large dead tuple ratios.
- **Connection stats** – simple `pg_stat_activity` snapshot for runaway clients.

### Health Report Format

Running `npm run db:health:report branch-id` emits Markdown similar to the following, which you can paste into a PR comment or attach to release notes:

```markdown
# 🏥 Database Health Report

## 📊 Overall Health: 🟢 EXCELLENT

| Metric | Score | Status |
|--------|-------|--------|
| 🔒 Security | 95/100 | 🟢 Excellent |
| ⚡ Performance | 88/100 | 🟡 Good |
| 📋 Total Issues | 2 | ⚠️ Found |
| 🚨 Critical Issues | 0 | ✅ None |

## 💡 Recommendations
- ⚠️ **PERFORMANCE**: Add indexes to 2 tables
- 💡 _Action: CREATE INDEX ON table_name (column_name);_
```

## 🛠️ Manual Commands

### Database Branch Management

```bash
# Create a new database branch
npm run db:branch:create branch-name

# Cleanup a database branch
npm run db:branch:cleanup branch-name

# Cleanup multiple branches by pattern
node scripts/cleanup-supabase-branch.js --pattern "pr-.*"
```

### Health Checks

```bash
# Run security analysis
npm run db:check:security branch-id

# Run performance analysis
npm run db:check:performance branch-id

# Generate combined health report
npm run db:health:report branch-id

# Check production health
npm run db:health:production

# Run all health checks
npm run pipeline:health branch-id
```

### Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Make database changes
# Add migration files to supabase/migrations/

# 3. Test locally with branch database
supabase db push --project-ref your-branch-id

# 4. Run health checks locally
npm run pipeline:health your-branch-id

# 5. Create PR - pipeline runs automatically
gh pr create
```

## 🐛 Troubleshooting

### Common Issues

#### 1. Branch Creation Fails
```bash
Error: Cost confirmation required
```
**Solution**: The script handles cost confirmation automatically. If it fails, check Supabase billing settings.

#### 2. Migration Conflicts
```bash
Error: Migration conflict detected
```
**Solution**: Resolve conflicts in migration files and push again. The isolated branch prevents conflicts with main.

#### 3. Type Generation Fails
```bash
Error: Failed to generate types
```
**Solution**: Check database connection and ensure migrations applied successfully.

#### 4. Security Check Failures
```bash
Error: Critical security issues found
```
**Solution**: Review the health report and address RLS policies or security advisors.

#### 5. Performance Warnings
```bash
Warning: Slow queries detected
```
**Solution**: Optimize queries and add indexes as recommended in the health report.

### Debug Commands

```bash
# List all branches
supabase branches list

# Check branch status
supabase branches get branch-id

# View migration status
supabase db diff --schema public

# Test database connection
supabase db query 'SELECT NOW();' --project-ref branch-id
```

### Log Locations

- **GitHub Actions**: Check the Actions tab in your repository
- **Local Reports**: `.reports/` directory
- **Branch Cache**: `.cache/supabase-branches/`
- **Supabase Logs**: Use `supabase logs` command

## 📈 Monitoring & Metrics

### Pipeline Metrics

Track pipeline effectiveness:

- **PR Processing Time**: Time from PR creation to deployment
- **Migration Success Rate**: Percentage of successful migrations
- **Security Issue Detection**: Number of issues caught pre-production
- **Performance Regression Detection**: Queries optimized per month

### Health Score Calculation

**Security Score (0-100)**:
- Critical issues: -30 points each
- High severity issues: -20 points each
- Medium severity issues: -10 points each
- Low severity warnings: -5 points each

**Performance Score (0-100)**:
- Critical slow queries (>5s): -25 points each
- Slow queries: -10 points each
- Missing indexes: -5 points each

**Overall Health**:
- 85-100: Excellent 🟢
- 70-84: Good 🟡
- 50-69: Fair 🟠
- 0-49: Poor 🔴

## 🔮 Future Enhancements

Planned improvements:

- **Cost Optimization**: Automatic branch cleanup based on age
- **Advanced Security**: SAST scanning for SQL injection vulnerabilities
- **Performance Baselines**: Compare performance against main branch
- **Blue-Green Deployments**: Zero-downtime production deployments
- **Rollback Automation**: Automatic rollback on health check failures
- **Metrics Dashboard**: Real-time pipeline and database health visualization

---

**Need Help?** Check our [troubleshooting guide](#troubleshooting) or create an issue in the repository. 