# WIN-43 Persistent QA Personas

## Classification

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: `WIN-43`
- target organization: `5238e88b-6198-4862-80a2-dbe15bbeabdd`

The provisioning path changes persistent authentication identities and tenant-scoped test data. It must be reviewed and merged before any separate protected dispatch. Codex must not merge this critical slice. After the owner personally inspects and merges the policy PR, the owner may explicitly authorize Codex in the current task to perform exactly one dispatch submission through either an owner-authenticated GitHub UI controlled through Browser or Computer Use, including a GitHub Actions page opened from GitHub Desktop, or a purpose-built GitHub connector workflow-dispatch action when that exact capability is available and preserves the owner actor.

Delegated owner-session dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].

The QA authorization must bind `.github/workflows/provision-qa-personas.yaml`, `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`, the merged WIN-43 PR number, the exact current-main commit SHA, and the workflow-specific immutable inputs, including the visible bounded `operation` input. Allowed operations are `verify-readiness` and `provision-empty-namespace`; readiness is the default and provisioning must be selected explicitly. Immediately before dispatch submission, Codex must recheck current main, the merged PR, required CI, owner identity, sole-maintainer topology, the hash-bound specialist manifest, and the visible exact inputs. A connector is unavailable unless it exposes the exact submitted inputs, requires no credential or secret disclosure, and preserves the owner actor for workflow-side validation. Authorization is one-time, consumed on dispatch submission, and revoked by drift, missing evidence, session/tool ambiguity, or a failed run. A rerun requires fresh current-task authorization. The general prohibition remains for all other solo-maintainer dispatch actions; direct gh/CLI/raw API/token dispatch, generic repository-write tools, secret viewing, self-authorization, gate weakening, active `PW_*` rotation, and extension beyond the exact allowlist remain forbidden.

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
2. The owner either dispatches `Provision Persistent QA Personas` personally or gives fresh current-task authorization for exactly one dispatch submission through the owner-authenticated GitHub UI or an available purpose-built GitHub connector workflow-dispatch action. The visible inputs must be the merged WIN-43 PR number, exact current main SHA, and acknowledgement `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`.
3. The owner verifies the run and downloads `win-43-qa-persona-manifest`. The artifact may contain only role, synthetic email, user id, organization id, and status.
4. Only after that run succeeds, the owner copies the same bootstrap values into the active `PW_*` secrets. `admin_schedule` is also copied to the legacy `PW_SCHEDULE_*` aliases.
5. The owner retains all `QA_BOOTSTRAP_*` secrets as the reviewed rollback set and dispatches the credentialed route audit separately. They are deleted only after a later reviewed rotation succeeds and the promoted active credentials pass their audit.

This is a one-time bootstrap against an empty reserved namespace. The provisioner refuses to repair or rotate any existing identity; subsequent checks use non-provisioning `--verify`, which creates temporary Auth sessions but does not update identities or application rows. Password rotation is handled separately by the reviewed `Rotate Persistent QA Persona Credentials` critical-lane workflow and `scripts/rotate-persistent-qa-persona-credentials.ts`. This order leaves existing `PW_*` credentials active until all new identities authenticate and pass exact-role and same-organization checks. GitHub Secrets cannot be read back, so password generation and both secret writes must occur in the same owner-controlled session or approved password manager workflow.

## QA Operational Readiness

After the persistent personas exist, use the same protected `Provision Persistent QA Personas` workflow with `operation=verify-readiness`. This operation maps the retained `QA_BOOTSTRAP_*` pairs into ephemeral runner-only `PW_*` variables, runs the existing `--verify` contract for all eight exact identities and their tenant graph, then opens a fresh isolated browser context per persona. It verifies one stable protected allowed route plus one denied route for each role, including `/account` for roles whose dashboard performs workflow reconciliation and the guardian-only `/family` denial for `super_admin`.

