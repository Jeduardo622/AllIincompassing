# Admin Users RPC Exposure Hardening

- issue: WIN-212
- classification: high-risk human-reviewed
- lane: critical
- live project: wnnjeqheqxxyrgsjmygy
- scope: Repair live-proven `public.get_admin_users` RPC exposure drift, restore the documented service-role metadata wrapper for `public.manage_admin_users`, and normalize `public.admin_users` view grants.
- non-goals: Do not change `get_admin_users_paged`, the two-argument browser `manage_admin_users` RPC, admin role semantics, RLS policies, UI components, or auth/session code.

## Live Evidence Before Repair

- `public.get_admin_users()` existed as `SECURITY DEFINER`, `search_path=public, auth`, `authenticated_execute=true`, and returned all admin/super-admin rows without caller authorization or organization checks.
- `public.get_admin_users(p_org_id uuid)` existed as `SECURITY DEFINER`, `authenticated_execute=true`, and delegated to `public.get_admin_users()` without using `p_org_id`.
- `public.get_admin_users_paged(organization_id uuid, p_limit integer, p_offset integer)` already performed authentication and organization checks and was left unchanged.
- `public.manage_admin_users(operation text, target_user_id text)` remained the intended authenticated browser RPC with internal checks.
- `public.manage_admin_users(operation text, target_user_id text, caller_organization_id uuid)` remained limited to `service_role` and `app_admin_executor`.
- The `public.manage_admin_users(operation text, target_user_id text, metadata jsonb)` compatibility wrapper expected by `src/server/rpc/admin.ts` was absent.
- `public.admin_users` had `security_barrier=true` and `security_invoker=true`, but live ACLs included DML-style privileges for `authenticated` and `service_role`; intended local hardening grants were read-only.

## Intended Boundary

- `get_admin_users(organization_id uuid default null)` returns `SETOF public.admin_users`.
- Service-role callers may list all admin users or filter by organization.
- The service-role branch intentionally reads `auth.users` + `user_roles` + `roles` directly because the `admin_users` view is filtered by `auth.uid()`.
- Super admins may list all admin users or filter by organization.
- Regular active admins may list only their own organization and receive `42501` on cross-organization requests.
- `anon` has no execute/select access.
- `admin_users` grants are read-only for `authenticated`, `service_role`, and `app_admin_executor`.
- `manage_admin_users(text,text,jsonb)` exists only for service-role server callers and delegates to the current two-argument implementation.

## Required Verification

- Live post-apply SQL over `pg_proc`, `pg_class`, `aclexplode`, `has_function_privilege`, `pg_get_functiondef`, and `to_regprocedure`.
- `npx vitest run tests/admins/admin_users_rpc_exposure.spec.ts tests/admins/manage_admin_users_advisor_surface.spec.ts`
- `npm run ci:check-focused`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local` when local prerequisites allow it.

## Verification Card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: database/RLS/migrations/tenant isolation; server/RPC contract typing; docs/handoff
- Required checks:
  - `npx vitest run tests/admins/admin_users_rpc_exposure.spec.ts tests/admins/manage_admin_users_advisor_surface.spec.ts tests/admins/cross_org_denied.spec.ts src/server/rpc/__tests__/admin.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run ci:verify-coverage`
  - `npm run test:routes:tier0`
  - `npm run verify:local`
  - Hosted post-apply SQL over `pg_proc`, `pg_class`, `aclexplode`, `has_function_privilege`, `pg_get_functiondef`, and `to_regprocedure`
- Executed checks:
  - `npm ci`: pass; installed isolated worktree dependencies. Existing audit output reported 24 vulnerabilities and a Node engine warning for `eslint-visitor-keys@5.0.1` on Node v20.17.0.
  - `npx vitest run tests/admins/admin_users_rpc_exposure.spec.ts tests/admins/manage_admin_users_advisor_surface.spec.ts`: pass; 2 files, 12 tests.
  - `npx vitest run tests/admins/admin_users_rpc_exposure.spec.ts tests/admins/manage_admin_users_advisor_surface.spec.ts tests/admins/cross_org_denied.spec.ts src/server/rpc/__tests__/admin.test.ts`: pass; 4 files, 21 tests.
  - `npm run ci:check-focused`: pass; DB-backed checks skipped because `SUPABASE_DB_URL`/`DATABASE_URL` were not configured.
  - `npm run validate:tenant`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass.
  - `npm run lint`: pass.
  - `npm run test:ci` without synthetic Supabase env: fail; 12 tests failed because `VITE_SUPABASE_URL` was missing from the isolated worktree environment.
  - `npm run test:ci` with synthetic non-secret Supabase env values: pass; 367 files passed, 2377 tests passed, 1 skipped.
  - `npm run verify:local` with synthetic non-secret Supabase env values: fail; policy, lint, typecheck, and most of `test:ci` ran, then one unrelated test timed out: `tests/ci/deploy-session-edge-bundle.test.ts`.
  - `npx vitest run tests/ci/deploy-session-edge-bundle.test.ts`: pass on immediate rerun; 1 file, 1 test.
  - `npm run ci:verify-coverage`: pass; line coverage 92.07% against required 86.00%.
  - `npm run test:routes:tier0`: pass; 7 Cypress specs, 220 tests.
  - Post-rebase `npx vitest run tests/admins/admin_users_rpc_exposure.spec.ts tests/admins/manage_admin_users_advisor_surface.spec.ts tests/admins/cross_org_denied.spec.ts src/server/rpc/__tests__/admin.test.ts`: pass; 4 files, 21 tests.
- Blocked checks:
  - Hosted post-apply SQL verification is blocked until human-reviewed migration apply. Pre-apply hosted evidence was collected through Supabase MCP and showed the drift this migration repairs.
  - `npm run verify:local` did not complete as a single green aggregate because `tests/ci/deploy-session-edge-bundle.test.ts` timed out once during the aggregate run; the exact test passed on immediate targeted rerun, and the aggregate components that did not run after the timeout were executed separately and passed.
- Result: pass-with-blocked-checks
- Residual risk: The migration touches privileged RPC and grant behavior and still requires human Supabase/security review plus hosted post-apply read-back before production closure.

## PR Hygiene Verdict

- pr-ready: yes, for human review; not autonomous merge-ready
- lane: critical
- branch-ready: yes; dedicated `codex/admin-users-rpc-hardening` worktree branch rebased onto `origin/main`
- linear-ready: yes; `WIN-212`
- single-purpose: yes
- unrelated changes: none after removing generated `reports/test-reliability-latest.json`
- generated artifact drift: none; `src/lib/generated/database.types.ts` is aligned with the repaired `get_admin_users(organization_id uuid default null)` return shape
- protected-path drift: expected and contained to `supabase/migrations/**` plus supporting test/type/doc files
- change summary: present
- verification summary: present
- pr handoff: ready
- reviewer: completed; final reviewer found no SQL correctness blocker and requested the verification/pr-hygiene artifacts now recorded here
- required follow-up: human review, PR checks, and hosted post-apply SQL read-back
- handoff summary: Repairs live admin-users RPC exposure by replacing unscoped JSON `get_admin_users` overloads with an org-checked `SETOF admin_users` RPC, preserving service-role server listing through direct base-table reads, restoring the service-role-only `manage_admin_users(text,text,jsonb)` compatibility wrapper, and normalizing `admin_users` grants to read-only intended roles.

## Residual Risk

This migration changes privileged Supabase RPC and grant behavior. Human Supabase/security review is required before merge and hosted apply.
