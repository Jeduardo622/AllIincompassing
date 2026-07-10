# CI And Hosted Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsafe shared Supabase deployments, make tenant CI fail closed, keep critical hosted authorization migrations continuously verified, and clear the identified production dependency advisories.

**Architecture:** The existing `policy` job remains the single owner of shared Supabase edge deployment, but deployment is restricted to pushes on `main` and ordered after policy, tenant, and database migration parity checks. Runtime parity is extended with an explicit baseline list so critical historical authz migrations are checked on every deploy, while package overrides resolve vulnerable transitive sanitizer and WebSocket versions without broad application refactors.

**Tech Stack:** GitHub Actions, Node.js 20, Vitest, Supabase Postgres, npm lockfiles.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical`.
- Shared Supabase edge functions may deploy only on a push to `refs/heads/main`.
- No edge deployment may occur before policy checks, `npm run validate:tenant`, and runtime migration parity pass.
- Runtime parity must always require the four session authz baseline migrations named in Task 1.
- Hosted changes must replay only checked-in migration SQL against project `wnnjeqheqxxyrgsjmygy`; no invented SQL or migration names.
- Do not edit application code, Netlify routing, secrets, branch protection, or unrelated dependencies.
- Human review and Linear issue `WIN-213` are required before merge.

---

### Task 1: Fail-Closed Session Deploy Contract

**Files:**
- Create: `scripts/ci/check-session-deploy-safety.mjs`
- Create: `tests/ci/check-session-deploy-safety.test.ts`
- Modify: `scripts/ci/runtime-migration-parity.mjs`
- Modify: `scripts/ci/check-runtime-migration-parity.mjs`
- Modify: `tests/runtime-migration-parity.test.ts`
- Modify: `scripts/ci/run-policy-checks.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/tenant-safety.yml`

**Interfaces:**
- Consumes: `MIGRATION_PARITY_BASE_SHA`, `MIGRATION_PARITY_HEAD_SHA`, `SUPABASE_DB_URL`, and comma-separated `MIGRATION_PARITY_REQUIRED_FILES`.
- Produces: a policy checker that exits nonzero unless one main-push-only deploy follows policy, tenant, and parity checks; a parity requirement list containing migration `{ version, name }` entries.

- [ ] **Step 1: Write failing deploy-safety and migration-baseline tests**

Add tests that reject PR-capable deploy conditions, duplicate deploy commands, deploy-before-parity ordering, masked tenant tests, missing baseline files, and older same-name hosted rows.

- [ ] **Step 2: Run tests to verify red state**

Run: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/runtime-migration-parity.test.ts`

Expected: FAIL because the deploy-safety checker and baseline parser do not exist and current workflows violate the contract.

- [ ] **Step 3: Implement baseline parsing and deploy-safety policy**

Parse each required migration path using the existing `TIMESTAMP_name.sql` contract, merge and deduplicate baseline entries with merge-range additions, and fail if a configured path is invalid or absent. Validate the checked-in workflow with deterministic string/step-order checks consistent with existing `scripts/ci` policy checkers.

- [ ] **Step 4: Reorder and restrict workflow deployment**

In `policy`, run secrets policy and focused policy checks first; on `push` to `refs/heads/main`, run tenant validation, runtime migration parity with the four files below, deploy prerequisite validation, then exactly one session edge deployment:

```text
supabase/migrations/20260706023600_bcba_exact_capability_matrix.sql
supabase/migrations/20260706143000_goal_domains_and_structured_draft_goals.sql
supabase/migrations/20260707193703_start_session_employee_role_authz.sql
supabase/migrations/20260709162000_harden_goal_domain_and_session_link_authz.sql
```

Remove the duplicate deploy from `auth_browser_smoke`. Replace the tenant workflow's masked shell pipeline with `run: npm test`.

- [ ] **Step 5: Run focused green tests and policy checker**

Run: `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/runtime-migration-parity.test.ts`

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
- Produces: a hosted migration ledger entry whose name/version satisfies runtime parity and evidence for function body, ACL, and tenant-table grants.

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
