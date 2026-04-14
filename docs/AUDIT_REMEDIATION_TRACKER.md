# Audit Remediation Tracker

## Scope
Track remediation work from the executive audit report to close production-readiness gaps without expanding scope.

## Program status snapshot (2026-03-09)
| Horizon | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Immediate (0-7 days) | Dependency patching, JWT hardening, Vite FS strict mode, red test stabilization | Completed | `docs/short-term-remediation-closure.md`, CI baseline clean |
| Short-term (1-4 weeks) | Component decomposition, phased CORS restriction, dependency cleanup, named-export normalization (`src/**`) | Completed | `docs/short-term-remediation-closure.md`, `npm run ci:verify-coverage` |
| Long-term (1-2 quarters) | API authority policy, migration governance, architecture pack, reliability SLO enforcement | In progress (Q1 foundations complete) | `docs/long-term-platform-simplification.md` |

## Long-term foundation deliverables (implemented)
| Workstream | Deliverable | Status |
| --- | --- | --- |
| Service boundary simplification | `docs/api/API_AUTHORITY_CONTRACT.md` | Implemented |
| Service boundary simplification | `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md` | Implemented |
| Service boundary simplification | `scripts/ci/check-api-boundary.mjs` | Implemented |
| Service boundary simplification | `docs/api/endpoint-convergence-status.json` + `scripts/ci/check-api-convergence.mjs` | Implemented |
| Migration hygiene | `docs/migrations/MIGRATION_GOVERNANCE.md` | Implemented |
| Migration hygiene | `scripts/ci/check-migration-governance.mjs` | Implemented |
| Migration hygiene | `scripts/ci/generate-migration-catalog.mjs` + `scripts/ci/generate-migration-health-report.mjs` | Implemented |
| Architecture reference | `docs/architecture/NEW_ENGINEER_PACK.md` | Implemented |
| Architecture reference | `docs/architecture/pack-metadata.json` + `scripts/ci/check-architecture-pack-freshness.mjs` | Implemented |
| Reliability SLO | `tests/reliability/policy.json` + `tests/reliability/quarantine.json` | Implemented |
| Reliability SLO | `scripts/ci/check-test-reliability.mjs` + `scripts/ci/report-test-reliability.mjs` | Implemented |

## Remaining long-term execution (next milestones)
| Milestone | Owner | Target window | Exit criteria |
| --- | --- | --- | --- |
| Endpoint convergence waves B/C | Backend Platform | Q2 | No new business endpoints on non-authoritative runtime without approved exception |
| Migration metadata adoption for all new SQL | Backend / DB | Ongoing | All new migrations pass governance header checks |
| Quarantine governance operations | QA / Eng | Q2 | Quarantine entries carry owner/TTL and no expired active entries in CI |
| Architecture pack change control | Platform / DevEx | Ongoing | Pack updated on boundary/schema/deployment changes |

## Must-have gaps (pre-launch)
| Area | Gap | Owner | Status |
| --- | --- | --- | --- |
| Security / Tenant Safety | Org-scoped validation missing in critical edge endpoints | Backend | In progress |
| Security / Data Safety | `ai_guidance_documents` RLS-without-policy exposure fixed via `20260310162000_harden_ai_guidance_documents_rls.sql` | Backend / DB | Completed |
| Data Integrity | Soft-delete audit triggers for client/therapist archives | Backend / DB | Completed — migrations `20260120120000_soft_delete_audit_triggers.sql` and `20260121130000_soft_delete_audit_triggers_refresh.sql`; optional audit read coverage when `TEST_JWT_ORG_A_ADMIN` is set (`tests/admins/archive_soft_delete.spec.ts`) |
| Reliability | Documented test failures | QA / Eng | In progress |
| Reliability | Schedule data batch RPC 400s (aggregation ORDER BY) | Backend / DB | Applied migration (verify in prod) |
| Admin Governance | Admin users + guardian queue RPC access broken | Backend / DB | Applied migrations (verify in prod) |
| Reliability | Dashboard 403 for therapist role | Backend | Completed (admin/super-admin-only contract enforced + tests updated) |
| Business Logic Correctness | Scheduling RPC least-privilege + lifecycle transition enforcement (sessions/authorizations) | Backend / DB | Completed (`20260310190000_business_logic_lifecycle_hardening.sql`) |