Readiness creates and revokes temporary Supabase Auth sessions because password and browser authentication cannot be proven without sessions. It binds credential entry and browser navigation to the exact `https://app.allincompassing.ai` origin and binds token creation and logout to the exact configured `SUPABASE_URL` origin. It intercepts the three schedule RPC requests, the eager supervision action-count RPC, and only the exact eager Sidebar payroll-read actions `get_day`, `review_queue`, and `get_administration`; fulfills them locally with fixed synthetic empty, zero-count, or disabled payloads; blocks mutation actions on those same endpoints and every other non-idempotent network request; and requires successful logout plus local token removal. No hosted schedule, supervision-count, or payroll-read function executes during readiness. It does not provision or update Auth users, write application records, rotate or promote credentials, submit forms, capture screenshots, inspect browser storage, or upload the preverify manifest containing hosted Auth identifiers. The retained artifact contains only role, requested route, a static allowlisted or redacted settled pathname, an exact allowlisted static page title or blank value, timing, stage, and status. A successful readiness manifest must contain sixteen passing entries: one allowed and one denied route result for each of the eight personas.

This readiness operation proves that the retained bootstrap credentials are usable by the protected QA harness. It does not copy them into the older active `PW_*` repository secrets and does not complete the later full workflow audit. Full persona walkthroughs may use the same retained bootstrap set only through separately reviewed secret-backed automation; no credential values may be viewed or exported.

## Credential Rotation

The rotation workflow is a separate owner-only protected path for the exact eight already-provisioned personas. It binds the stable namespace and exact Auth user ids from the successful bootstrap manifest:

| Persona | Stable email | Exact auth user id | Active credential secrets |
| --- | --- | --- | --- |
| BT | `playwright.qa.bt@example.com` | `48e62486-b142-4e6a-8e1e-165d6a8f6821` | `PW_BT_EMAIL`, `PW_BT_PASSWORD` |
| Therapist | `playwright.qa.therapist@example.com` | `ab03f560-8a71-4929-91ad-74be523d3c93` | `PW_THERAPIST_EMAIL`, `PW_THERAPIST_PASSWORD` |
| BCBA | `playwright.qa.bcba@example.com` | `f4488d24-bb11-482f-9367-bbb7e726e026` | `PW_BCBA_EMAIL`, `PW_BCBA_PASSWORD` |
| Midtier | `playwright.qa.midtier@example.com` | `bfaaad8d-cf0c-4843-81c4-680b564d3737` | `PW_MIDTIER_EMAIL`, `PW_MIDTIER_PASSWORD` |
| Schedule admin | `playwright.qa.admin_schedule@example.com` | `ad44fe11-7297-467b-9fed-0a8c6f56ce98` | staged `QA_BOOTSTRAP_ADMIN_SCHEDULE_EMAIL`, `QA_BOOTSTRAP_ADMIN_SCHEDULE_PASSWORD`, `QA_ROTATION_ADMIN_SCHEDULE_EMAIL`, `QA_ROTATION_ADMIN_SCHEDULE_PASSWORD`; the workflow derives its schedule compatibility environment aliases from these canonical staged secrets so no duplicate staged alias secrets can drift |
| Client | `playwright.qa.client@example.com` | `87130857-af13-4fe1-8195-c75710d5325f` | `PW_CLIENT_EMAIL`, `PW_CLIENT_PASSWORD` |
| Admin | `playwright.qa.admin@example.com` | `a67fa20b-b3f9-4625-98c4-ba106cc7a434` | `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` |
| Super admin | `playwright.qa.super_admin@example.com` | `5ba467e1-ef50-4247-bbb2-099ab70c26bb` | `PW_SUPERADMIN_EMAIL`, `PW_SUPERADMIN_PASSWORD` |

Before any password mutation, the workflow maps `QA_BOOTSTRAP_*` into the provisioner's existing `PW_*` contract and runs `scripts/provision-persistent-qa-personas.ts --verify`, retaining the sanitized preverify manifest as proof of the old login path plus the tenant graph. The rotation script then preflights every persona for exact email and auth id binding, exact WIN-43 ownership app metadata, strong bootstrap and rotation passwords, staged email parity, staged schedule alias parity, and denied-name absence. It updates one persona at a time with `auth.admin.updateUserById` and authenticates that persona immediately before moving to the next. If any update or login fails, the script rolls back every already-mutated persona in reverse order to its `QA_BOOTSTRAP_*` password, authenticates each rollback, and emits sanitized manifest statuses only. After a successful full pass, the workflow maps `QA_ROTATION_*` into the same `PW_*` verify contract, reruns `--verify`, retains the sanitized postverify manifest, and uploads the preverify, rotation, and postverify manifests together as one protected artifact.

