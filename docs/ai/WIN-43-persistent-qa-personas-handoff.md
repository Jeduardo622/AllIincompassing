# WIN-43 Persistent QA Personas

## Classification

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: `WIN-43`
- target organization: `5238e88b-6198-4862-80a2-dbe15bbeabdd`

The provisioning path changes persistent authentication identities and tenant-scoped test data. It must be reviewed and merged before the repository owner performs the separate protected dispatch. Codex must not merge or dispatch this critical slice through the solo-maintainer exception.

## Persona Contract

| Persona | Stable email | Exact active role | Active credential secrets |
| --- | --- | --- | --- |
| BT | `playwright.qa.bt@example.com` | `bt` | `PW_BT_EMAIL`, `PW_BT_PASSWORD` |
| Therapist | `playwright.qa.therapist@example.com` | `therapist` | `PW_THERAPIST_EMAIL`, `PW_THERAPIST_PASSWORD` |
| BCBA | `playwright.qa.bcba@example.com` | `bcba` | `PW_BCBA_EMAIL`, `PW_BCBA_PASSWORD` |
| Midtier | `playwright.qa.midtier@example.com` | `midtier` | `PW_MIDTIER_EMAIL`, `PW_MIDTIER_PASSWORD` |
| Schedule admin | `playwright.qa.admin_schedule@example.com` | `admin_schedule` | `PW_ADMIN_SCHEDULE_EMAIL`, `PW_ADMIN_SCHEDULE_PASSWORD`; compatibility alias `PW_SCHEDULE_EMAIL`, `PW_SCHEDULE_PASSWORD` |
| Client | `playwright.qa.client@example.com` | `client` | `PW_CLIENT_EMAIL`, `PW_CLIENT_PASSWORD` |
| Admin | `playwright.qa.admin@example.com` | `admin` | `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` |
| Super admin | `playwright.qa.super_admin@example.com` | `super_admin` | `PW_SUPERADMIN_EMAIL`, `PW_SUPERADMIN_PASSWORD` |

Steve Job, MJ Menjivar, and every account outside this namespace are reserved and must not be modified. Passwords must remain in GitHub Secrets and Supabase Auth only.

## Post-Merge Activation

1. The repository owner generates eight strong passwords without printing them and sets the sixteen `QA_BOOTSTRAP_*_EMAIL` and `QA_BOOTSTRAP_*_PASSWORD` repository secrets. Email secret values must exactly match the table above.
2. The owner dispatches `Provision Persistent QA Personas` from current `main` with the merged WIN-43 PR number, exact current main SHA, and acknowledgement `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`.
3. The owner verifies the run and downloads `win-43-qa-persona-manifest`. The artifact may contain only role, synthetic email, user id, organization id, and status.
4. Only after that run succeeds, the owner copies the same bootstrap values into the active `PW_*` secrets. `admin_schedule` is also copied to the legacy `PW_SCHEDULE_*` aliases.
5. The owner deletes all `QA_BOOTSTRAP_*` secrets and dispatches the credentialed route audit separately.

This is a one-time bootstrap against an empty reserved namespace. The provisioner refuses to repair or rotate any existing identity; subsequent checks use read-only `--verify`. A future password rotation requires a separately reviewed critical-lane flow. This order leaves existing `PW_*` credentials active until all new identities authenticate and pass exact-role and same-organization checks. GitHub Secrets cannot be read back, so password generation and both secret writes must occur in the same owner-controlled session or approved password manager workflow.

## Scope And Stop Conditions

Allowed: the dedicated Auth users, their `profiles` and exact `user_roles`, synthetic therapist rows/self-links, one synthetic client row, and same-org client-therapist links.

Stop before mutation if any stable email already exists in Auth, profiles, therapists, or clients. During verification, stop if any identity resolves to multiple active roles or any row has a different organization. Also stop if current `main` moves after approval, the merged PR does not reference WIN-43, or a required secret is absent. No migration, RLS, grant, RPC, Edge Function, `.env`, PHI, or direct `auth.users` SQL is allowed.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `CI/workflow/policy`, `persistent Auth provisioning`, and `tenant-scoped synthetic data writes`
- files touched: `.github/workflows/provision-qa-personas.yml`, `scripts/provision-persistent-qa-personas.ts`, `tests/scripts/provision-persistent-qa-personas.test.ts`, `tests/workflows/provision-qa-personas.test.ts`, `tests/workflows/github-actions-node24-runtime.test.ts`, and this handoff
- required agents: specification, architecture, implementation, code review, test, security, Supabase, and DevOps
- required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, focused provisioner/workflow tests, workflow YAML parse, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, and `npm run verify:local`
- executed checks: focused provisioner/workflow/runtime-pin tests passed `14/14`; `npm run ci:check-focused` passed; `npm run lint` passed; `npm run typecheck` passed; workflow YAML parse passed; `npm run ci:verify-coverage` passed at `92.96%`; `npm run validate:tenant` passed; `npm run test:routes:tier0` passed `250/250`; `npm run build` passed; hosted read-only namespace preflight found zero collisions across Auth, profiles, therapists, and clients
- executed aggregate check: `npm run test:ci` did not pass locally. The 4 GB run exhausted heap. The 8 GB run completed `5,079 passed`, `101 skipped`, and `5 failed`; its branch-caused workflow allowlist failure was corrected and now passes narrowly. The untouched BCBA smoke test remains LF-sensitive and fails on the Windows CRLF checkout; the order-sensitive `ProgramsGoalsTab` file passes `120/120` in isolation and the timed-out `SessionModal` case passes narrowly.
- blocked checks: `npm run verify:local` is blocked by its locally non-green `test:ci` constituent; `npm run ci:playwright` is blocked until the owner merges, dispatches the protected bootstrap, activates the new `PW_*` secrets, and initiates the separate credentialed route audit
- reviewer: independent code and security reviews approved; architecture, test, Supabase, and DevOps reviews completed
- result: `pass-with-blocked-checks`; no hosted mutation has occurred
- residual risk: Linux exact-head CI must resolve the Windows-only aggregate ambiguity, and account creation, authentication, exact-role readback, and credentialed route behavior remain unproven until owner-controlled post-merge activation
- PR handoff: ready for human review; owner merge and protected dispatch remain mandatory

## PR Hygiene

The diff is limited to the one-time provisioner, its owner-gated workflow, contract tests, and this handoff. It does not change migrations, RLS, grants, RPCs, application routes, runtime auth logic, active credentials, or customer data. Human review and owner merge are mandatory; Codex must not merge or dispatch this critical change.