## Strongly recommended
| Area | Gap | Owner | Status |
| --- | --- | --- | --- |
| Operations | Production monitoring + incident response runbooks | Platform / DevOps | In progress |
| CI Governance | Startup import/export canary + CI policy failure Slack hook (`scripts/ci/run-policy-checks.mjs`) | Platform / DevEx | Completed |
| DB Governance | New migration guard to prevent `ENABLE RLS` without same-file `CREATE POLICY` (`scripts/ci/check-rls-policy-coverage.mjs`) | Backend / DB | Completed |
| UX / Accessibility | Known a11y gaps in roster pages and modals | Frontend | In progress |
| Performance | API throttling and rate limits for schedule endpoints | Backend | In progress |

## Nice-to-have
| Area | Gap | Owner | Status |
| --- | --- | --- | --- |
| Performance | Load/perf benchmarks and scalability plan | Platform / DevOps | In progress |
| Compliance | Formal compliance documentation or certifications | Security / Compliance | In progress |
| Integrations | Integration catalog and partner readiness | Product / Eng | In progress |

## Advisor backlog tracking (2026-03-10)
- Early baseline: `283` findings (`29` `unindexed_foreign_keys`, `144` `unused_index`, `109` `multiple_permissive_policies`, `1` auth connection advisory).
- FK remediation complete via:
  - `20260310170000_assessment_fk_index_batch1.sql`
  - `20260310174500_fk_index_batch2_remaining.sql`
- Focused hardening pass applied via:
  - `20260310182500_policy_consolidation_batch1.sql`
  - `20260310184500_unused_index_drop_batch1.sql`
- Legacy advisor snapshot (pre-2026-04-13 narrative): `272` findings (`166` `unused_index`, `105` `multiple_permissive_policies`, `1` `auth_db_connections_absolute`) after the 2026-03-10 hardening pass; batch 2 (`20260413140000_unused_index_drop_batch2.sql`) applied on hosted **2026-04-13** (confirmed in ledger).
- **2026-04-14 MCP baseline** (Supabase `get_advisors`, performance type): see [docs/supabase/advisors-2026-04-14-mcp-baseline.md](supabase/advisors-2026-04-14-mcp-baseline.md) — `unused_index` **179**, `multiple_permissive_policies` **112**, `auth_db_connections_absolute` **1**, performance-type total **304**; security type returned `function_search_path_mutable` **2** (same raw export set as [docs/supabase/advisors-2026-04-14-security.json](supabase/advisors-2026-04-14-security.json)).
- **2026-04-14 post-apply** after `20260414153000_unused_index_drop_batch3.sql`: `unused_index` **177** (net **-2**); details in [docs/supabase/advisors-2026-04-14-post-apply.md](supabase/advisors-2026-04-14-post-apply.md).
- **2026-04-15 post-apply (WIN-35 parallel streams):** `20260415100000_unused_index_drop_batch4.sql` + `20260415110000_admin_actions_consolidated_policy_drop.sql` applied on hosted; MCP counts `unused_index` **175**, `multiple_permissive_policies` **110** — see [docs/supabase/advisors-2026-04-15-parallel-win35.md](supabase/advisors-2026-04-15-parallel-win35.md).
- **2026-04-16 post-apply (WIN-35 four-stream wave):** `20260416100000_unused_index_drop_alpha_win35.sql`, `20260416110000_unused_index_drop_beta_win35.sql`, `20260416120000_ai_cache_admin_manage_policy_drop.sql` applied on hosted; MCP counts `unused_index` **167**, `multiple_permissive_policies` **107** — see [docs/supabase/win-35-four-stream-wave-2026-04-16.md](supabase/win-35-four-stream-wave-2026-04-16.md) and post-export `docs/supabase/advisors-2026-04-16-win35-four-stream-performance-post-apply.json`.
- Remaining backlog plan:
  1. Continue table-by-table permissive-policy consolidation with role-safety validation.
  2. Continue conservative unused-index retirement in small reversible batches.

## Documentation change log (2026-03-10)
- Added `docs/BUSINESS_LOGIC_REMEDIATION_2026_03_10.md` with:
  - P0-P2 remediation scope, migration details, runtime guard updates, and validation evidence.
  - Hosted migration application outcome and post-apply verification results.
  - Remaining condition for authenticated Playwright conflict-flow smoke.
