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
| Data Integrity | Soft-delete audit triggers for client/therapist archives | Backend / DB | In progress |
| Reliability | Documented test failures | QA / Eng | In progress |
| Reliability | Schedule data batch RPC 400s (aggregation ORDER BY) | Backend / DB | Applied migration (verify in prod) |
| Admin Governance | Admin users + guardian queue RPC access broken | Backend / DB | Applied migrations (verify in prod) |
| Reliability | Dashboard 403 for therapist role | Backend | Code fix pending deploy |

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
- Current advisor state: `272` findings (`166` `unused_index`, `105` `multiple_permissive_policies`, `1` `auth_db_connections_absolute`).
- Remaining backlog plan:
  1. Continue table-by-table permissive-policy consolidation with role-safety validation.
  2. Continue conservative unused-index retirement in small reversible batches.
