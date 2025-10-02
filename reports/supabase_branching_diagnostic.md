# Supabase Branching Diagnostic

## Summary Findings

- ✅ **Branching setup health:** Supabase integration configured for repo root with automatic preview branches (limit 50). Preview workflow already provisions isolated DBs per PR; destruction occurs on PR close per Supabase integration defaults. No repo path issues—`supabase/config.toml` and `supabase/migrations/` live at the root.
- 🟧 **Migration hygiene status:** Migrations are timestamped, but several scripts perform replacements (`DROP CONSTRAINT`, `DROP POLICY`) before recreating updated objects. They include safety guards (`IF EXISTS`, partial index recreation), yet reviewers should verify each destructive adjustment aligns with forward-only strategy. Recommend continuing to author migrations via `supabase db diff --use-migrations` and running `supabase db lint` in CI (added in this PR) before merge.
- ✅ **Env/secrets review:** Preview credentials are supplied via Supabase GitHub integration secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). A new `.env.example` documents required variables. Service role usage remains server/test only—no client bundles contain it.

## Next Steps

1. Monitor the new **Supabase Validate** workflow on upcoming pull requests to ensure `supabase db lint` surfaces migration issues early.
2. For migrations that replace constraints or policies, document rollback strategies in PR descriptions to mitigate potential production failures.
3. Periodically audit the Supabase dashboard preview list to ensure previews are cleaned up automatically and branch quotas stay below the configured limit (50).