- Updated `docs/SESSION_HOLD_CONTRACT.md` with 2026-03 RPC privilege hardening notes.
- Updated `docs/SESSION_START_NOTES_UPDATES_2026_02.md` with stricter start-state gating and linkage to the 2026-03 hardening migration.
- Updated `docs/advisors-migration-summary.md` with the focused hardening pass details:
  - Added applied migrations for policy consolidation and unused-index cleanup.
  - Added before/after advisor counts and net delta.
  - Added safety notes describing scope limits for policy/index changes.
- Updated `docs/AUDIT_REMEDIATION_TRACKER.md` to reflect:
  - Completion evidence for RLS hardening and CI guardrails.
  - Current advisor backlog after FK and focused hardening batches.
  - Remaining conservative backlog strategy (policy consolidation + unused index retirement).

## Documentation change log (2026-03-11)
- Completed UX/accessibility + observability remediation implementation across:
  - `src/lib/authContext.tsx` (profile fetch fallback for schema drift)
  - `src/components/SessionModal.tsx` (focus trap, escape handling, focus restore, accessible labeling)
  - `src/pages/Login.tsx`, `src/pages/Signup.tsx` (validation recovery focus + live error announcements)
  - `src/App.tsx` and `src/lib/api.ts` (route telemetry + request/correlation header propagation)
- Added migration `supabase/migrations/20260311195000_auth_profile_and_query_metrics_contract.sql` and applied it to hosted Supabase:
  - Adds `public.profiles.organization_id`
  - Creates `public.query_performance_metrics` with indexes and RLS policies
- Added regression coverage:
  - `src/components/__tests__/SessionModal.test.tsx` for keyboard/focus behavior
  - `scripts/playwright-mobile-role-smoke.ts` + `npm run playwright:mobile-role-smoke`

## Documentation change log (2026-03-12)
- Added `docs/PHASE0_EXECUTION_STATUS_2026_03_12.md` with:
  - Phase 0 security hardening scope executed for API CORS and MCP edge authentication.
  - Validation evidence (`targeted tests`, `typecheck`, `lint`, `ci:check-focused`, `preview smoke`).
  - MCP baseline evidence from GitHub + Supabase advisor checks.
  - Explicit remaining blockers and release gate status.
- Implemented and validated code hardening for:
  - `src/server/api/book.ts` (strict origin checks + shared CORS response path)
  - `src/server/api/dashboard.ts` (strict origin checks + admin/super-admin authorization only)
  - `supabase/functions/mcp/function.toml` (`verify_jwt = true`)
  - `supabase/functions/mcp/index.ts` (JWT-only auth validation + allowlist CORS)
- Updated server handler regression tests:
  - `src/server/__tests__/bookHandler.test.ts`
  - `src/server/__tests__/dashboardHandler.test.ts`
  - Added CORS allow/deny coverage and adjusted dashboard auth expectations.
- Updated Playwright authorization smoke reliability:
  - Corrected therapist-authorization env IDs in `.env.codex` to real foreign entities.
  - Hardened `scripts/playwright-therapist-authorization.ts` login and guard detection to reduce flaky failures.
  - Verified `npm run playwright:auth` and `npm run playwright:therapist-authorization` both pass.

## Documentation change log (2026-03-12, Phase 1 execution)
- Added `docs/PHASE1_EXECUTION_STATUS_2026_03_12.md` with:
  - Phase 1 workstream execution status (authority convergence, role consistency, test reliability, release/docs alignment).
  - Validation evidence for policy checks, handler tests, Playwright smokes, and tier-0 Cypress.
  - Exit-criteria sign-off mapping.
- Authority and boundary artifacts updated:
  - `docs/api/critical-endpoint-authority.json`
  - `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md`
  - `scripts/ci/check-api-convergence.mjs` (inventory parity validation)
- Role and reliability hardening updates:
  - `src/server/api/dashboard.ts` (default-org fallback now explicit opt-in via `DASHBOARD_ALLOW_DEFAULT_ORG_FALLBACK`)
  - `src/server/api/shared.ts` (local preview/Cypress origins allowlisted)
  - `src/server/__tests__/dashboardHandler.test.ts`, `src/server/__tests__/bookHandler.test.ts`
  - `cypress/e2e/routes_integrity.cy.ts`, `cypress/e2e/role_access.cy.ts`
