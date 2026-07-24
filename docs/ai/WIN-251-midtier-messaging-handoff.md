# WIN-251 Mid Tier Messaging RPC Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: messaging membership functions and a Supabase migration are tenant-sensitive.
- triggering paths: `supabase/migrations/**`

## Scope

- task intent: align direct staff messaging membership and recipient listing with canonical and legacy staff roles.
- files touched: one forward migration, one contract test, this handoff.
- single-purpose diff: yes

## Required Agents

- agents used: implementation engineer, code review engineer, security engineer.
- reviewer: completed; code and security re-reviews approved after removing the ambiguous `org_member` alias.

## Verification Card

- executed checks:
  - focused messaging parity and grant tests: pass, 10 tests.
  - `npm run ci:check-focused`: pass.
  - `npm run validate:tenant`: pass.
  - `npm run build`: pass.
- blocked checks:
  - full `npm run test:ci`: shared suite exceeded the bounded local window.
  - DB-backed policy checks: `SUPABASE_DB_URL` is unavailable locally.
- result: pass-with-blocked-checks
- residual risk: hosted migration apply and direct-thread UI proof are still required.

## PR Hygiene

- branch-ready: yes
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: none beyond the declared migration.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes, human review required.

## Handoff Summary

The migration updates only the direct-member helper and eligible-recipient RPC, including canonical roles and the safe `org_admin`/`org_super_admin` aliases. Ambiguous `org_member` and `client` roles are explicitly excluded; the change does not widen RLS, table access, group messaging, or RPC grants.
