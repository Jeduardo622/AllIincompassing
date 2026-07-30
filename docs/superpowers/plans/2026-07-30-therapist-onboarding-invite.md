# Therapist Onboarding Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make therapist onboarding automatically issue a secure, tenant-scoped account invite that deterministically links the accepted Auth user to the intended therapist row.

**Architecture:** Extend the existing staff-invite token with an explicit therapist target and durable lifecycle state. Keep account creation in `accept-staff-invite`, add canonical organization and therapist validation at both privileged boundaries, and make the frontend distinguish directory creation from invite delivery.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase Auth/Postgres/Edge Functions, Zod, Vitest, Playwright.

## Global Constraints

- Linear issue WIN-265 is required.
- Route classification is `high-risk human-reviewed`; lane is `critical`.
- `user_roles` remains authoritative and `profiles.role` remains a mirror.
- The application role for therapist-directory invitations is `bt`.
- Never persist, log, or expose a plaintext password or raw invite token.
- Never match a therapist account to a directory row by email alone.
- No production mutation before review-ready verification.
- Human review is mandatory before merge.

---

### Task 1: Persist therapist targets and invite lifecycle

**Files:**
- Create: `supabase/migrations/20260730170000_therapist_invite_target_lifecycle.sql`
- Modify: `src/lib/generated/database.types.ts`
- Create: `tests/admins/therapist_invite_target_migration.spec.ts`