- Release contract alignment + guardrails:
  - `docs/PREVIEW_SMOKE.md`, `docs/ENVIRONMENT_MATRIX.md`, `docs/EXEC_OVERVIEW.md`
  - `scripts/ci/check-runbook-ci-alignment.mjs` integrated into `scripts/ci/run-policy-checks.mjs`

## Documentation change log (2026-03-12, Phase 2 execution)
- Added `docs/PHASE2_EXECUTION_STATUS_2026_03_12.md` with:
  - workstream-by-workstream execution evidence
  - KPI outcomes for schedule latency proxy, payload reduction, and request-discipline checks
  - policy/non-regression validation summary
- Added Phase 2 metrics artifacts and checks:
  - `scripts/perf/capture-p2-baseline.mjs` -> `reports/p2-baseline-metrics.json`
  - `scripts/ci/check-p2-performance.mjs` -> `reports/p2-performance-metrics.json`
  - Integrated into policy gate via `scripts/ci/run-policy-checks.mjs`
- Implemented performance/data-path hardening:
  - `src/pages/Schedule.tsx`, `src/pages/schedule-utils.ts` (slot index + bounded auto-schedule concurrency)
  - `src/lib/useRouteQueryRefetch.ts` (route-scoped invalidation)
  - `src/components/Dashboard/ReportsSummary.tsx`, `src/pages/Reports.tsx` (aggregate/projection-driven report metrics)
  - `supabase/functions/get-sessions-optimized/index.ts` (cursor pagination + SQL summary aggregation via `get_session_metrics`)
- Added regression tests for P2 contracts:
  - `src/pages/__tests__/schedule-utils.test.ts`
  - `src/lib/__tests__/useRouteQueryRefetch.test.ts`
  - `src/pages/__tests__/Reports.metrics.test.ts`
  - `src/components/Dashboard/__tests__/ReportsSummary.metrics.test.ts`

## Documentation change log (2026-03-12, Phase 3 execution)
- Added deterministic Playwright reliability foundation:
  - `scripts/lib/playwright-smoke.ts` for shared login/session/assertion helpers.
  - Refactored `scripts/playwright-auth-smoke.ts`, `scripts/playwright-schedule-conflict.ts`,
    `scripts/playwright-therapist-onboarding.ts`, `scripts/playwright-therapist-authorization.ts`
    to remove skip-style exits and enforce explicit pass/fail contracts.
- Added strict Playwright env/data preflight contract:
  - `scripts/playwright-preflight.ts`
  - `scripts/lib/load-playwright-env.ts` now errors when `PLAYWRIGHT_ENV_FILE` is set to a missing file.
  - `.env.example` updated with required Phase 3 Playwright contract vars.
- Expanded reliability gates and CI policy coverage:
  - `tests/reliability/policy.json` includes explicit E2E pass-rate/retry/skip budgets.
  - `scripts/ci/check-e2e-reliability-gates.mjs` added and wired into:
    - `scripts/ci/run-policy-checks.mjs`
    - `package.json` (`ci:check:e2e-reliability`)
  - `cypress/e2e/role_access.cy.ts` now tracks and asserts route-level network stability (`0/5xx` guard).
- Ops/release contract updates:
  - `docs/PREVIEW_SMOKE.md`
  - `docs/STAGING_OPERATIONS.md`
  - `docs/ENVIRONMENT_MATRIX.md`
  - Added `docs/PHASE3_EXECUTION_STATUS_2026_03_12.md` for execution evidence and residual risks.

## Documentation change log (2026-04-14, P06 MCP Vitest + handler extract)
- **P06 implementation:** `supabase/functions/mcp/mcpHandler.ts` exports `createMcpHandler`, `resolveMcpRoute`, and `RPC_ALLOWLIST` for testable parity; `index.ts` wires production Supabase clients. `tests/edge/mcp.parity.contract.test.ts` covers **A11-01**…**A11-05** per `docs/ai/P06-mcp-edge-contract-spec.md`. Gateway-style pathnames (`/functions/v1/mcp/health`, `/rpc`, `/table/...`) are supported.
- **Planning rows:** `WIN-38I` / `WIN-38G` / `WIN-38C` / `WIN-38H` / `WIN-38J` updated to **closed** for **P06** baseline.

