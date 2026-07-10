# CI And Hosted Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsafe shared Supabase deployments, make tenant CI fail closed, keep critical hosted authorization migrations continuously verified, and clear the identified production dependency advisories.

**Architecture:** The existing `policy` job becomes read-only. A dedicated shared Supabase edge deployment job is restricted to pushes on `main` and depends on same-workflow tenant safety, merge-range migration parity, and a read-only live session-RPC contract check; PR and merge-group paths never mutate hosted runtime. Package overrides resolve vulnerable transitive sanitizer and WebSocket versions without broad application refactors.

**Tech Stack:** GitHub Actions, Node.js 20, Vitest, Supabase Postgres, npm lockfiles.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical`.
- Shared Supabase edge functions may deploy only on a push to `refs/heads/main`.
- The deployment job must depend on successful policy, tenant-safety, runtime-migration-parity, and session-runtime-contract jobs in the same workflow DAG.
- Keep duplicate migration-name rejection intact; hosted behavior parity is proven from the live function definition and ACLs, not ambiguous generated ledger versions.
- Hosted changes must replay only checked-in migration SQL against project `wnnjeqheqxxyrgsjmygy`; no invented SQL or migration names.
- Do not edit application code, Netlify routing, secrets, branch protection, or unrelated dependencies.
- Human review and Linear issue `WIN-213` are required before merge.

---

### Task 1: Fail-Closed Session Deploy Contract

**Files:**
- Create: `scripts/ci/check-session-deploy-safety.mjs`
- Create: `tests/ci/check-session-deploy-safety.test.ts`
- Create: `scripts/ci/check-session-runtime-contract.mjs`
- Create: `tests/ci/check-session-runtime-contract.test.ts`
- Modify: `scripts/ci/run-policy-checks.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/tenant-safety.yml`

**Interfaces:**
- Consumes: `MIGRATION_PARITY_BASE_SHA`, `MIGRATION_PARITY_HEAD_SHA`, and `SUPABASE_DB_URL`.
- Produces: a policy checker that exits nonzero unless one main-push-only deploy job depends on policy, tenant, migration parity, and live session-RPC contract jobs; a read-only database contract checker for the hosted session authorization surface.

- [ ] **Step 1: Write failing deploy-safety and migration-baseline tests**

Add tests that reject PR-capable deploy conditions, duplicate deploy commands, missing deploy-job prerequisites, and masked tenant tests. Add database contract tests for expected function-body markers and ACL/grant mismatches.

- [ ] **Step 2: Run tests to verify red state**

Run: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts`

Expected: FAIL because the deploy-safety and runtime-contract checkers do not exist and current workflows violate the contract.

- [ ] **Step 3: Implement deploy-safety and runtime-contract policies**

Validate the checked-in workflow with deterministic checks consistent with existing `scripts/ci` policy checkers. Add a read-only Postgres checker that fails unless the live function definition contains exact employee-role, linked therapist/BT, same-org, and active-therapist guards and the function/table ACL matrix matches the checked-in hardening migration.

- [ ] **Step 4: Reorder and restrict workflow deployment**

Keep `policy` read-only. Add same-workflow tenant-safety, merge-range runtime-migration-parity, and session-runtime-contract jobs, then one `deploy_session_edge` job restricted to `push` on `refs/heads/main` and dependent on all guards. Preserve PR and merge-group browser execution when deploy is skipped, but require successful deploy before the main-push auth browser smoke.

Remove the duplicate deploy from `auth_browser_smoke`, include the new guard/deploy results in `ci-gate` semantics, and replace the standalone tenant workflow's masked shell pipeline with `run: npm test`.

- [ ] **Step 5: Run focused green tests and policy checker**

Run: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`

Run: `node scripts/ci/check-session-deploy-safety.mjs`

Expected: both commands PASS.

### Task 2: Production Dependency Remediation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing application APIs from `react-router-dom` 6.x and `isomorphic-dompurify`.
- Produces: `react-router-dom@6.30.4`, `dompurify>=3.4.11`, and `ws>=8.21.0` in the production dependency tree.

- [ ] **Step 1: Record the failing production audit**

Run: `npm audit --omit=dev --audit-level=high`

Expected: FAIL with high `ws` and moderate `dompurify` / `react-router` advisories.

- [ ] **Step 2: Apply the minimal dependency resolution**

Update `react-router-dom` to `^6.30.4`. Add root npm overrides for `dompurify` at `^3.4.11` and `ws` at `^8.21.0`, then regenerate `package-lock.json` with npm.

- [ ] **Step 3: Verify the production tree**

Run: `npm audit --omit=dev --audit-level=high`

Run: `npm ls ws dompurify react-router react-router-dom --omit=dev`

Expected: audit exits zero and the resolved versions meet the floors above.

### Task 3: Hosted Supabase Reconciliation And Proof

**Files:**
- Hosted apply source: `supabase/migrations/20260709162000_harden_goal_domain_and_session_link_authz.sql`
- Modify: `docs/ai/WIN-213-ci-hosted-security-remediation-handoff.md`

**Interfaces:**
- Consumes: Supabase project `wnnjeqheqxxyrgsjmygy` and the exact checked-in migration SQL.
- Produces: a current hosted replay ledger entry plus decisive evidence for function body, ACL, and tenant-table grants; duplicate generated ledger names remain intentionally insufficient for behavioral proof.

- [ ] **Step 1: Reconfirm hosted object state and ledger mismatch**

Use read-only Supabase queries to prove the live function includes exact-role, linked therapist/BT, same-org, and active-therapist checks; prove `anon` lacks execute; and prove the same-name hardening ledger row is older than local `20260709162000`.

- [ ] **Step 2: Replay the exact checked-in hardening migration**

Apply `20260709162000_harden_goal_domain_and_session_link_authz.sql` through the Supabase migration tool using migration name `harden_goal_domain_and_session_link_authz`.

- [ ] **Step 3: Requery hosted proof**

Verify the new ledger row satisfies name-and-newer-version parity, the function body contract remains true, function execute grants remain `anon=false`, `authenticated=true`, `service_role=true`, and authenticated table grants remain limited as designed.

- [ ] **Step 4: Record the handoff**

Write the lane, tenant boundary, hosted evidence, changed files, executed checks, blocked secret-backed checks, reviewer status, and residual risk to the WIN-213 handoff.

### Task 4: Critical-Lane Verification And PR Handoff

**Files:**
- Modify: `docs/ai/WIN-213-ci-hosted-security-remediation-handoff.md`

**Interfaces:**
- Consumes: Tasks 1-3 and repo verification skills.
- Produces: verification card, PR-hygiene verdict, review-ready branch, and draft PR linked to `WIN-213`.

- [ ] **Step 1: Run required local verification**

Run the focused tests, workflow validation, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run build`, and `npm run verify:local` where locally meaningful. Record secret/environment blockers exactly.

- [ ] **Step 2: Complete specialist and whole-branch review**

Require `code-review-engineer`, `test-engineer`, `security-engineer`, `supabase-reviewer`, and `netlify-deploy-reviewer` evidence with no open Critical or Important findings.

- [ ] **Step 3: Run repo closing gates**

Use `.agents/skills/verify-change` and `.agents/skills/pr-hygiene`; update the handoff with their exact verdicts.

- [ ] **Step 4: Push and open the human-review PR**

Push `codex/ci-hosted-security-remediation`, open a draft PR linked to `WIN-213`, move the issue to `In Review`, and report live required checks and the human-review merge blocker.
