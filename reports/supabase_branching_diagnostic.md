# Supabase Branching Diagnostic

## Summary Findings

- ✅ **Branching setup health:** Supabase configuration files remain at the repository root (`supabase/config.toml`, `supabase/migrations/`), aligning with the dashboard settings for automatic preview provisioning and cleanup.【F:supabase/config.toml†L1-L95】【F:docs/supabase_branching.md†L8-L33】
- 🟧 **Migration hygiene status:** `supabase/migrations/20250501150957_withered_heart.sql` now copies legacy data into the new unit columns before dropping `authorized_hours`, but confirm downstream services tolerate the staged cleanup and keep an eye on future schema edits.【F:supabase/migrations/20250501150957_withered_heart.sql†L1-L64】 The role helper migration now provisions the `app` schema (if needed) and uses straightforward `CREATE OR REPLACE FUNCTION` statements instead of DO-block guards, eliminating the syntax error Supabase reported while keeping the helpers idempotent.【F:supabase/migrations/20250318172727_rough_star.sql†L44-L88】 Draft scripts still live under `temp_migrations/`—they need timestamps and peer review before shipping to previews.【F:temp_migrations/20250630191056_broken_beacon.sql†L1-L72】【F:temp_migrations/route_fix_2025-07-10T00-19-41-268Z.sql†L1-L83】 Ensure policy cleanup migrations reintroduce the intended RLS protections after dropping legacy grants.【F:supabase/migrations/20250920120300_remove_legacy_session_client_therapist_policies.sql†L1-L27】
- 🟧 **Env/secrets review:** `.env.example` documents all Supabase credentials with masked placeholders, and the runbook explains how preview keys flow from the dashboard into CI. Ensure the Supabase GitHub integration keeps syncing secrets for the validation workflow.【F:.env.example†L1-L56】【F:docs/supabase_branching.md†L53-L75】【F:.github/workflows/supabase-validate.yml†L1-L45】

## Evidence & Notes

### Branching Setup

- Supabase CLI configuration resides in `supabase/config.toml`, confirming the integration is pointed at the repo root as required for preview automation.【F:supabase/config.toml†L1-L95】
- The branching runbook details lifecycle expectations (creation, updates, teardown) and includes manual verification steps to audit preview environments from the dashboard.【F:docs/supabase_branching.md†L19-L52】

### Migration Hygiene

- `20250501150957_withered_heart.sql` now adds the replacement columns, backfills them, and only drops `authorized_hours` after confirming no rows rely on it. Review analytics/reporting code that referenced the old column and update Supabase types post-merge.【F:supabase/migrations/20250501150957_withered_heart.sql†L1-L64】
- Policy cleanup migrations such as `20250920120300_remove_legacy_session_client_therapist_policies.sql` rely on `DROP POLICY IF EXISTS`. Confirm successor policies exist and document the security intent in the accompanying PRs.【F:supabase/migrations/20250920120300_remove_legacy_session_client_therapist_policies.sql†L1-L27】
- Draft SQL under `temp_migrations/` remains untracked by Supabase previews. Promote or retire these files to keep the migration sequence linear and discoverable.【F:temp_migrations/20250630191056_broken_beacon.sql†L1-L72】【F:temp_migrations/route_fix_2025-07-10T00-19-41-268Z.sql†L1-L83】
- Run `supabase db lint` locally before each PR to catch ordering or dependency issues. The Supabase Validate workflow enforces this check on CI.【F:.github/workflows/supabase-validate.yml†L10-L34】

### Environment & Secrets

- `.env.example` covers all required Supabase keys (URL, anon, edge, service role, access token) plus Vite mirrors, guiding developers to copy values from preview projects.【F:.env.example†L1-L45】
- The runbook reiterates where to find preview keys, how they propagate to GitHub Actions, and warns against exposing the service-role key in client bundles.【F:docs/supabase_branching.md†L53-L80】

## Next Steps

1. Monitor analytics, exports, and Supabase types for any lingering references to `authorized_hours` and regenerate types after merging schema changes.【F:supabase/migrations/20250501150957_withered_heart.sql†L1-L64】
2. Promote or retire SQL drafts in `temp_migrations/` so preview databases mirror production-ready migrations.【F:temp_migrations/20250630191056_broken_beacon.sql†L1-L72】【F:temp_migrations/route_fix_2025-07-10T00-19-41-268Z.sql†L1-L83】
3. Audit recent policy-drop migrations and document the replacement policies to ensure RLS coverage remains intact.【F:supabase/migrations/20250920120300_remove_legacy_session_client_therapist_policies.sql†L1-L27】
4. Periodically validate that Supabase preview secrets remain synced to GitHub by checking recent runs of `supabase-validate.yml` for credential errors.【F:.github/workflows/supabase-validate.yml†L10-L34】