## Documentation change log (2026-04-14, P05 closure + P06 MCP spec)
- **P05 (RPC org/role equivalence):** Marked **closed** in `docs/ai/P05-rpc-org-role-equivalence.md` and parity planning rows (`WIN-38I` / `WIN-38G` `A10` / `WIN-38H` / `WIN-38C` RPC row). Evidence is existing Vitest contracts only; optional live smoke remains out-of-band.
- **P06 (MCP edge):** Added authoritative product/security contract `docs/ai/P06-mcp-edge-contract-spec.md` (AuthN, CORS, RPC allowlist, table deny, audit events, `A11-01`…`A11-05` assertion IDs). Next executable slice is **Vitest** `tests/edge/mcp.parity.contract.test.ts` per spec §9; **`WIN-38G` `A11`** renamed to **`A11-mcp-edge-contract`** in the ledger.

## Documentation change log (2026-04-14, WIN-38D / WIN-38 parity baseline closure)
- **WIN-38D / WIN-38 children:** Refreshed `docs/ai/WIN-38I-parity-scenario-execution-index.md`, `docs/ai/WIN-38G-assertion-ledger.md`, `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`, `docs/ai/WIN-38H-parity-test-plan.md`, and `docs/ai/WIN-38J-parity-naming-fixture-dictionary.md` per `docs/ai/WIN-38D-evidence-analysis.md`. **P01** and **P07** readiness upgraded from **blocked** to **partial**; canonical test files documented (`programs.cors.contract.test.ts` + `programsHandler.test.ts`, `goalsHandler.test.ts`, `assessmentDocumentsHandler.test.ts`). Recorded **baseline closure** for **WIN-38D** (programs/goals/assessment-docs Vitest matrix), **WIN-38E** (sessions-start), and **WIN-38F** (dashboard), with optional integration/E2E; **P05/P06** tracking superseded by later 2026-04-14 P05 close + P06 spec entries.

## Documentation change log (2026-04-14, WIN-38 planning doc hygiene)
- **WIN-38:** Refreshed `docs/ai/WIN-38I-parity-scenario-execution-index.md`, `docs/ai/WIN-38J-parity-naming-fixture-dictionary.md`, `docs/ai/WIN-38H-parity-test-plan.md`, and `docs/ai/WIN-38G-assertion-ledger.md` so **P02** reflects shipped **goals** edge contract tests (`tests/edge/goals.parity.contract.test.ts`) and defers API/linkage work to **WIN-38D**. **P03** dashboard parity remains **WIN-38F** (see execution index).

## Documentation change log (2026-04-14, WIN-38F dashboard parity)
- **WIN-38F:** Added `tests/edge/dashboard.parity.contract.test.ts` (org fail-closed, super-admin metadata org resolution, RPC `42501` → 403) and `src/server/__tests__/dashboardParity.contract.test.ts` (proxy pass-through for 403 body and 429 `Retry-After`). Updated **P03** / **A03** / **A07** rows in WIN-38I, WIN-38J, WIN-38H, and WIN-38G to **partial** with evidence pointers. **Auth ordering:** dashboard remains **admin middleware first**, then org resolution inside the handler (differs from goals’ org-before-`getUser` pattern by design).

## Documentation change log (2026-04-14, WIN-38E sessions-start parity)
- **WIN-38E:** `supabase/functions/sessions-start/index.ts` uses org-context fail-closed handling (`MissingOrgContextError` / shallow 403 before `auth.getUser`) consistent with goals/programs. Legacy `src/server/api/sessions-start.ts` RPC `statusMap` includes `FORBIDDEN` / `UNAUTHORIZED` aligned with the edge handler. Contract coverage: `tests/edge/sessionsStart.parity.contract.test.ts` (missing org, wrong-owner 403, out-of-org 404, RPC `FORBIDDEN` → 403), `src/server/__tests__/sessionsStartParity.contract.test.ts` (edge authority proxy 403 body and 429 `Retry-After`), and `src/server/__tests__/sessionsStartHandler.test.ts` (legacy RPC `FORBIDDEN` / `UNAUTHORIZED`). **P04** / **A04** / **A08** rows in WIN-38I, WIN-38J, WIN-38H, and WIN-38G set to **partial** with evidence pointers.