Rotation dispatch is intentionally more restrictive than bootstrap dispatch. The workflow is owner-only, `main`-only, exact-current-main-bound, merged-PR-bound, WIN-43-bound, exact-head-CI-bound, sole-maintainer fail-closed, and hash-bound to `docs/ai/reviews/WIN-43-qa-persona-credential-rotation-attestation.json` for the exact protected workflow/script/test/handoff surfaces. Its live branch-protection read uses `QA_ROTATION_GITHUB_ADMIN_READ_TOKEN`, a short-lived fine-grained token limited to this repository with Administration read-only permission; it is never used for writes and must be deleted after the successful rotation artifact is retained. The workflow is not on the delegated browser-dispatch allowlist. Codex must not dispatch this rotation workflow. After the owner personally inspects and merges the critical PR, the owner must execute the rotation workflow personally with the exact acknowledgement `I_APPROVE_WIN_43_QA_PERSONA_CREDENTIAL_ROTATION`, the merged WIN-43 PR number, and the immutable current `main` SHA.

Only after that protected rotation run succeeds may the owner promote the exact same owner-retained `QA_ROTATION_*` values into the active `PW_*` secrets, with `admin_schedule` also copied to the legacy `PW_SCHEDULE_*` aliases. The owner must keep both staged sets available until the separate active credentialed audit passes. Delete `QA_BOOTSTRAP_*` and `QA_ROTATION_*` only after the active `PW_*` credentialed audit succeeds and its sanitized evidence is retained.

## Scope And Stop Conditions

Allowed: the dedicated Auth users, their `profiles` and exact `user_roles`, synthetic therapist rows/self-links, one synthetic client row, and same-org client-therapist links.

Stop before mutation if any stable email already exists in Auth, profiles, therapists, or clients. During verification, stop if any identity resolves to multiple active roles or any row has a different organization. Also stop if current `main` moves after approval, the merged PR does not reference WIN-43, or a required secret is absent. No migration, RLS, grant, RPC, Edge Function, `.env`, PHI, or direct `auth.users` SQL is allowed.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `CI/workflow/policy`, `persistent Auth provisioning`, and `tenant-scoped synthetic data writes`
- files touched: the existing provision workflow, the dedicated rotation workflow, `scripts/provision-persistent-qa-personas.ts`, `scripts/rotate-persistent-qa-persona-credentials.ts`, `tests/scripts/provision-persistent-qa-personas.test.ts`, `tests/scripts/rotate-persistent-qa-persona-credentials.test.ts`, `tests/workflows/provision-qa-personas.test.ts`, `tests/workflows/rotate-qa-persona-credentials.test.ts`, `docs/ai/reviews/WIN-43-qa-persona-delegated-browser-dispatch-attestation.json`, `docs/ai/reviews/WIN-43-qa-persona-credential-rotation-attestation.json`, and this handoff
- required agents: specification, architecture, implementation, code review, test, security, Supabase, and DevOps
- required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, focused provisioner/rotation/workflow tests, workflow YAML parse, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, and `npm run verify:local`
- executed checks: final focused provisioner/rotation/workflow/delegated-policy tests passed `36/36`; `npm run ci:check-focused` passed; `npm run lint` passed; `npm run typecheck` passed; workflow YAML parse passed; `npm run validate:tenant` passed; `npm run test:routes:tier0` passed `250/250`; `npm run build` passed; `git diff --check` passed
- executed aggregate check: `npm run test:ci` did not pass locally because the 4 GB Node process exhausted heap after more than two minutes of otherwise progressing tests. The interrupted run did not write `coverage/coverage-summary.json`, so the subsequent `npm run ci:verify-coverage` failed with that exact missing-summary reason.
- blocked checks: `npm run verify:local` is blocked by its locally non-green `test:ci` constituent; `npm run ci:verify-coverage` is blocked by the interrupted aggregate run; `npm run ci:playwright` is blocked until the owner merges, stages the reviewed credentials, completes the protected rotation, promotes the new `PW_*` secrets, and begins the separate credentialed route audit
- reviewer: independent code and security reviews approved; architecture, test, Supabase, and DevOps reviews completed
- result: `pass-with-blocked-checks`; no hosted mutation has occurred
- residual risk: Linux exact-head CI must resolve the Windows-only aggregate ambiguity, and account creation, authentication, exact-role readback, and credentialed route behavior remain unproven until owner-controlled post-merge activation
- PR handoff: ready for human review; owner merge remains mandatory and any delegated dispatch requires a fresh, one-time, exact-input owner-session authorization