**Interfaces:**
- Consumes: `create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, role_type, uuid)`.
- Produces: `admin_invite_tokens.target_therapist_id`, `accepted_at`, `accepted_by_user_id`, and `revoked_at`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
expect(migrationSql).toMatch(/add column if not exists target_therapist_id uuid/i);
expect(migrationSql).toMatch(/references public\.therapists\(id\)/i);
expect(migrationSql).toMatch(/accepted_at timestamptz/i);
expect(migrationSql).toMatch(/accepted_by_user_id uuid/i);
expect(migrationSql).toMatch(/revoked_at timestamptz/i);
expect(functionSql).toMatch(/p_target_therapist_id uuid/i);
expect(functionSql).not.toMatch(/auth\.uid\(\)/i);
expect(migrationSql).toMatch(/grant execute[\s\S]+to service_role/i);
```

- [ ] **Step 2: Run the migration test and confirm it fails because the forward migration does not exist**

Run: `npx vitest run tests/admins/therapist_invite_target_migration.spec.ts`

Expected: FAIL reading the missing migration.

- [ ] **Step 3: Add the forward migration**

Add nullable lifecycle columns with foreign keys, indexes for active target lookup, and a seven-argument service-role-only RPC. The RPC must validate normalized email, organization, expiration, inviter, role, and, when present, this target predicate:

```sql
exists (
  select 1
  from public.therapists t
  where t.id = p_target_therapist_id
    and t.organization_id = p_organization_id
    and t.deleted_at is null
    and lower(coalesce(t.status, 'active')) = 'active'
    and lower(trim(t.email)) = v_normalized_email
)
```

Active duplicate checks must include:

```sql
and t.accepted_at is null
and t.revoked_at is null
and t.expires_at > v_now
```

- [ ] **Step 4: Update generated database types**

Add nullable row/update fields, nullable insert fields, and the `target_therapist_id` relationship to `src/lib/generated/database.types.ts`.

- [ ] **Step 5: Run the migration contract tests**

Run: `npx vitest run tests/admins/therapist_invite_target_migration.spec.ts tests/admins/invite_rate_limit_service_role_migration.spec.ts tests/security/public-security-definer-rpc-grants.security.spec.ts`

Expected: PASS.

### Task 2: Harden and target invite issuance

**Files:**
- Modify: `supabase/functions/admin-invite/index.ts`
- Modify: `tests/admins/invite_flow.spec.ts`

**Interfaces:**
- Consumes: optional request field `targetTherapistId: string`.
- Produces: an invite whose service-owned record is bound to the validated therapist ID.

- [ ] **Step 1: Add failing issuance tests**

Add cases proving:

```ts
expect(createAdminRpc).toHaveBeenCalledWith(
  'create_admin_invite_token_rate_limited',
  expect.objectContaining({ p_target_therapist_id: 'therapist-1' }),
);
expect(resolveOrgId).toHaveBeenCalledWith(expect.anything());
```

Also cover mismatched organization, email, inactive status, and soft deletion returning 409/403 without invoking the RPC or email provider.

- [ ] **Step 2: Run the focused invite tests and confirm the new cases fail**

Run: `npx vitest run tests/admins/invite_flow.spec.ts`

Expected: FAIL because `targetTherapistId` and canonical organization resolution are not implemented.

- [ ] **Step 3: Implement canonical scope and target validation**

Extend the Zod schema with:

```ts
targetTherapistId: z.string().uuid().optional(),
```

Resolve non-super-admin organization with `resolveOrgId(adminClient)`. For a target, query `supabaseAdmin.from("therapists")` for `id,email,organization_id,status,deleted_at`, validate the design predicates, and pass:

```ts
p_target_therapist_id: payload.targetTherapistId ?? null,
```

Include the target ID in the audit details without including the raw token.

- [ ] **Step 4: Revoke failed-delivery invites**

Replace hard deletion on email failure with an update that sets `revoked_at` for the exact invite ID and organization. Return `invite_rollback_failed` when revocation cannot be persisted.

- [ ] **Step 5: Run the focused invite tests**

Run: `npx vitest run tests/admins/invite_flow.spec.ts`

Expected: PASS.

### Task 3: Provision the exact therapist link at acceptance

**Files:**
- Modify: `supabase/functions/accept-staff-invite/index.ts`
- Modify: `tests/admins/accept_invite_flow.spec.ts`

**Interfaces:**
- Consumes: an unaccepted, unrevoked invite with optional `target_therapist_id`.
- Produces: Auth user, authoritative role, mirrored profile, exact `user_therapist_links` row, and durable invite acceptance.

- [ ] **Step 1: Add failing acceptance tests**

Extend the fixture with therapist rows, inserted therapist links, token lifecycle updates, and failure toggles. Assert:

```ts
expect(insertedTherapistLinks).toEqual([
  { user_id: 'new-user-1', therapist_id: 'therapist-1' },
]);
expect(consumedInvites).toEqual([
  expect.objectContaining({ id: 'invite-1', accepted_by_user_id: 'new-user-1' }),
]);
```

Add cross-org, email-mismatch, inactive, deleted, replay, link-failure, and consumption-failure cases.

- [ ] **Step 2: Run the focused acceptance tests and confirm the new cases fail**

Run: `npx vitest run tests/admins/accept_invite_flow.spec.ts`

Expected: FAIL because target validation, therapist linking, and durable consumption are absent.

- [ ] **Step 3: Validate the target before account creation**

Select lifecycle and target fields with the token. Reject accepted or revoked tokens. When targeted, load the therapist and require exact organization, normalized email, active status, and no `deleted_at`.

- [ ] **Step 4: Insert the link and consume the invite**

After role and profile writes, insert:

```ts
await supabaseAdmin.from("user_therapist_links").upsert(
  { user_id: userId, therapist_id: inviteRecord.target_therapist_id },
  { onConflict: "user_id,therapist_id" },
);
```

Then compare-and-set `accepted_at` and `accepted_by_user_id` where `accepted_at` and `revoked_at` are null. Any failure invokes the existing Auth-user cleanup and returns a fail-closed error.

- [ ] **Step 5: Run the focused acceptance tests**

Run: `npx vitest run tests/admins/accept_invite_flow.spec.ts`

Expected: PASS.

### Task 4: Make therapist onboarding send and retry the targeted invite

**Files:**
- Modify: `src/components/TherapistOnboarding.tsx`
- Modify: `src/components/__tests__/TherapistOnboarding.test.tsx`
- Modify: `src/components/TherapistDetails/ProfileTab.tsx`
- Modify: `src/components/__tests__/TherapistProfileInvite.test.tsx`

**Interfaces:**
- Consumes: the created therapist row `{ id, email, organization_id }`.
- Produces: `admin-invite` calls containing `targetTherapistId` and accurate success/failure UI.

- [ ] **Step 1: Add failing component tests**

Mock `supabase.functions.invoke` and assert onboarding sends:

```ts
expect(invoke).toHaveBeenCalledWith('admin-invite', {
  body: expect.objectContaining({
    email: 'avery@example.com',
    organizationId: 'org-test',
    role: 'bt',
    targetTherapistId: 'therapist-1',
  }),
});
```

Add a failure case asserting the completion callback still receives the valid therapist creation result while the UI reports that the invite was not sent. Update the profile retry assertion with the exact therapist ID.

- [ ] **Step 2: Run the component tests and confirm the new assertions fail**

Run: `npx vitest run src/components/__tests__/TherapistOnboarding.test.tsx src/components/__tests__/TherapistProfileInvite.test.tsx`

Expected: FAIL because onboarding does not invoke the Edge Function and profile retry omits the target.

- [ ] **Step 3: Implement targeted invite issuance**

After the therapist insert and document attempts, invoke:

```ts
await supabase.functions.invoke('admin-invite', {
  body: {
    email: therapist.email,
    organizationId: activeOrganizationId,
    role: 'bt',
    reason: `Invite ${therapist.full_name} to access their therapist profile.`,
    targetTherapistId: therapist.id,
  },
});
```

Return `{ therapist, inviteSent }` from the mutation. Show `Therapist created and invite sent` only when both operations succeed; otherwise show a specific recoverable invite error and navigate to the created therapist record or list.

- [ ] **Step 4: Add the target to profile retry**

Include `targetTherapistId: therapist.id` in `ProfileTab`'s existing `admin-invite` request.

- [ ] **Step 5: Run the focused component tests**

Run: `npx vitest run src/components/__tests__/TherapistOnboarding.test.tsx src/components/__tests__/TherapistProfileInvite.test.tsx`

Expected: PASS.

### Task 5: Critical-lane verification and handoff

**Files:**
- Create: `docs/ai/handoffs/WIN-265-therapist-onboarding-invite.md`
- Modify: `docs/superpowers/plans/2026-07-30-therapist-onboarding-invite.md`

**Interfaces:**
- Consumes: test output, hosted read-only evidence, specialist reviews, and live PR state.
- Produces: verification card, PR-hygiene verdict, and human-review-ready PR.

- [ ] **Step 1: Run focused regression tests**

Run:

```powershell
npx vitest run tests/admins/invite_flow.spec.ts tests/admins/accept_invite_flow.spec.ts tests/admins/therapist_invite_target_migration.spec.ts src/components/__tests__/TherapistOnboarding.test.tsx src/components/__tests__/TherapistProfileInvite.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the critical verification matrix**

Run:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run build
npm run verify:local
```

Run `npm run ci:playwright` only where its required protected credentials are available; otherwise record the exact blocker.

- [ ] **Step 3: Obtain independent reviews**

Require `code-review-engineer`, `test-engineer`, `security-engineer`, and `supabase-reviewer` verdicts with file/command evidence. Resolve all in-scope findings and rerun affected checks.

- [ ] **Step 4: Write the handoff and run workflow skills**

Record route, scope, files, migration behavior, connector evidence, executed and blocked checks, residual risk, and reviewer verdicts. Run `verify-change` and `pr-hygiene`.

- [ ] **Step 5: Commit, push, and open a human-review PR**

```powershell
git add docs src supabase tests
git commit -m "fix: complete therapist account onboarding"
git push -u origin codex/therapist-onboarding-invite
```

Create a PR linked to WIN-265 and stop before merge pending required human review.
