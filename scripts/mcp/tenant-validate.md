### Tenant Isolation Validation (Supabase CLI/MCP)

Run these commands with the Supabase CLI authenticated against the target project:

```bash
# Confirm function security modes
supabase functions list --project-ref "${SUPABASE_PROJECT_REF}" --verbose | grep get_dashboard_data

# Inspect function grants
supabase db remote inspect --project-ref "${SUPABASE_PROJECT_REF}" --schema public --sql "SELECT * FROM information_schema.role_routine_grants WHERE routine_name = 'get_dashboard_data';"

# Review table policies
supabase db remote inspect --project-ref "${SUPABASE_PROJECT_REF}" --schema public --sql "\d+ public.sessions"
supabase db remote inspect --project-ref "${SUPABASE_PROJECT_REF}" --schema public --sql "\d+ public.therapists"
supabase db remote inspect --project-ref "${SUPABASE_PROJECT_REF}" --schema public --sql "\d+ public.clients"
supabase db remote inspect --project-ref "${SUPABASE_PROJECT_REF}" --schema public --sql "\d+ public.billing_records"

# Dry run org-scoped queries (replace UUIDs with seeded users/orgs)
supabase db remote exec --project-ref "${SUPABASE_PROJECT_REF}" --sql "select count(*) from sessions where organization_id = 'ORG_A' and app.user_has_role_for_org('therapist', 'ORG_A');"
supabase db remote exec --project-ref "${SUPABASE_PROJECT_REF}" --sql "select count(*) from sessions where organization_id = 'ORG_B' and app.user_has_role_for_org('therapist', 'ORG_A'); -- expect 0"
```

> **Note:** Replace `ORG_A` / `ORG_B` with real organization IDs and adjust roles to match your deployment. Each command should return data solely for the caller’s organization; any non-zero cross-org result must be investigated.
