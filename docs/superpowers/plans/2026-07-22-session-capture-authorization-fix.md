# WIN-240 Session Capture Authorization Fix Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Let an exact assigned BT save capture for an existing session when authorization rows exist but are intentionally hidden from ambient BT table reads.

**Architecture:** Add one authenticated, session-scoped `SECURITY DEFINER` resolver that accepts only a session ID and derives actor, tenant, client, therapist, authorization, service, and billing mode from persisted data. Return the minimal billing defaults plus canonical session client/therapist bindings required to protect the server write. Use it for the BT-only modal preflight and the BT legacy upsert branch; preserve existing non-BT behavior and do not broaden `authorizations` RLS.

**Tech stack:** React, TypeScript, TanStack Query, Supabase/Postgres RPC, Vitest.

## Global constraints

- Route: `classification=high-risk human-reviewed`, `lane=critical`.
- Tracking issue: `WIN-240`.
- Work only on `codex/session-capture-authorization-fix` in the isolated worktree.
- Do not alter general `authorizations` or `authorization_services` RLS.
- The resolver accepts only `p_session_id uuid`; it must not trust caller-provided org, client, therapist, authorization, service, role, or timing values.
- Require exact BT role, active BT/RBT therapist binding, current-org session scope, assigned actor/link, and the existing capture capability check.
- Return `authorization_id`, `service_code`, `strict_billing`, and the canonical session client/therapist UUIDs required to bind the server write to the resolved session.
- Use `SECURITY DEFINER`, `set search_path = ''`, fully qualified names, revoke `public, anon`, and grant `authenticated` only.
- Preserve strict/relaxed billing selection behavior from the reviewed BT closeout path. Relaxed mode still requires an authorization row and may use `UNSPECIFIED` when no service exists.
- Stop and re-route if containment requires a general authorization listing, broad RLS/grant changes, unrelated Schedule orchestration, or a new draft-write RPC family.

## Task 1: Lock the resolver contract with failing tests

**Files:**

- Create: `tests/sessionCaptureAuthorizationResolverMigration.test.ts`
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/server/__tests__/sessionNotesUpsertHandler.test.ts`

1. Add a migration contract test that locates the WIN-240 migration and asserts:
   - the public resolver accepts only a session UUID;
   - exact-BT, active BT/RBT, current-org, assigned-session, linked-user, and capture-capability checks are present;
   - canonical strict/relaxed authorization and service selection is present;
   - output is limited to billing defaults;
   - `SECURITY DEFINER`, empty search path, revoke, and authenticated-only grant are present.
2. Add a modal regression test in BT/data-collection-only mode proving billing defaults are loaded through the resolver and the direct `authorizations` table chain is not required.
3. Add handler tests proving the assigned-BT legacy upsert branch:
   - consumes the resolver when direct authorization REST access would be empty;
   - ignores stale/mismatched caller billing hints in favor of resolver output;
   - fails closed on resolver denial/upstream failure.
4. Run the focused tests and confirm they fail for the missing resolver behavior:

```powershell
node node_modules\vitest\vitest.mjs run tests\sessionCaptureAuthorizationResolverMigration.test.ts src\components\__tests__\SessionModal.test.tsx src\server\__tests__\sessionNotesUpsertHandler.test.ts --reporter=verbose
```

## Task 2: Add the session-scoped billing resolver

**Files:**

- Create: one CLI-generated `supabase/migrations/*_resolve_assigned_bt_session_capture_billing.sql`
- Modify only if contract parity requires it: `tests/btAbaSessionNoteMigration.test.ts`

1. Generate the migration with `supabase migration new resolve_assigned_bt_session_capture_billing`.
2. Implement `public.resolve_assigned_bt_session_capture_billing(p_session_id uuid)` as a fixed-search-path `SECURITY DEFINER` function.
3. Derive the persisted session and actor; fail closed for missing actor/session, cross-org scope, non-exact-BT roles, inactive/non-BT therapist rows, unassigned actors, or failed capture capability.
4. Copy the reviewed billing-selection semantics from `20260716212837_bt_aba_session_note_closeout.sql` without exposing full authorization/service rows.
5. Revoke execute from `public, anon`; grant only `authenticated`.
6. Run the migration contract test and confirm green.

## Task 3: Replace the BT modal preflight with the resolver

**Files:**

- Modify: `src/components/SessionModal.tsx`
- Modify: `src/components/__tests__/SessionModal.test.tsx`

1. For exact BT/data-collection-only existing-session capture, call the resolver with `session.id` and normalize the single returned billing default into the existing local authorization shape.
2. Preserve the existing direct authorization query for non-BT paths.
3. Keep the existing submit payload shape and error copy; do not add a broad billing-data response.
4. Run the focused modal test and confirm green.

## Task 4: Canonicalize the BT legacy upsert branch

**Files:**

- Modify: `src/server/api/session-notes-upsert.ts`
- Modify: `src/server/__tests__/sessionNotesUpsertHandler.test.ts`

1. Track whether the request entered through the narrow assigned-BT client-data branch rather than an existing therapist/admin/member/super-admin role.
2. For that branch and an existing `sessionId`, call the resolver using the caller token.
3. Use resolver-returned authorization/service values for validation and persistence; do not let body hints select a different authorization or service.
4. Leave the existing non-BT authorization validation path unchanged.
5. Fail closed with the existing API envelope on resolver denial, missing billing context, or upstream failure.
6. Run the focused handler test and confirm green.

## Task 5: Verify the bounded critical-lane slice

**Files:**

- Modify: `docs/ai/WIN-240-session-capture-authorization-fix-handoff.md`

1. Run focused regression groups:

```powershell
node node_modules\vitest\vitest.mjs run tests\sessionCaptureAuthorizationResolverMigration.test.ts src\components\__tests__\SessionModal.test.tsx src\pages\__tests__\Schedule.orchestration.integration.test.tsx src\lib\__tests__\session-notes.test.ts src\server\__tests__\sessionNotesUpsertHandler.test.ts tests\edge\api-contract-envelope.test.ts tests\btAbaSessionNoteMigration.test.ts --reporter=dot
```

2. Run required local checks:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run build
npm run test:routes:tier0
```

3. Run `npm run ci:playwright` if the required browser credentials are available; otherwise record the exact CI-only blocker.
4. Run `verify-change`, obtain security/Supabase/code/test specialist verdicts, and run `pr-hygiene`.
5. Record known pre-existing clean-`origin/main` failures separately from WIN-240 results:
   - workflow contract mismatch in `tests/workflows/bt-aba-disposable-browser-proof.test.ts`;
   - Node 24 `blob.text()` incompatibility in `src/lib/__tests__/supabase.edge.test.ts`;
   - any other baseline failures must be isolated and documented before claiming the suite result.
6. Update the Linear issue and handoff with exact executed/blocked checks and residual risk.

## Task 6: Human-review handoff

1. Request focused `code-review-engineer`, `security-engineer`, `supabase-reviewer`, and `test-engineer` reviews of the final diff.
2. Commit only WIN-240 files, push `codex/session-capture-authorization-fix`, and open a PR linked to WIN-240.
3. Report live checks and exact human-review/branch-protection blockers. Do not merge this critical protected-path change without the required human review.
