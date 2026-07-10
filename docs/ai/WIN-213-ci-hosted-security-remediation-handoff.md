# WIN-213 CI Hosted Security Remediation Handoff

## Scope

- chosen task: close hosted session authz drift, fail-closed CI deploy safety, tenant test masking, and production dependency advisories
- issue: `WIN-213`
- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/ci-hosted-security-remediation`
- single-purpose diff: yes
- final review-fix commit: `86c7805f`

## Route Task

- why: this slice documents hosted security remediation for CI and Supabase authorization state, which is high-risk and human-reviewed in this repo.
- triggering paths:
  - `docs/ai/WIN-213-ci-hosted-security-remediation-handoff.md`
  - `docs/ai/WIN-210-supabase-drift-repair-handoff.md`
  - `docs/ai/WIN-211-user-therapist-links-cleanup-handoff.md`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: yes
- verify-change required: yes
- linear required: yes

## Tenant Boundary

Only same-org authorized `super-admin`, `admin`, `admin_schedule`, `midtier`, `bcba`, direct `therapist`/`bt`, or active same-org linked `therapist`/`bt` may start a session. Cross-org access remains denied, and inactive or deleted therapist linkage remains denied.

## Hosted Evidence

Supabase project: `wnnjeqheqxxyrgsjmygy`

- Before replay, the live function already contained the intended current authz body, but migration ledger parity for local `20260709162000_harden_goal_domain_and_session_link_authz.sql` was missing because hosted had older generated version `20260709151806`.
- The exact checked-in SQL from `supabase/migrations/20260709162000_harden_goal_domain_and_session_link_authz.sql` was applied through the Supabase migration API with name `harden_goal_domain_and_session_link_authz`; tool returned `success: true`.
- New hosted ledger row: version `20260710023059`, name `harden_goal_domain_and_session_link_authz`.
- Older same-name row remains; duplicate logical names are intentionally not accepted as decisive behavior proof by the strict merge-range parity helper.
- Duplicate same-name ledger rows are intentionally fail-closed for name-based parity.
- Post-replay function contract query returned all true:
  - `has_exact_role_helper`
  - `uses_link_table`
  - `joins_therapists`
  - `enforces_same_org_link`
  - `requires_active_therapist`
  - `exact_start_roles`
  - `therapist_bt_roles`
- Function ACL: `anon EXECUTE=false`, `authenticated EXECUTE=true`, `service_role EXECUTE=true`.
- `goal_domains`: `anon SELECT false`; `authenticated SELECT/INSERT/UPDATE true`; `DELETE/TRUNCATE false`.
- `user_therapist_links`: `anon SELECT false`; `authenticated SELECT true`; `INSERT/UPDATE/DELETE/TRUNCATE false`; `service_role TRUNCATE false`.
- Security advisors were queried after inspection. Existing project-wide SECURITY DEFINER warnings remain outside WIN-213 scope; link the Supabase remediation guide: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Production audit count: `0`.
- The whole-branch review blockers were fixed: `always()` skip semantics, actor/session link predicates, `SECURITY DEFINER`/`search_path`/superadmin/direct therapist markers, and direct deploy-helper detection.

## Repository Changes And Evidence

- Task 1 commits `ddb83b8c` and `2bd15e06`: read-only policy job, same-workflow tenant/parity/live-contract guards, one main-push-only deploy job, PR/merge-group read-only behavior, tenant workflow fail-closed tests, structural deploy-safety checker, read-only session runtime contract checker.
- Task 1 focused verification: 27 tests passed; deploy checker passed; `npm run ci:check-focused` passed.
- Direct DB script locally blocked because `SUPABASE_DB_URL` is unset, but the identical contract was proven through Supabase connector SQL.
- Task 1 review: spec PASS, quality APPROVED, no findings.
- Task 2 commit `c1f06713`: `react-router-dom ^6.30.4`, `dompurify ^3.4.11` override, `ws ^8.21.0` override.
- Production audit passes and tree resolves `react-router/react-router-dom 6.30.4`, `dompurify 3.4.11`, `ws 8.21.0`.
- Task 2 verification: policy/lint/typecheck/build/audit pass; focused router/sanitizer-adjacent tests pass.
- `npm run test:ci` and `npm run verify:local` fail only on pre-existing missing `VITE_SUPABASE_URL` in `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts`.
- Task 2 review: spec PASS, quality APPROVED, no blocking findings.
- Baseline `npm test -- --run` before edits had the same 12 missing-`VITE_SUPABASE_URL` failures.
- Fresh integrated evidence:
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run test:ci` -> PASS with synthetic non-secret Supabase config: `370` files passed, `1` skipped; `2409` tests passed, `1` skipped
  - `npm run validate:tenant` -> PASS
  - `npm run build` -> PASS
  - `npm run test:routes:tier0` -> PASS `220/220`
  - `npm run verify:local` -> PASS with synthetic config
  - `npm run ci:playwright` -> BLOCKED at preflight only for missing hosted credentials
  - production audit -> `0`
