# Supabase Branching Diagnostic

## Summary Findings

- ✅ **Branching setup health:** Supabase configuration files remain at the repository root (`supabase/config.toml`, `supabase/migrations/`), aligning with the dashboard settings for automatic preview provisioning and cleanup.【F:supabase/config.toml†L1-L95】【F:docs/supabase_branching.md†L8-L33】
- ❌ **Migration hygiene status:** `supabase/migrations/20250501150957_withered_heart.sql` drops the `authorized_hours` column without a data backfill, which is destructive on preview and production databases. Additional policy-cleanup migrations rely solely on `DROP POLICY IF EXISTS`, so confirm replacement policies exist before promotion.【F:supabase/migrations/20250501150957_withered_heart.sql†L1-L24】【F:supabase/migrations/20250920120300_remove_legacy_session_client_therapist_policies.sql†L1-L27】
- 🟧 **Env/secrets review:** `.env.example` documents all Supabase credentials with masked placeholders, and the runbook explains how preview keys flow from the dashboard into CI. Ensure the Supabase GitHub integration keeps syncing secrets for the validation workflow.【F:.env.example†L1-L56】【F:docs/supabase_branching.md†L53-L75】【F:.github/workflows/supabase-validate.yml†L1-L45】

## Evidence & Notes

### Branching Setup

- Supabase CLI configuration resides in `supabase/config.toml`, confirming the integration is pointed at the repo root as required for preview automation.【F:supabase/config.toml†L1-L95】
- The branching runbook details lifecycle expectations (creation, updates, teardown) and includes manual verification steps to audit preview environments from the dashboard.【F:docs/supabase_branching.md†L19-L52】

### Migration Hygiene

- The `authorized_hours` column drop in `20250501150957_withered_heart.sql` lacks a staged data migration. Treat this as a blocker until a forward-only strategy is prepared.【F:supabase/migrations/20250501150957_withered_heart.sql†L15-L24】
- Policy cleanup migrations such as `20250920120300_remove_legacy_session_client_therapist_policies.sql` rely on `DROP POLICY IF EXISTS`. Confirm successor policies exist and document the security intent in the accompanying PRs.【F:supabase/migrations/20250920120300_remove_legacy_session_client_therapist_policies.sql†L1-L27】
- Run `supabase db lint` locally before each PR to catch ordering or dependency issues. The Supabase Validate workflow enforces this check on CI.【F:.github/workflows/supabase-validate.yml†L10-L34】

### Environment & Secrets

- `.env.example` covers all required Supabase keys (URL, anon, edge, service role, access token) plus Vite mirrors, guiding developers to copy values from preview projects.【F:.env.example†L1-L45】
- The runbook reiterates where to find preview keys, how they propagate to GitHub Actions, and warns against exposing the service-role key in client bundles.【F:docs/supabase_branching.md†L53-L80】

## Next Steps

1. Refactor `20250501150957_withered_heart.sql` into a staged rollout that backfills data before dropping legacy columns (or split into additive + cleanup migrations).
2. Audit recent policy-drop migrations and document the replacement policies to ensure RLS coverage remains intact.
3. Periodically validate that Supabase preview secrets remain synced to GitHub by checking recent runs of `supabase-validate.yml` for credential errors.
