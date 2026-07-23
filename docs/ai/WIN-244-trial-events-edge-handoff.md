# WIN-244 Trial Events Edge Handoff

## Routing

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-244
- scope: add `GET view=prompt_outcomes` parity to the existing Trial Events Edge Function and route Session Trends through it
- non-goals: no migration, RLS, grant, RPC, Netlify, CI, or existing Trial Events write-contract changes
- stop condition: any need to widen beyond the existing server-handler contract or modify tenant policy

## Changed Surfaces

- Session Trends now calls the authenticated `trial-events` Edge Function
- Edge Function mirrors the existing server prompt-outcome validation, capability, tenant scope, filters, row cap, DTO, and upstream-status behavior
- Edge contracts cover validation, authz failure, tenant scope, status preservation, row cap, legacy GET anchors, and legacy POST

## Verification Card

- classification: high-risk human-reviewed
- lane: critical
- change type: server/API/edge integration and tenant-sensitive Supabase read path
- required checks:
  - focused Edge, server, and component tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
- executed checks:
  - focused Edge, server, and component Vitest, 3 files and 66 tests: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail on five unrelated repo-wide workflow, Blob-environment, and Schedule readiness failures
- blocked checks:
  - `npm run test:routes:tier0`: deferred to fresh PR CI because the full suite is already red outside this diff
  - `npm run ci:playwright`: requires the hosted auth/browser environment
  - hosted positive and negative Edge reads: require a reviewed development/preview deployment
- result: pass-with-blocked-checks
- residual risk: hosted Edge behavior is not proven until a preview deployment exercises in-scope and forbidden actors

## Review

- code-review-engineer: approve after status parity and legacy regression coverage
- security-engineer: approve; capability gate precedes privileged existence checks and final read remains request-scoped
- supabase-reviewer: approve; no migration, RLS, grant, or tenant-boundary regression
- human review: mandatory before merge because `supabase/functions/**` is protected

## PR Hygiene

- pr-ready: yes for critical-lane human review
- lane: critical
- branch-ready: yes, `codex/win-244-trial-events-route`
- linear-ready: yes, WIN-244
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: intentional Edge Function change, correctly routed critical
- change summary: present
- verification summary: present with explicit blocked gates
- pr handoff: ready
- reviewer: completed
- required follow-up: fresh CI, hosted preview proof, and required human approval

This branch replaces the broken SPA fallback request with the existing authenticated Edge boundary and adds the missing prompt-outcomes contract without widening tenant access.
