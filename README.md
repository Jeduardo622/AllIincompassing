# Supabase CLI

[![Coverage Status](https://coveralls.io/repos/github/supabase/cli/badge.svg?branch=main)](https://coveralls.io/github/supabase/cli?branch=main) [![Bitbucket Pipelines](https://img.shields.io/bitbucket/pipelines/supabase-cli/setup-cli/master?style=flat-square&label=Bitbucket%20Canary)](https://bitbucket.org/supabase-cli/setup-cli/pipelines) [![Gitlab Pipeline Status](https://img.shields.io/gitlab/pipeline-status/sweatybridge%2Fsetup-cli?label=Gitlab%20Canary)
](https://gitlab.com/sweatybridge/setup-cli/-/pipelines)

[Supabase](https://supabase.io) is an open source Firebase alternative. We're building the features of Firebase using enterprise-grade open source tools.

This repository contains all the functionality for Supabase CLI.

- [x] Running Supabase locally
- [x] Managing database migrations
- [x] Creating and deploying Supabase Functions
- [x] Generating types directly from your database schema
- [x] Making authenticated HTTP requests to [Management API](https://supabase.com/docs/reference/api/introduction)

## Getting started

### Install the CLI

Available via [NPM](https://www.npmjs.com) as dev dependency. To install:

```bash
npm i supabase --save-dev
```

To install the beta release channel:

```bash
npm i supabase@beta --save-dev
```

When installing with yarn 4, you need to disable experimental fetch with the following nodejs config.

```
NODE_OPTIONS=--no-experimental-fetch yarn add supabase
```

> **Note**
For Bun versions below v1.0.17, you must add `supabase` as a [trusted dependency](https://bun.sh/guides/install/trusted) before running `bun add -D supabase`.

<details>
  <summary><b>macOS</b></summary>

  Available via [Homebrew](https://brew.sh). To install:

  ```sh
  brew install supabase/tap/supabase
  ```

  To install the beta release channel:
  
  ```sh
  brew install supabase/tap/supabase-beta
  brew link --overwrite supabase-beta
  ```
  
  To upgrade:

  ```sh
  brew upgrade supabase
  ```
</details>

<details>
  <summary><b>Windows</b></summary>

  Available via [Scoop](https://scoop.sh). To install:

  ```powershell
  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
  scoop install supabase
  ```

  To upgrade:

  ```powershell
  scoop update supabase
  ```
</details>

<details>
  <summary><b>Linux</b></summary>

  Available via [Homebrew](https://brew.sh) and Linux packages.

  #### via Homebrew

  To install:

  ```sh
  brew install supabase/tap/supabase
  ```

  To upgrade:

  ```sh
  brew upgrade supabase
  ```

  #### via Linux packages

  Linux packages are provided in [Releases](https://github.com/supabase/cli/releases). To install, download the `.apk`/`.deb`/`.rpm`/`.pkg.tar.zst` file depending on your package manager and run the respective commands.

  ```sh
  sudo apk add --allow-untrusted <...>.apk
  ```

  ```sh
  sudo dpkg -i <...>.deb
  ```

  ```sh
  sudo rpm -i <...>.rpm
  ```

  ```sh
  sudo pacman -U <...>.pkg.tar.zst
  ```
</details>

<details>
  <summary><b>Other Platforms</b></summary>

  You can also install the CLI via [go modules](https://go.dev/ref/mod#go-install) without the help of package managers.

  ```sh
  go install github.com/supabase/cli@latest
  ```

  Add a symlink to the binary in `$PATH` for easier access:

  ```sh
  ln -s "$(go env GOPATH)/bin/cli" /usr/bin/supabase
  ```

  This works on other non-standard Linux distros.
</details>

<details>
  <summary><b>Community Maintained Packages</b></summary>

  Available via [pkgx](https://pkgx.sh/). Package script [here](https://github.com/pkgxdev/pantry/blob/main/projects/supabase.com/cli/package.yml).
  To install in your working directory:

  ```bash
  pkgx install supabase
  ```

  Available via [Nixpkgs](https://nixos.org/). Package script [here](https://github.com/NixOS/nixpkgs/blob/master/pkgs/development/tools/supabase-cli/default.nix).
</details>

### Run the CLI

```bash
supabase bootstrap
```

Or using npx:

```bash
npx supabase bootstrap
```

The bootstrap command will guide you through the process of setting up a Supabase project using one of the [starter](https://github.com/supabase-community/supabase-samples/blob/main/samples.json) templates.

## Docs

Command & config reference can be found [here](https://supabase.com/docs/reference/cli/about).

## Breaking changes

We follow semantic versioning for changes that directly impact CLI commands, flags, and configurations.

However, due to dependencies on other service images, we cannot guarantee that schema migrations, seed.sql, and generated types will always work for the same CLI major version. If you need such guarantees, we encourage you to pin a specific version of CLI in package.json.

## Developing

To run from source:

```sh
# Go >= 1.22
go run . help
```

# Database-First CI/CD Pipeline

A streamlined CI/CD pipeline for Supabase projects following database-first development practices.

## 🚀 Features

- **Simple & Practical**: Based on real-world Supabase deployment patterns
- **Database-First**: Migrations drive deployments, not the other way around
- **Branch-Based Deployments**: `develop` → staging, `main` → production
- **Type Safety**: Automatic TypeScript type generation and validation
- **Automated Backups**: Production backups before deployments
- **Clean & Minimal**: No unnecessary complexity or bloat

## 📋 Requirements

### GitHub Secrets

Configure these secrets in your GitHub repository:

```bash
# Supabase Configuration
SUPABASE_ACCESS_TOKEN=your_access_token
SUPABASE_DB_PASSWORD=your_db_password
SUPABASE_PROJECT_ID=your_project_id
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Repository Structure

```
.
├── .github/workflows/
│   └── database-first-ci.yml
├── supabase/
│   ├── migrations/
│   └── config.toml
├── scripts/
│   └── cleanup-supabase-branch.js
└── types.gen.ts
```

## 🎯 How It Works

This workflow uses a **single Supabase project** with branch-based deployments:

### On Pull Requests
1. **Test & Validate**: Run tests and validate type generation
2. **Migration Check**: Detect new migrations for review

### On Push to `develop`
1. **Deploy to Supabase**: Apply migrations and update types
2. **Create Deployment Comment**: Summary of changes

### On Push to `main`
1. **Create Backup**: Backup production database
2. **Deploy to Production**: Apply migrations and update types  
3. **Create Deployment Comment**: Summary with dashboard link

### Weekly Cleanup
- Remove old backup files
- Clean up old workflow runs

> **Note**: This workflow uses a single Supabase project with branch-based deployments. For true staging/production separation, you'd need separate Supabase projects and different `SUPABASE_PROJECT_ID` values.

## 🛠 Usage

### 1. Create a Migration
```bash
supabase migration new add_users_table
```

### 2. Test Locally
```bash
supabase db start
supabase db reset
npm test
```

### 3. Deploy via Git
```bash
git add .
git commit -m "Add users table migration"
git push origin develop  # Deploy to staging
```

### 4. Production Deployment
```bash
git checkout main
git merge develop
git push origin main     # Deploy to production
```

## 📁 Scripts

### `scripts/cleanup-supabase-branch.js`
- Clean up old Supabase branches
- Pattern-based cleanup (e.g., PR branches)
- Age-based cleanup (branches older than X days)
- Dry-run mode for safety

### Usage
```bash
# Clean up branches older than 7 days
node scripts/cleanup-supabase-branch.js --max-age 7

# Clean up PR branches matching pattern
node scripts/cleanup-supabase-branch.js --pattern "^pr-"

# Dry run (preview changes)
node scripts/cleanup-supabase-branch.js --dry-run --max-age 7
```

### `scripts/admin-password-reset.js`
- Reset a user's password or create the account if it does not exist
- Requires Supabase service role credentials loaded from your environment (no fallback value is bundled)

#### Usage
```bash
# Supply the service role key through the environment (e.g. shell export or .env file)
export SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"

# Optional: override the Supabase project URL if you are using a non-default project
export SUPABASE_URL="https://your-project.supabase.co"

# Execute the script with the target account details
node scripts/admin-password-reset.js user@example.com NewPass123 true
```

> ℹ️  The script reads configuration via `dotenv`, so storing the key in a local `.env` file is supported. Keep the key out of version control and CI logs.

## 🔧 Configuration

### Environment Variables
```bash
# Optional: Customize behavior
SUPABASE_CLI_VERSION=latest
NODE_VERSION=18
```

### Supabase Configuration
Ensure your `supabase/config.toml` is properly configured:

```toml
[api]
enabled = true
port = 54321

[db]
port = 54322

[studio]
enabled = true
port = 54323
```

## 🚨 Troubleshooting

### Common Issues

1. **Migration Conflicts**
   ```bash
   # Reset local database and reapply migrations
   supabase db reset
   ```

2. **Type Generation Issues**
   ```bash
   # Manually regenerate types
   supabase gen types typescript --local > types.gen.ts
   ```

3. **Permission Errors**
   ```bash
   # Check Supabase access token permissions
   supabase projects list
   ```

## 📝 Best Practices

1. **Always test locally first** with `supabase db start`
2. **Use staging environment** for final validation
3. **Keep migrations small** and focused
4. **Test type generation** after schema changes
5. **Review deployment comments** for confirmation

## 🔗 Links

- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Database Migrations Guide](https://supabase.com/docs/guides/database/managing-migrations)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

> **Note**: This workflow is designed to be simple and practical. It's based on real-world Supabase deployment patterns and avoids unnecessary complexity while maintaining production-ready reliability.