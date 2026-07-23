# WIN-247 BCBA Route Hardening Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the slice changes protected auth/routing behavior in `src/App.tsx` and a privileged edge function in `supabase/functions/admin-invite/index.ts`
- triggering paths:
  - `src/App.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/TherapistDetails/ProfileTab.tsx`
  - `src/lib/roles.ts`
  - `src/server/routes/guards.ts`
  - `src/pages/MonitoringDashboard.tsx`
  - `supabase/functions/admin-invite/index.ts`

## Scope

- task intent: deny BCBA access to Monitoring and Settings across routes, nav, capability checks, and admin invite side effects while preserving admin and `super_admin` behavior; tighten client search normalization and local tab/input responsiveness in the owned files only
- files touched:
  - `src/App.tsx`
  - `src/components/Sidebar.tsx`
  - `src/lib/roles.ts`
  - `src/pages/MonitoringDashboard.tsx`
  - `src/pages/Settings.tsx`
  - `src/pages/Clients.tsx`
  - `src/components/settings/OrganizationSettings.tsx`
  - `cypress/support/routeScenarios.ts`
  - `scripts/route-audit.ts`
  - `scripts/route-audit.cjs`
  - `supabase/functions/admin-invite/index.ts`
  - `supabase/functions/_shared/auth.ts`
  - targeted tests under `src/**/__tests__`, `tests/admins/invite_flow.spec.ts`, and `tests/edge/route-guards-parity.test.ts`
- single-purpose diff: yes
- Linear: [WIN-247](https://linear.app/winningedgeai/issue/WIN-247/restrict-bcba-admin-settings-access-and-harden-audited-routes)

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `supabase-reviewer`
- reviewer: approved after the Supabase role-set and invite-visibility findings were fixed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - targeted Vitest across roles, navigation, sidebar, Clients, Monitoring, Organizations, therapist-profile invite, and admin-invite: pass, 8 files / 81 tests
  - route-guard parity, server guard matrix, and admin-invite regression rerun after CI feedback: pass, 3 files / 30 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build` with the repository CI runtime, Node 20.17.0: pass
  - `npm run test:routes:tier0` with Node 20.17.0: pass, 7 specs / 220 tests
- blocked checks:
  - `npm run test:ci`: fail outside WIN-247 scope in stale CI/workflow contract assertions, including `tests/workflows/bt-aba-disposable-browser-proof.test.ts` and `tests/ci/check-e2e-reliability-gates.test.ts`
  - `npm run ci:playwright`: blocked at preflight because neither `PW_SUPERADMIN_EMAIL` + `PW_SUPERADMIN_PASSWORD` nor `PW_ADMIN_EMAIL` + `PW_ADMIN_PASSWORD` is available locally; secret-backed CI remains authoritative
  - `npm run verify:local`: executed and stopped at the same unrelated `test:ci` failures before downstream checks
- result: pass-with-blocked-checks
- residual risk: secret-backed browser coverage and the repository-wide test baseline still require CI/human review; focused behavior, policy, tenant, build, and the complete route matrix pass

## PR Hygiene

- branch-ready: yes
- linear-ready: yes, linked to WIN-247
- protected-path drift: expected and routed as critical in `supabase/functions/admin-invite/index.ts`, `supabase/functions/_shared/auth.ts`, `src/server/routes/guards.ts`, and `src/App.tsx`
- unrelated changes: none in this checkout
- generated artifact drift: `dist/**` regenerated locally during build verification but not staged for handoff
- verification summary: present
- pr-ready: yes for human review; merge remains gated on required CI and protected-path review
- required follow-up:
  - run and triage required CI, including the repository-wide test baseline
  - run `npm run ci:playwright` in the secret-backed CI environment
  - complete required human review before merge

## Handoff Summary

BCBA can no longer reach Monitoring or Settings through direct routes, legacy aliases, sidebar links, or role capabilities, while admin and `super_admin` retain access. The monitoring page now checks `hasCapability('viewMonitoring')`, both Monitoring and Settings tab strips scroll horizontally without forcing page overflow, client search matches apostrophe/diacritic variants while preserving email/client-ID lookup, and the admin invite function now requires exact admin or `super_admin` membership from the authoritative full role set before side effects. Targeted tests, policy checks, lint, typecheck, tenant validation, the exact Node 20 build, and all 220 tier-0 route tests pass; the repository-wide test baseline has unrelated workflow-contract failures and secret-backed `ci:playwright` remains for CI.
