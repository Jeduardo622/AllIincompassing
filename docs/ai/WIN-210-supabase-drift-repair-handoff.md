# WIN-210 Supabase Drift Repair Handoff

Date: 2026-07-09

Linear: https://linear.app/winningedgeai/issue/WIN-210/apply-supabase-drift-repair-for-goal-domains-and-session-start-authz

## Scope

Apply and verify the hosted Supabase drift repair for project `wnnjeqheqxxyrgsjmygy`.

Allowed migration payloads:

- `supabase/migrations/20260706143000_goal_domains_and_structured_draft_goals.sql`
- `supabase/migrations/20260707193703_start_session_employee_role_authz.sql`
- `supabase/migrations/20260709162000_harden_goal_domain_and_session_link_authz.sql`

Non-goals:

- Do not harden `admin-users` RPC/function in this slice.
- Do not modify unrelated migrations, app code, CI, secrets, or runtime configuration.
- Do not read `.env*` files.

## Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering paths: `supabase/migrations/**`
- risk rationale: hosted DDL/RLS/grant/RPC changes affect tenant-scoped goal access and session-start authorization.

## Hosted Pre-Apply Evidence

Supabase connector checks against `wnnjeqheqxxyrgsjmygy` showed:

- `public.goal_domains` was absent.
- `public.assessment_draft_goals` and `public.goals` existed.
- `app.current_user_has_exact_role_for_org(uuid, text[])`, `public.user_therapist_links`, `public.record_session_audit(uuid, text, uuid, jsonb)`, and `public.set_updated_at()` existed.
- `public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid)` existed but did not contain `app.current_user_has_exact_role_for_org` or `public.user_therapist_links` checks.
- Hosted migration history contained prerequisite repairs under generated versions:
  - `20260703200149 goal_targets_trial_events`
  - `20260706120432 bcba_exact_capability_matrix`
- Hosted migration history did not contain the target local versions `20260706143000` or `20260707193703`.

## Hosted Apply Result

Applied with the Supabase connector migration tool, using the exact SQL payloads from the two initial local migration files and the follow-up hardening migration added by this branch.

Supabase recorded generated hosted versions:

- `20260709150513 goal_domains_and_structured_draft_goals`
- `20260709150554 start_session_employee_role_authz`
- `20260709151806 harden_goal_domain_and_session_link_authz`
- `20260709153326 harden_goal_domain_service_role_truncate`
- `20260709153416 harden_user_therapist_links_service_role_truncate`
- `20260709153903 normalize_goal_domain_and_link_acls`

The final local migration `20260709162000_harden_goal_domain_and_session_link_authz.sql` includes the review corrections from the later hosted corrective entries above. Fresh environments should use the final local SQL; the hosted project reached the same final state through the original hardening apply plus corrective connector migrations.

## Hosted Post-Apply Evidence

Supabase connector metadata checks showed:

- `public.goal_domains` exists.
- `public.assessment_draft_goals` includes `domain_id`, `clinical_goal_type`, `teaching_strategies`, `operational_definition`, and `baseline`.
- Expected constraints exist:
  - `goal_domains_id_organization_id_key`
  - `goals_domain_id_fkey`
  - `assessment_draft_goals_domain_id_fkey`
  - `assessment_draft_goals_clinical_goal_type_chk`
- RLS is enabled on `public.goal_domains`.
- Expected goal-domain policies exist:
  - `goal_domains_service_role_all`
  - `goal_domains_org_read`
  - `goal_domains_org_insert`
  - `goal_domains_org_update`
- Expected grants are present:
  - `anon` cannot select `public.goal_domains`.
  - `authenticated` can select, insert, and update `public.goal_domains`.
  - `service_role` can delete `public.goal_domains`.
  - `anon` cannot execute `public.start_session_with_goals(...)`.
  - `authenticated` and `service_role` can execute `public.start_session_with_goals(...)`.
- `public.start_session_with_goals(...)` now contains:
  - `app.current_user_has_exact_role_for_org`
  - `public.user_therapist_links`
  - exact start-role array `admin`, `admin_schedule`, `midtier`, `bcba`
  - therapist/BT role array `therapist`, `bt`

## Security Review Follow-Up

The security review found two live hardening gaps after the initial hosted apply:

- `public.goal_domains` still had authenticated `DELETE` and `TRUNCATE` privileges from pre-existing ACL drift.
- `public.user_therapist_links` had broad anon/authenticated table privileges while `start_session_with_goals` used it as a linked-user trust table.

The forward-fix migration `20260709162000_harden_goal_domain_and_session_link_authz.sql` addressed those gaps by:

- revoking all `anon` privileges on `goal_domains` and `user_therapist_links`
- revoking authenticated destructive/write privileges on `user_therapist_links`
- revoking authenticated `DELETE` and `TRUNCATE` on `goal_domains`
- preserving authenticated `SELECT` on `user_therapist_links`
- requiring the linked-user session-start branch to pass active exact `therapist`/`bt` role checks and join the linked therapist row back to the same session organization

