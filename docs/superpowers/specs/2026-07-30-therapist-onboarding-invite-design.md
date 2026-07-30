# Therapist Onboarding Invite Design

Issue: WIN-265

## Goal

Make therapist onboarding produce a usable, tenant-scoped staff account path instead of stopping after a `therapists` directory row is created.

## Current Failure

`TherapistOnboarding` inserts `public.therapists` and reports success without issuing an account invite. The existing staff invite acceptance path creates an Auth user, `user_roles`, and `profiles`, but it does not bind the new Auth user to the intended therapist row through `user_therapist_links`.

Hosted project `wnnjeqheqxxyrgsjmygy` also has invite RPC drift: `create_admin_invite_token_rate_limited` is executable only by `service_role` while its body still requires `auth.uid() = p_created_by`. `admin-invite` calls the RPC with the service-role client, so the hosted contract cannot succeed.

## Approved Design

The application will use the existing secure invitation model. Administrators will not choose or transmit a bootstrap password.

After a therapist directory row is created, `TherapistOnboarding` will call `admin-invite` with the normalized email, active organization, canonical `bt` application role, and the exact new therapist row ID. A successful response reports that the therapist and invite were created. An invite delivery failure preserves the valid therapist directory row, reports that account access was not provisioned, and directs the administrator to retry from the therapist profile. The existing profile invite action will send the same explicit therapist target so it is the deterministic retry path.

`admin-invite` will resolve the caller's organization through the request-scoped `current_user_organization_id` RPC, not editable Auth metadata. Super admins may supply an explicit target organization under the existing elevated-role rules. When a therapist target is supplied, the Edge Function and service-role RPC will both require:

- the target therapist exists;
- the target is not soft deleted;
- the target status is active;
- the target belongs to the invite organization; and
- the normalized therapist email equals the normalized invite email.

The invite record will retain an explicit nullable `target_therapist_id` and durable lifecycle fields: `accepted_at`, `accepted_by_user_id`, and `revoked_at`. Generic staff invites remain supported with no therapist target.

`accept-staff-invite` will load only unaccepted, unrevoked invite records. For a therapist-targeted invite it will revalidate therapist organization, active status, deletion state, and email before creating an account. It will then create the Auth user, assign the authoritative `user_roles` entry, mirror the role and organization into `profiles`, and insert the exact `user_therapist_links` row. The invite is marked accepted with a compare-and-set update only after all provisioning writes succeed. If role, profile, therapist-link, or invite-consumption work fails, the newly created Auth user is deleted; cascading foreign keys remove dependent account rows while the existing therapist directory row remains intact and the invite stays retryable.

Failed email delivery will mark the invite revoked rather than leaving an active unusable token. Active-invite checks ignore accepted and revoked records. Expired records remain subject to the existing pruning path.

## Role Contract

The existing therapist-profile invitation path assigns the canonical application role `bt`. This slice preserves that behavior for therapist directory accounts regardless of professional title. Professional titles such as RBT, BCBA, speech therapist, or occupational therapist remain directory attributes and do not independently grant application authorization.

Changing title-to-role mapping or allowing organization admins to grant elevated `bcba` or `super_admin` roles is outside this slice.

## Security Invariants

- `user_roles` is the authorization source of truth; `profiles.role` is a synchronized mirror.
- Caller organization is resolved from database-backed request context.
- A caller-provided therapist ID is never trusted without service-side organization and email validation.
- `user_therapist_links` is written only when the Auth user profile organization and therapist organization match the invite organization.
- Invite tokens are single-use, expiry checked, revocable, and stored only as SHA-256 hashes.
- The invite creation RPC remains service-role-only.
- No plaintext password is stored or handled by the onboarding administrator.

## Scope

- `src/components/TherapistOnboarding.tsx`
- `src/components/TherapistDetails/ProfileTab.tsx`
- focused component tests
- `supabase/functions/admin-invite/index.ts`
- `supabase/functions/accept-staff-invite/index.ts`
- focused Edge Function tests
- one forward migration for invite target/lifecycle state and the service-role RPC
- generated database types
- WIN-265 tracking and critical-lane handoff artifacts

## Non-goals

- No direct password provisioning.
- No email-only therapist matching.
- No replacement of therapist directory IDs with Auth user IDs.
- No redesign of generic staff invites.
- No public-signup policy change.
- No broad role, RLS, scheduling, or session authorization refactor.
- No production mutation before the branch is reviewed and the required verification is complete.

## Verification

Use test-first coverage for:

- onboarding sends an invite containing the exact therapist ID;
- onboarding distinguishes directory creation from invite delivery failure;
- therapist-profile retry sends the exact therapist ID;
- inviter organization ignores manipulated Auth metadata;
- non-super-admin cross-organization targeting fails closed;
- inactive, deleted, cross-organization, or email-mismatched therapist targets fail closed;
- invite acceptance creates the exact therapist link;
- link or consumption failure deletes the newly created Auth user and leaves the invite retryable;
- accepted and revoked invites cannot be replayed;
- the forward migration keeps the invite RPC service-role-only and removes the hosted `auth.uid()` contradiction.

Then run the critical auth and tenant verification matrix, obtain security/Supabase/code/test reviews, push the branch, and open a human-review PR.
