# WIN-213 CI Hosted Security Remediation Handoff

## Scope

- chosen task: close hosted session authz drift, fail-closed CI deploy safety, tenant test masking, and production dependency advisories
- issue: `WIN-213`
- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/ci-hosted-security-remediation`
- single-purpose diff: yes
- final review-fix commits: `bf9301e5`, `1f4ebf59`

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
- Final review-fix wave closes the remaining branch review notes:
  - `deploy_session_edge` now requires `policy`, `tenant_safety`, `runtime_migration_parity`, `start_session_runtime_contract`, `lint_typecheck`, `unit_tests`, and `build`.
  - the structural deploy-safety checker and tests now fail if any one of those full-validation prerequisites is removed.
  - the runtime contract checker now strips SQL line/block comments before marker evaluation so comment-only spoof markers cannot satisfy the authz body contract.
  - runtime ACL inspection now uses effective `has_table_privilege(...)` probes for `PUBLIC`, `anon`, `authenticated`, and `service_role`; expected `PUBLIC` privileges on `goal_domains` and `user_therapist_links` remain all false.
  - the runtime contract Postgres pool now keeps TLS certificate verification enabled instead of disabling `rejectUnauthorized`.

## Repository Changes And Evidence

- Task 1 commits `ddb83b8c` and `2bd15e06`: read-only policy job, same-workflow tenant/parity/live-contract guards, one main-push-only deploy job, PR/merge-group read-only behavior, tenant workflow fail-closed tests, structural deploy-safety checker, read-only session runtime contract checker.
- Task 1 focused verification: 27 tests passed; deploy checker passed; `npm run ci:check-focused` passed.
- Direct DB script locally blocked because `SUPABASE_DB_URL` is unset, but the identical contract was proven through Supabase connector SQL.
- Task 1 review: spec PASS, quality APPROVED, no findings.
- Task 2 commit `c1f06713`: `react-router-dom ^6.30.4`, `dompurify ^3.4.11` override, `ws ^8.21.0` override.
- Production audit passes and tree resolves `react-router/react-router-dom 6.30.4`, `dompurify 3.4.11`, `ws 8.21.0`.
- Task 2 verification: policy/lint/typecheck/build/audit pass; focused router/sanitizer-adjacent tests pass.
- `npm run test:ci` and `npm run verify:local` pass when supplied the repository's documented synthetic, non-secret Supabase configuration; the unconfigured baseline fails on missing `VITE_SUPABASE_URL`.
- Task 2 review: spec PASS, quality APPROVED, no blocking findings.
- Baseline `npm test -- --run` before edits had the same 12 missing-`VITE_SUPABASE_URL` failures.
- Fresh integrated evidence:
  - red TDD: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts` -> FAIL before implementation (`4` failing tests: deploy prerequisites, PUBLIC grant drift, and comment-spoof regressions)
  - green targeted: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts` -> PASS (`35` tests)
  - focused follow-up: `npx vitest run tests/runtime-migration-parity.test.ts tests/ci/deploy-session-edge-bundle.test.ts` -> PASS (`10` tests)
  - direct checker: `node scripts/ci/check-session-deploy-safety.mjs` -> PASS
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run test:ci` with synthetic non-secret Supabase configuration -> PASS (`370` files passed, `1` skipped; `2409` tests passed, `1` skipped)
  - `npm run test:routes:tier0` with synthetic non-secret Supabase configuration -> PASS (`220/220` Cypress checks)
  - `npm run verify:local` with synthetic non-secret Supabase configuration -> PASS
  - `npm run validate:tenant` -> PASS
  - `npm run build` -> PASS
  - `npm run ci:playwright` -> BLOCKED at preflight only for missing hosted credentials
  - production audit -> `0`
- Hosted behavior proof remains current.

## Residual Risk

- Human review is required before merge for workflows, CI scripts, and hosted Supabase authorization.
- GitHub-hosted CI must still prove the secret-backed runtime contract job with `SUPABASE_DB_URL` and all required checks.
- `npm run ci:playwright` remains blocked locally until valid hosted credentials are available to this process environment.
- Same-repo PR secret trust for these jobs still depends on protected GitHub environment or repository configuration; this slice documents that blocker but does not resolve it.
- Netlify `merge_group` / `main` commit-target readiness remains a separate deployment-design follow-up and is not fixed here.
- PRs no longer deploy changed edge functions to shared runtime, so a PR whose frontend preview needs new edge behavior may fail closed until isolated Supabase previews exist.
- Existing unrelated security-advisor warnings are not remediated in this slice.
- Final whole-branch code review and Supabase tenant-safety review returned `READY` with no in-scope findings.

## Verification Card

- lane: `critical`
- required checks:
  - `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts`
  - `npx vitest run tests/runtime-migration-parity.test.ts tests/ci/deploy-session-edge-bundle.test.ts`
  - `node scripts/ci/check-session-deploy-safety.mjs`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run verify:local`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run ci:playwright`
- executed checks:
  - `Test-Path 'C:\\Users\\test\\.config\\superpowers\\worktrees\\AllIincompassing\\ci-hosted-security-remediation\\docs\\ai\\WIN-213-ci-hosted-security-remediation-handoff.md'` -> PASS
  - `Test-Path 'C:\\Users\\test\\.config\\superpowers\\worktrees\\AllIincompassing\\ci-hosted-security-remediation\\.superpowers\\sdd\\task-3-report.md'` -> PASS
  - `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts` -> PASS (`35` tests)
  - `npx vitest run tests/runtime-migration-parity.test.ts tests/ci/deploy-session-edge-bundle.test.ts` -> PASS (`10` tests)
  - `node scripts/ci/check-session-deploy-safety.mjs` -> PASS
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run test:ci` with synthetic non-secret Supabase configuration -> PASS (`370` files passed, `1` skipped; `2409` tests passed, `1` skipped)
  - `npm run test:routes:tier0` with synthetic non-secret Supabase configuration -> PASS (`220/220` Cypress checks)
  - `npm run verify:local` with synthetic non-secret Supabase configuration -> PASS
  - `npm run validate:tenant` -> PASS
  - `npm run build` -> PASS
- blocked checks:
  - `npm run ci:playwright` -> BLOCKED at preflight only for missing hosted credentials
- result: pass-with-blocked-checks
- residual risk: secret-backed CI, same-repo secret trust, and Netlify deploy-target design still need external confirmation outside this slice

## PR Hygiene Verdict

- branch-ready: yes, for a human-review PR; not merge-ready without required human review and live CI
- linear-ready: yes, `WIN-213`
- protected-path drift: expected, `.github/workflows/**` and `scripts/ci/**`; hosted replay used the existing checked-in migration without modifying it
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes, for draft human review
- pr handoff: this document
- reviewer: `READY`; no in-scope findings
- Supabase reviewer: `READY`; no tenant-boundary or grant-contract findings
- pr-hygiene: `PR-READY` for draft human review; merge remains blocked on human review and live CI
- required follow-up:
  - push the branch, open the draft PR, and require live CI plus human review before merge
  - keep the unrelated security-advisor warnings out of this slice

## Handoff Summary

WIN-213 now includes the final review-fix wave for the session deploy gate and runtime contract checker: deploy prerequisites are fully enumerated, effective ACL checks fail on any `PUBLIC` grant drift, and comment-only function-body spoofing no longer passes. The hosted replay and contract checks remain the source of truth for the secret-backed path; local `ci:playwright` is still blocked by missing hosted credentials, same-repo PR secret trust still requires protected GitHub configuration, and Netlify commit-target readiness remains a separate design follow-up.
