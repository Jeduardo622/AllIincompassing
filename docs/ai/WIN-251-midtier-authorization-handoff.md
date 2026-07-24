# WIN-251 Mid Tier Authorization RPC Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: production authorization RPC behavior and a Supabase migration are protected.
- triggering paths: `supabase/migrations/**`

## Scope

- task intent: align exact Mid Tier authorization management with the canonical capability helper.
- files touched: one forward migration, one contract test, this handoff.
- single-purpose diff: yes

## Required Agents

- agents used: implementation engineer, code review engineer, security engineer.
- reviewer: completed; approved.

## Verification Card

- required checks: focused contract/grant tests, policy checks, tenant safety, build, CI/browser gates.
- executed checks:
  - targeted authorization parity test: pass
  - `npm run ci:check-focused`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
- blocked checks:
  - DB-backed policy checks: `SUPABASE_DB_URL` is unavailable locally.
  - full `npm run test:ci`: shared suite exceeded the bounded 300-second local window while exercising external-provider paths; targeted tests passed.
- result: pass-with-blocked-checks
- residual risk: live database apply and production UI revalidation remain required after human-reviewed merge.

## PR Hygiene

- branch-ready: yes
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: none beyond the declared migration.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes, human review required before merge.

## Handoff Summary

The forward migration replaces legacy manager-role checks in the authorization RPCs with the canonical organization capability helper while preserving therapist self-only and super-admin boundaries. Static policy, tenant-safety, targeted contract, and production build checks passed; hosted apply and live Mid Tier revalidation remain post-merge requirements.