- Fresh red/green notes:
  - red: runtime checker `6` failed / `4` passed; deploy safety `4` failed / `12` passed
  - green focused: `4` files, `36` tests passed; deploy checker, `ci:check-focused`, `lint`, `typecheck` PASS
- Hosted behavior proof remains current.

## Residual Risk

- Human review is required before merge for workflows, CI scripts, and hosted Supabase authorization.
- GitHub-hosted CI must prove the secret-backed runtime contract job with `SUPABASE_DB_URL` and all required checks.
- PRs no longer deploy changed edge functions to shared runtime, so a PR whose frontend preview needs new edge behavior may fail closed until isolated Supabase previews exist.
- Existing unrelated security-advisor warnings are not remediated in this slice.
- Final reviewer / pr-hygiene / PR readiness remain pending until those gates run.

## Verification Card

- lane: `critical`
- required checks:
  - `npm run ci:check-focused`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
- executed checks:
  - `Test-Path 'C:\\Users\\test\\.config\\superpowers\\worktrees\\AllIincompassing\\ci-hosted-security-remediation\\docs\\ai\\WIN-213-ci-hosted-security-remediation-handoff.md'` -> PASS
  - `Test-Path 'C:\\Users\\test\\.config\\superpowers\\worktrees\\AllIincompassing\\ci-hosted-security-remediation\\.superpowers\\sdd\\task-3-report.md'` -> PASS
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run test:ci` -> PASS with synthetic non-secret Supabase config: `370` files passed, `1` skipped; `2409` tests passed, `1` skipped
  - `npm run validate:tenant` -> PASS
  - `npm run build` -> PASS
  - `npm run test:routes:tier0` -> PASS `220/220`
  - `npm run verify:local` -> PASS with synthetic config
- blocked checks:
  - `npm run ci:playwright` -> BLOCKED at preflight only for missing hosted credentials
- result: pass-with-blocked-checks
- residual risk: secret-backed CI still needs to confirm the full runtime contract path

## PR Hygiene Verdict

- branch-ready: pending final reviewer/pr-hygiene/PR readiness gates
- linear-ready: pending
- protected-path drift: expected, `supabase/migrations/**` in the underlying remediation slice
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: not ready until final reviewer/pr-hygiene/PR readiness gates run
- pr handoff: pending
- reviewer: pending
- pr-hygiene: pending
- required follow-up:
  - complete final whole-branch review, verify-change, pr-hygiene, push, and CI before marking ready
  - keep the unrelated security-advisor warnings out of this slice

## Handoff Summary

WIN-213 records the hosted Supabase and CI security remediation state for the branch and preserves the exact boundary conditions for session-start authorization. The hosted replay and contract checks confirm the intended authz predicates, ACLs, and ledger state; local `ci:playwright` remains blocked only by missing hosted credentials. Remaining risk is limited to human review and CI confirmation of the secret-dependent runtime path.
