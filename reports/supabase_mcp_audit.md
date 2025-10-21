# Supabase Audit Report – MCP Focus

_Date: 2025-07-01_

## Methodology
- Reviewed Supabase SQL migrations (functions, tables, policies) under `supabase/migrations`.
- Inspected Edge Function source under `supabase/functions` with emphasis on authentication, authorization, and service-role usage.
- Attempted to invoke Supabase MCP automation; the project tooling is unavailable in the container, so the analysis falls back to static code review. All gaps flagged below should be re-validated in a live environment once MCP access is restored.

## Findings

### 1. Postgres Functions

#### A. `public.insert_session_with_billing`
- **Location:** `supabase/migrations/20250924121000_rpc_insert_session_with_billing.sql`
- **Gap:** The security-definer RPC only allows execution when `app.user_has_role_for_org('therapist', ...)` is true or when the caller is an admin/super admin. However, the admin/super-admin checks omit organization context, so `app.user_has_role_for_org('admin')` / `'super_admin'` always returns `false` because the helper requires an organization id to compare. Legitimate admins therefore cannot use the RPC, and the intended privilege separation is broken.
- **Remediation:** Pass the target organization id (for example `app.user_has_role_for_org('admin', v_session.organization_id)` after resolving the session/org), or augment the helper to infer the caller's organization when optional arguments are omitted.
- **Risk:** Authorization logic silently excludes higher-privilege operators, encouraging workarounds (direct table writes via service role) that bypass auditing.

### 2. Edge Functions

#### A. `supabase/functions/mcp`
- **Gap:** The MCP bridge uses the service-role key for unrestricted table/RPC access and relies solely on a static `MCP_TOKEN` header for authorization. There is no per-tenant scoping, auditing, or throttling. If the token leaks, an attacker gets full database control without RLS safeguards.
- **Remediation:** Replace the raw service-role client with scoped RPCs that enforce organization context, rotate tokens frequently, log all operations, and add least-privilege allow-lists for tables/functions.

#### B. `supabase/functions/process-message`
- **Gap:** The fallback AI handler is fully public (`Deno.serve` without auth). Any caller can consume OpenAI quota and force arbitrary prompt content. There is no Supabase session validation, tenant isolation, or abuse prevention.
- **Remediation:** Wrap the handler with `createProtectedRoute`/`getUserOrThrow`, add rate limiting, or restrict invocation to signed cron tokens.

### 3. Tables & RLS Policies

#### A. `public.admin_actions`
- **Location:** `supabase/migrations/20250922120000_secure_misc_tables_rls.sql`
- **Gap:** The `admin_actions_admin_read` policy only checks `auth.user_has_role('admin' | 'super_admin')`. Because `auth.user_has_role` grants admins a global “allow all”, any admin can read every organization’s audit log. Policies never verify `organization_id`, so cross-tenant data exposure remains.
- **Remediation:** Replace the policy with an organization-aware predicate, e.g. `app.user_has_role_for_org('admin', organization_id)` / `'super_admin'`, ensuring admins see only their tenant’s records. Extend the insert policy similarly.

## Recommended Next Steps
1. Fix the role helper invocation inside `insert_session_with_billing` and add regression tests to cover admin flows.
2. Harden the MCP Edge Function by enforcing per-request auth, auditing, and narrow capabilities before exposing it to production automations.
3. Tighten `admin_actions` RLS policies to require matching `organization_id` and rerun Supabase tests to verify tenant isolation.

---
_This report is based on static analysis due to missing MCP connectivity in the container. Re-run the audit with live MCP tooling before deployment._
