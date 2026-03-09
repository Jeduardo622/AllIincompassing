### Tenant Isolation Validation (Supabase CLI/MCP)

Run these commands with the Supabase CLI authenticated against the target project:

```bash
# Confirm function security modes
supabase functions list --project-ref "${SUPABASE_PROJECT_REF}" --verbose | grep get_dashboard_data

# Inspect function grants
supabase inspect db --linked --schema public --query "SELECT * FROM information_schema.role_routine_grants WHERE routine_name = 'get_dashboard_data';"

# Review table policies
supabase inspect db --linked --schema public --query "\d+ public.sessions"
supabase inspect db --linked --schema public --query "\d+ public.therapists"
supabase inspect db --linked --schema public --query "\d+ public.clients"
supabase inspect db --linked --schema public --query "\d+ public.billing_records"

# Dry run org-scoped queries (replace UUIDs with seeded users/orgs)
psql "$SUPABASE_DB_URL" -c "select count(*) from sessions where organization_id = 'ORG_A' and app.user_has_role_for_org('therapist', 'ORG_A');"
psql "$SUPABASE_DB_URL" -c "select count(*) from sessions where organization_id = 'ORG_B' and app.user_has_role_for_org('therapist', 'ORG_A'); -- expect 0"
```

> **Note:** Replace `ORG_A` / `ORG_B` with real organization IDs and adjust roles to match your deployment. Each command should return data solely for the caller’s organization; any non-zero cross-org result must be investigated.

