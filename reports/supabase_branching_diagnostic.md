# Supabase Branching Diagnostic

## Summary Findings

- ✅ **Branching setup health:** Supabase remains configured at the repository root. `supabase/config.toml` and the migrations directory live at `./supabase`, aligning with the integration’s expectations for automatic preview database provisioning and teardown on pull requests.【F:supabase/config.toml†L1-L40】【F:docs/supabase_branching.md†L9-L31】
- ❌ **Migration hygiene status:** Most scripts are additive, but `supabase/migrations/20250501150957_withered_heart.sql` drops the `authorized_hours` column without a data backfill, which is destructive and irreversible on preview and production databases.【F:supabase/migrations/20250501150957_withered_heart.sql†L15-L28】 This migration should be refactored into a staged rollout (add new columns, copy values, then drop the legacy column once data is migrated).
- 🟧 **Env/secrets review:** `.env.example` now documents all Supabase credentials with placeholders, and the runbook clarifies that preview keys come from the Supabase dashboard while CI pulls them from GitHub secrets.【F:.env.example†L1-L57】【F:docs/supabase_branching.md†L46-L61】 Verify the Supabase GitHub integration continues syncing these secrets so workflows can lint migrations and run tests.【F:.github/workflows/supabase-validate.yml†L1-L45】

## Next Steps

1. Rewrite `20250501150957_withered_heart.sql` as a forward-only migration that preserves existing `authorized_hours` data (e.g., add new columns, copy data, then sunset the old column in a follow-up release).
2. Schedule a quarterly audit of the migrations directory to catch future destructive operations early and ensure naming stays consistently timestamped.
3. Monitor the Supabase Validate workflow logs to confirm preview credentials remain synchronized and `supabase db lint` keeps running on every pull request.