## QA Readiness Verification Card (2026-08-20)

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `CI/workflow/policy` and secret-backed authenticated route verification; no application, schema, RLS, grant, RPC, Edge Function, or active credential change
- required checks: direct workflow parse and focused workflow/script contracts; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run test:routes:tier0`; `npm run ci:playwright`; `npm run build`; `npm run verify:local`
- executed checks: readiness/provisioning/rotation/delegated-policy focused contracts passed `37/37`; preserved WIN-275 pg_cron recovery and both QA workflow contracts passed `28/28`; workflow YAML parse passed with exactly `verify-readiness` and `provision-empty-namespace`; `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed; `git diff --check` passed; the bounded secret-pattern scan found no credential or token values
- aggregate local check: `npm run test:ci` did not pass; it first identified the intentionally changed handoff hash in the existing rotation attestation, which was corrected and passed its focused contract, then the continuing Windows run exhausted the 4 GB Node heap before completion
- blocked checks: `npm run test:routes:tier0` did not complete within the bounded eight-minute local wait and was terminated without a result; `npm run ci:verify-coverage` has no complete aggregate coverage input; `npm run verify:local` is blocked by the same local aggregate and route-gate constraints; `npm run ci:playwright` requires the protected repository secrets and hosted target and is the post-merge readiness proof
- result: `pass-with-blocked-checks`; no hosted workflow was dispatched and no hosted identity, application row, or secret was mutated
- residual risk: exact-head Linux CI must resolve the Windows aggregate and route-gate ambiguity; the eight credentials are not operationally proven until a merged current-main `verify-readiness` run returns a sanitized sixteen-pass artifact

## PR Hygiene

The diff is limited to the one-time provisioner, its owner-gated workflow, contract tests, and this handoff. It does not change migrations, RLS, grants, RPCs, application routes, runtime auth logic, active credentials, or customer data. Human review and owner merge are mandatory; Codex must not merge this critical change and may dispatch only through the exact one-submission owner-session exception above.

## Delegated Owner-Session Dispatch Policy Verification (2026-08-22)

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `CI/workflow/policy`; no application, migration, RLS, RPC, or provisioner behavior change
- historical merged-slice focused contracts: `37/37` passed at the delegated-dispatch policy stage across the three-workflow delegated policy, QA workflow/attestation, and both preserved WIN-275 hash-bound dispatch paths; the current rotation slice has its separate final `36/36` result above
- direct workflow validation: `.github/workflows/provision-qa-personas.yaml` parsed successfully and the contract requires `checks: read`, exact-head GitHub Actions CI, sole-maintainer topology, six PASS specialists, and all 18 protected hashes
- standard checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed
- route gate: `npm run test:routes:tier0` passed `250/250`
- aggregate local check: `npm run test:ci` is non-green on this Windows CRLF checkout because the inherited `tests/scripts/provision-ci-smoke-bcba.test.ts` source-order assertion searches for an LF-only literal; the same exact current-main SHA passed Linux `unit-tests` and every required CI job
- blocked checks at that historical stage: `npm run ci:verify-coverage` had no summary after the interrupted aggregate run; `npm run verify:local` was blocked by its locally non-green `test:ci` constituent; `npm run ci:playwright` remained blocked until the protected personas were provisioned and active `PW_*` secrets were separately rotated
- specialist reviews: code, security, test, architecture, Supabase, and DevOps all returned PASS on the post-sync hash-bound diff
- result: `pass-with-blocked-checks`; exact-head PR CI and owner review remain mandatory
- residual risk: no hosted persona mutation or credentialed route audit has occurred; the delegated action remains fail-closed on any main, CI-name, repository-topology, attestation, or protected-surface drift
