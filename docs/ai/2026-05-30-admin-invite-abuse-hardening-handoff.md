## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: invite issuance affects admin authorization, privilege escalation, token issuance, and tenant-scoped organization membership
- triggering paths:
  - `supabase/functions/admin-invite/index.ts`
  - `supabase/migrations/20260530140500_atomic_admin_invite_rate_limit.sql`
  - `tests/admins/invite_flow.spec.ts`
  - `tests/admins/invite_rate_limit_migration.spec.ts`

## Scope

- task intent: harden the existing in-repo admin invite creation path against abuse
- Linear issue: `WIN-164`
- files touched:
  - `supabase/functions/admin-invite/index.ts`
  - `supabase/migrations/20260530140500_atomic_admin_invite_rate_limit.sql`
  - `tests/admins/invite_flow.spec.ts`
  - `tests/admins/invite_rate_limit_migration.spec.ts`
  - `docs/ai/2026-05-30-admin-invite-abuse-hardening-handoff.md`
- non-goals:
  - no table schema or RLS policy changes
  - no hosted data backfill
  - no new join-request feature or endpoint
  - no invite redemption implementation because no in-repo accept-invite server path was found

## Abuse Paths Reviewed

- rate limits: per-admin hourly cap is enforced inside `public.create_admin_invite_token_rate_limited`, with the one-hour window and limit defined in the RPC instead of caller-supplied parameters
- concurrent burst protection: RPC takes a per-admin advisory transaction lock before duplicate-active checks, expired pruning, rate-limit count, and insert
- replay protection: active invite conflict handling now runs in the same RPC critical section
- expired token handling: expired invite pruning now runs in the same RPC critical section
- revoked token handling: no revoked-token column or redemption endpoint exists in repo scope
- privilege escalation: standard admins remain blocked from inviting `super_admin` users; focused test added
- join requests: no in-repo join-request endpoint, table, or workflow was found

## Tenant Boundary

- invite creation remains restricted to protected admin route handling
- the atomic RPC independently verifies `auth.uid() = p_created_by`
- standard admins can invite only into their own organization context
- super-admin invite role elevation remains restricted to current super admins
- no cross-tenant read/write broadening was introduced

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - Codex performed routing, implementation, focused testing, and security review directly
- reviewer: completed locally; human review remains required before merge

## Verification Card

- required checks:
  - `npx vitest run tests/admins/invite_flow.spec.ts tests/admins/invite_rate_limit_migration.spec.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npx vitest run tests/admins/invite_flow.spec.ts tests/admins/invite_rate_limit_migration.spec.ts`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - none
- result: pass
- residual risk: invite redemption and revoked-token handling cannot be fully verified because this repo currently contains only invite creation, not an accept-invite server flow

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-164`)
- protected-path drift: expected `supabase/functions/admin-invite/**` and `supabase/migrations/**`
- unrelated changes: none
- generated artifact drift: none
- verification summary: required local checks passed
- pr-ready: yes
- required follow-up:
  - open PR for human review

## Recommended Next Slice

- define whether product needs a user-initiated join-request workflow
- if yes, add an explicit backend endpoint/table with tenant-scoped RLS, rate limits, duplicate request handling, approval authority, audit logging, and denial/revocation semantics
- if invite redemption exists outside this repo, map that system and add token replay, expiry, revocation, and privilege-boundary tests there