Post-hardening Supabase connector checks showed:

- `anon` cannot select `goal_domains` or `user_therapist_links`.
- `authenticated` can select/insert/update `goal_domains`, but cannot delete or truncate it.
- `authenticated` can select `user_therapist_links`, but cannot insert, update, delete, or truncate it.
- `service_role` can delete `goal_domains` and `user_therapist_links`, but cannot truncate either table.
- `start_session_with_goals` contains the `public.therapists` join, same-org check, active role check, and non-deleted therapist check for linked-user authorization.
- goal-domain orphan reference counts are `0` for `goals` and `assessment_draft_goals`.
- duplicate active goal-domain names are `0`.

Residual hosted data hygiene findings:

- `user_therapist_links` still has `1` cross-org or missing-profile link row.
- `user_therapist_links` still has `1` link row whose user lacks an active `therapist`/`bt` role.
- Those anomalous links map to `0` scheduled sessions in the hosted check.
- The hardened RPC no longer authorizes linked starts from link existence alone.

## Verification Plan

Required local checks for this critical database/RLS/RPC slice:

- targeted migration/session tests
- `npm run ci:check-focused`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local` when the local environment can run the route gate

Browser/auth checks are relevant because `start_session_with_goals` affects session lifecycle. Local execution may require seeded browser credentials or protected systems; any unrun browser/auth gate must be called out in the PR and final handoff.

## Verification Card

- lane: `critical`
- required checks:
  - `npm run ci:check-focused`
  - targeted migration/session tests
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright` when hosted browser credentials are available
- executed checks:
  - Supabase connector pre-apply drift/dependency checks
  - Supabase connector migration apply for the three hosted repairs
  - Supabase connector post-apply ACL, RLS, FK, orphan, duplicate, and function-body checks
  - `npx vitest run tests/integration/goal-domains-migration.contract.test.ts tests/employee-role-capability-matrix-migration.test.ts src/server/__tests__/sessionsStartHandler.test.ts --reporter=verbose`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run validate:tenant`
  - `npm run ci:playwright:env-readiness`
  - post-review fix: `npx vitest run tests/integration/goal-domains-migration.contract.test.ts tests/employee-role-capability-matrix-migration.test.ts src/server/__tests__/sessionsStartHandler.test.ts --reporter=verbose`
  - post-review fix: `npm run ci:check-focused`
  - post-review fix: Supabase connector ACL probe for `goal_domains` and `user_therapist_links`
- blocked checks:
  - `npm run ci:playwright` was not run locally because readiness failed with missing browser target, hosted persona credentials, Supabase runtime keys, service-role access, foreign IDs, and assessment-smoke fixture inputs in the process environment.
- result:
  - local policy, lint, typecheck, test, coverage, build, route, and tenant gates passed after one full-suite test retry
  - hosted Supabase object-level repair checks passed
  - hosted final ACL vector:
    - `goal_domains`: `authenticated` has `INSERT`, `SELECT`, `UPDATE`; `service_role` has `DELETE`, `INSERT`, `SELECT`, `UPDATE`; no `anon` grants
    - `user_therapist_links`: `authenticated` has `SELECT`; `service_role` has `DELETE`, `INSERT`, `SELECT`, `UPDATE`; no `anon` grants
- residual risk:
  - local browser/auth Playwright smoke remains CI/secret-backed
  - hosted `user_therapist_links` still has stale data hygiene findings, but the hardened RPC no longer authorizes linked session starts from link existence alone

## Residual Risk

- The hosted migration ledger records Supabase-generated versions rather than the original local migration timestamps. The object-level checks above are the source of truth for applied behavior.
- The previously identified `admin-users` RPC/function exposure remains out of scope and should be handled as the next protected Supabase hardening slice.

## PR Hygiene Verdict

- pr-ready: yes, with `ci:playwright` explicitly deferred to secret-backed CI because local readiness failed
- lane: `critical`
- branch-ready: yes, `codex/apply-supabase-drift-repair`
- linear-ready: yes, `WIN-210`
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: expected, `supabase/migrations/**`
- change summary: present
- verification summary: present
- pr handoff: ready
- reviewer: completed, request-change findings addressed with ACL normalization
- required follow-up:
  - run/confirm `ci:playwright` in CI or an environment with hosted browser credentials
  - clean stale `user_therapist_links` data rows in a separate protected slice
  - address the previously identified `admin-users` RPC/function exposure in a separate protected slice
- handoff summary: WIN-210 reconciles hosted Supabase goal-domain/session-start drift, then hardens trust-table ACLs and linked session-start authorization after reviewer findings. Hosted Supabase object and ACL probes show the expected final state; local policy, targeted tests, full Vitest, coverage, build, route tier-0, and tenant checks passed. Local browser/auth Playwright smoke is blocked by missing hosted credentials in this process environment and should be confirmed in CI.
