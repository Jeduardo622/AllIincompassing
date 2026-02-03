 # Executive Specification: Agentic Platform for ABA Community
 
 ## Goal (Product Terms)
 Deliver a safe, reliable, and scalable agentic platform that supports ABA workflows (scheduling, documentation, billing, compliance) with clear guardrails, tenant isolation, and production-grade observability.
 
 ## Scope
 - Platform-level agentic capabilities (architecture, autonomy, tool orchestration, memory/state, safety).
 - Operational readiness (observability, rollback, incident response).
 - Supabase data safety for AI/agent tables and policies.
 
 ## Non-Goals (This ExecSpec)
 - Feature expansion beyond core ABA workflows.
 - Replacing clinician judgment or regulatory compliance sign-off.
 
 ## Current Baseline (Observed in Repo)
 - Agent interactions routed through edge functions with role-based guardrails and audit trails.
 - Tenant isolation enforced via RLS with organization-scoped access patterns.
 - Observability runbooks and structured logging in place.
 - AI transcription and session note generation documented with testing plan.
- Scheduling delegation now includes an auditable orchestration layer for holds/conflicts/cancellations (`docs/SCHEDULING_ORCHESTRATION.md`).
 
 ## Architectural Targets
 - Bounded, controllable agent behavior with server-side tool enforcement.
 - Deterministic, replayable agent outcomes where feasible.
 - Clear human-in-the-loop decision points for clinical, billing, and scheduling changes.
 - Full multi-tenant isolation with explicit org-scoped identities.
 
 ## Improvements Mapped to `.cursor/agents` (Primary Owners)
 
 | Improvement | Agent Owner | Doc Anchor | Priority |
 |---|---|---|---|
 | Server-side tool permission enforcement + execution gate | `aba-ops-coordinator` | `docs/security/tenant-isolation.md`, `docs/EXEC_OVERVIEW.md` | Blocking |
 | Agent trace pipeline (step-level traces, correlation IDs, replay) | `aba-ops-coordinator` | `docs/OBSERVABILITY_RUNBOOK.md` | Blocking |
 | Kill-switch / runtime disable for agent actions | `aba-ops-coordinator` | `docs/STAGING_OPERATIONS.md` | Blocking |
 | Prompt/tool version registry with rollback policy | `docs-updater` | `docs/EXEC_OVERVIEW.md` | High |
 | Agent eval harness + regression tests | `code-reviewer` | `docs/TESTING.md`, `docs/TRANSCRIPTION_TESTING_PLAN.md` | High |
 | Structured error taxonomy + retry policies | `debugger` | `docs/OBSERVABILITY_RUNBOOK.md` | High |
 | Injection resilience upgrades (beyond regex) | `aba-ops-coordinator` | `docs/security/tenant-isolation.md` | High |
 | Long-term memory governance + retention controls | `docs-updater` | `docs/security/client-guardians.md` | Medium |
 | Multi-agent orchestration patterns (if needed) | `aba-ops-coordinator` | `docs/EXEC_OVERVIEW.md` | Nice-to-have |
 
 ## Supabase Audit Snapshot (MCP Findings)
 
 ### AI/Agent-Related Tables (RLS Enabled)
 - `ai_cache`, `ai_response_cache`, `ai_processing_logs`, `ai_session_notes`, `ai_performance_metrics`
 - `chat_history`, `conversations`
 
 ### Policy Highlights (Potential Review Items)
 - Multiple `public` and `authenticated` policies exist on AI tables (verify least-privilege).
 - `ai_processing_logs` includes `public` SELECT policy (confirm if intended).
 - `ai_session_notes` includes `public` INSERT policy (confirm if intended).
 
 ### Security Advisor Warnings (Supabase)
 - Functions missing fixed `search_path`:
   - `public.create_authorization_with_services`
   - `public.update_authorization_with_services`
 
 ### Performance Advisor Findings (Supabase)
 - Unindexed foreign keys detected (example set):
   - `public.service_contract_rates` (`contract_id`, `organization_id`)
   - `public.service_contract_versions` (`contract_id`, `organization_id`)
   - `public.service_contracts` (`created_by`, `updated_by`)
 
 ## Required Improvements (Prioritized)
 
 ### Blocking (Before Production Agentic Use)
 - Enforce tools server-side (deny/allow + audit at execution).
 - Add agent execution traces with replayability hooks.
 - Implement runtime kill-switch and rollback guard.

#### Blocking Implementation Notes
- Server-side tool allowlists + execution gate enforced in `ai-agent-optimized`.
- Step-level traces captured in `agent_execution_traces` with request/correlation IDs and replay payloads.
- Kill switch available via `agent_runtime_config` and `AGENT_ACTIONS_DISABLED`.
 
 ### High Priority
 - Formal agent eval harness and regression tests.
- Prompt/tool versioning + change management policy (registry + manual rollback).
- Error taxonomy with retries/backoff and classification (edge + frontend).
- Strengthen prompt injection and policy enforcement (edge + frontend validation).
 
 ### Medium Priority
- Long-term memory governance and retention policy (defined in tenant isolation runbook).
- Deterministic replay tooling (seeded runs, trace IDs) — initial replay script in observability runbook.
 
 ### Nice-to-have
- Multi-agent orchestration where workflows require delegation (scheduling orchestration shipped; see `docs/SCHEDULING_ORCHESTRATION.md`).
 
 ## Acceptance Criteria (Testable)
 - Given an agent attempts a tool action, when the server denies it, then the action is blocked and audited.
 - Given an agent execution, when it completes, then a trace with requestId, tool calls, and outputs exists.
 - Given a policy update, when prompts/tools change, then a versioned record is stored with rollback path.
 - Given a cross-tenant request, when it is detected, then it is denied and logged with org context.
 - Given an agent failure, when it occurs, then a standardized error classification is emitted.
 
 ## Rollout Recommendation (ABA Community Safety)
 - Phase 1: Assistive agents only (read-only or suggestion-only).
 - Phase 2: Bounded actions with explicit human confirmation and audit trails.
 - Phase 3: Limited autonomous actions after full guardrails + evals pass.
