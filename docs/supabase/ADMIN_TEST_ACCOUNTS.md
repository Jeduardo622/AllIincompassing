# Admin Test Account Runbook

This guide explains how to (re)seed the diagnostic admin accounts that our UI and E2E checks depend on, and how to verify that the Supabase `auth.users` metadata stays aligned with `public.profiles.role`.

## 1. Prerequisites

- Supabase project `wnnjeqheqxxyrgsjmygy`
- Service role key (store in your shell as `SUPABASE_SERVICE_ROLE_KEY`)
- Project URL (`SUPABASE_URL=https://wnnjeqheqxxyrgsjmygy.supabase.co`)
- Optional: override the seed password via `SEED_ACCOUNT_PASSWORD` (defaults to `Password123!`)

All commands below are executed from the repository root.

## 2. Seed the diagnostic accounts

```
SUPABASE_URL="https://wnnjeqheqxxyrgsjmygy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
SEED_ACCOUNT_PASSWORD="<strong-password>" \
npx tsx scripts/seed-admin-users.ts
```

The script performs the following:

- Creates or refreshes `admin@test.com` (role: `admin`, no `organization_id`)
- Creates or refreshes `superadmin@test.com` (role: `super_admin`, no `organization_id`)
- Resets passwords (handy for CI/Playwright smoke runs)
- Ensures `user_roles` and `profiles.role` are aligned with the metadata

The output table highlights whether each account was created or updated. Non-zero exit codes indicate at least one failure; re-run after fixing inputs.

## 3. Verify role alignment

After seeding (or whenever you suspect drift), run:

```
SUPABASE_URL="https://wnnjeqheqxxyrgsjmygy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npx tsx scripts/check-role-drift.ts
```

The script aggregates `auth.users` metadata and `public.profiles` records:

- Reports mismatches (e.g., metadata says `admin` but profile is still `client`)
- Flags missing profiles for high-privilege users
- Exits with code `1` when drift is detected (ideal for CI alerts)

## 4. Optional: Supabase MCP quick checks

If you prefer to stay inside Cursor, you can spot-check with the Supabase MCP database tools. Examples:

```
# List profile roles for diagnostic accounts
mcp_supabase_execute_sql query="select email, role from profiles where email in ('admin@test.com', 'superadmin@test.com');"

# Inspect metadata role for admin users
mcp_supabase_execute_sql query="select email, raw_user_meta_data->>'role' as metadata_role from auth.users where email in ('admin@test.com', 'superadmin@test.com');"
```

> ⚠️ MCP commands require the Supabase server to be enabled in Cursor and inherit the same credentials as above.

## 5. Housekeeping reminders

- Rotate the seed password periodically and update any automated tests that rely on it.
- After seeding, sign in via the hosted app to confirm the UI reflects the new organization guardrails.
- Keep `scripts/seed-admin-users.ts` and `scripts/check-role-drift.ts` under version control so future agents can reuse them.