## Documentation change log (2026-04-15, WIN-35 parallel streams)
- **WIN-35:** Landed parallel Stream A (unused-index batch 4) and Stream B (`admin_actions` legacy `consolidated_*` policy drop) with MCP post-export under `docs/supabase/advisors-2026-04-15-*`; `npm run validate:tenant` passed after Stream B. Updated `docs/advisors-migration-summary.md` and advisor backlog bullets above.

## Documentation change log (2026-04-16, WIN-35 four-stream wave)
- **WIN-35:** S4 triage doc + pre-apply MCP JSON (`docs/supabase/win-35-four-stream-wave-2026-04-16.md`, `advisors-2026-04-16-win35-four-stream-performance.json`); Linear child issues **WIN-104** / **WIN-105** / **WIN-106** plus parent comment stub. Landed S1/S2 index migrations and S3 `ai_cache` redundant policy drop; post-apply MCP JSON; `npm run validate:tenant` after S3. Updated `docs/advisors-migration-summary.md` and advisor backlog bullets above.

## Documentation change log (2026-04-14, WIN-35 MCP advisor E2E)
- **WIN-35:** Captured MCP advisor exports under `docs/supabase/` (`advisors-2026-04-14-mcp-baseline.md`, performance/security JSON, post-apply performance JSON + delta doc). Applied `supabase/migrations/20260414153000_unused_index_drop_batch3.sql` on hosted (`admin_actions_admin_user_id_idx`, `impersonation_audit_actor_user_id_idx`). Updated advisor backlog bullets above and `docs/advisors-migration-summary.md`. **Linear:** paste the WIN-35 blurb from [docs/supabase/advisors-2026-04-14-post-apply.md](supabase/advisors-2026-04-14-post-apply.md#linear-win-35-paste-as-comment) if the Linear MCP client is not connected in this environment.

## Documentation change log (2026-04-14, WIN-34 / WIN-38 / WIN-35 triage execution)
- **WIN-34 (soft-delete audit):** Marked must-have row **Completed** in this tracker. Canonical migrations implement `app.log_soft_delete_action` and `AFTER INSERT OR UPDATE OF deleted_at` triggers on `clients`, `therapists`, and `client_guardians` writing to `public.admin_actions`. `admin_actions` SELECT remains **admin-scoped** (`admin_actions_select_scoped`); integration coverage for audit rows is optional behind `TEST_JWT_ORG_A_ADMIN` in `tests/admins/archive_soft_delete.spec.ts`.
- **WIN-38 (org-scoped edge):** No change to must-have row status; **programs**, **goals**, **dashboard** (WIN-38F), and **sessions-start** (WIN-38E) baseline parity is covered by the Vitest contract files named in `docs/ai/WIN-38I-parity-scenario-execution-index.md`. **MCP (`P06`):** contract in `docs/ai/P06-mcp-edge-contract-spec.md`; Vitest parity tests are the remaining implementation slice. Follow-on **WIN-38D** API/matrix work where rows stay partial.
- **WIN-35 (advisor backlog):** Unused-index batch 2 landed 2026-04-13 (`20260413140000_unused_index_drop_batch2.sql`); further permissive-policy consolidation still requires a **fresh Supabase advisor export** and table-by-table review (see advisor backlog section above).

## Documentation change log (2026-04-13, WIN-38 goals parity + WIN-35 index batch 2)
- **WIN-38:** `supabase/functions/goals/index.ts` now matches **programs** org-context handling (`MissingOrgContextError` / 403-shallow catch before `auth.getUser`), and goal **POST** inserts use `orgScopedQuery` for defensive org depth. Contract coverage: `tests/edge/goals.parity.contract.test.ts` (missing-org GET, invalid-token + missing-org ordering, out-of-org POST program_id matrix, existing PATCH matrix).
- **WIN-35:** Added `supabase/migrations/20260413140000_unused_index_drop_batch2.sql` (drops `referring_providers_name_idx`, `organization_plans_plan_code_idx`) with rationale in `docs/advisors-migration-summary.md`.
