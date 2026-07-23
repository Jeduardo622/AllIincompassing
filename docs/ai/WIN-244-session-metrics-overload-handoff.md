# WIN-244 Session Metrics Overload Handoff

## Routing

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-244
- triggering path: `supabase/migrations/**`
- scope: remove the legacy text overload of `get_session_metrics`, align generated database types, and add a focused migration contract
- non-goals: no RPC body, caller, dashboard fallback, RLS, grant, Edge function, auth, or tenant-boundary changes
- stop condition: any fix requiring a caller contract, function-body, permission, or shared reporting redesign

## Changed Surfaces

- Added a migration that drops only `public.get_session_metrics(text, text, uuid, uuid)`
- Reloaded the PostgREST schema after removing the ambiguous overload
- Collapsed the duplicate generated `get_session_metrics` signature
- Added a focused contract for overload removal, the surviving date-signature grant, and schema reload

## Verification Card

- classification: high-risk human-reviewed
- lane: critical
- change type: database migration, generated type artifact, and integration contract
- required checks:
  - focused Vitest contract
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
  - Supabase preview migration and hosted RPC/ACL proof
- executed checks:
  - focused Vitest contract, 3 tests: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
- blocked checks:
  - `npm run test:ci`: blocked by four unrelated baseline failures, including the existing `supabase.edge` Blob mock failure, stale BT browser-proof contract, and synthetic BCBA provisioning key expectation
  - `npm run verify:local`: reached and failed at the same unrelated `test:ci` baseline failures after policy, lint, and typecheck passed
- pending checks:
  - Supabase preview migration and hosted RPC/ACL proof
- result: pass with blocked local full-suite checks; pending critical-lane hosted verification
- residual risk: static tests cannot prove the effective preview schema or ACL; hosted preview evidence is required before merge

## Review

- specification-engineer: approved the bounded migration/type/test direction
- software-architect: approved after requiring generated-type alignment, contract coverage, and hosted preview proof
- implementation-engineer: completed the bounded three-file implementation
- code-review-engineer: no SQL correctness defect; approval pending handoff and hosted verification
- test-engineer: static contract is appropriate but cannot replace hosted PostgREST proof
- security-engineer: approved; surviving date overload remains tenant-scoped and fail-closed
- supabase-reviewer: migration is sound; approval pending hosted preview proof
- human review: mandatory before merge

## PR Hygiene

- pr-ready: yes, for human review and hosted preview verification
- lane: critical
- branch-ready: yes, `codex/win-244-session-metrics-overload`
- linear-ready: yes, WIN-244
- single-purpose: yes
- unrelated changes: none
- protected-path drift: none beyond the routed migration
- pr handoff: local verification and specialist review documented; hosted preview verification remains mandatory
- required follow-up: push the branch, open a human-reviewed PR, require Supabase preview success, and verify only the date overload remains

The live production dashboard currently reports zero monthly metrics while the Reports route returns non-zero data. Production schema inspection found both date and text overloads with identical argument names; this slice removes only the legacy text overload that makes PostgREST resolution ambiguous.
