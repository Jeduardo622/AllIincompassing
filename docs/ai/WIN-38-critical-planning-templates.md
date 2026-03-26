# WIN-38 Critical Planning Templates (Planning-Only)

Status: Planning/Docs only. No runtime implementation in this artifact.

Parent issue: `WIN-38`  
Parent route-task: `classification = high-risk human-reviewed`, `lane = critical`

This file defines review-ready templates for child planning tracks only:

- `WIN-38A` Endpoint inventory template
- `WIN-38B` Org-context/authz contract template
- `WIN-38C` Allow/deny + abuse-case matrix template
- `WIN-38D` Regression verification template

---

## Guardrails

- Do not edit protected runtime paths in this planning track:
  - `supabase/migrations/**`
  - `supabase/functions/**`
  - `src/server/**`
  - `src/lib/auth*`
  - `src/lib/runtimeConfig*`
  - `scripts/ci/**`
  - `.github/workflows/**`
  - `netlify.toml`
- Treat these behaviors as `critical` even if path scope looks narrow:
  - tenant isolation, RLS, grants, RPC exposure
  - authz boundary widening
  - billing, impersonation, guardian flows
  - secrets or credential handling
- Do not include speculative runtime patches.
- Keep scope endpoint-family bounded and review-gated.
- If future implementation touches protected paths, re-route to `critical` immediately.

---

## Child Item Routing (Fresh route-task outputs)

Parent/child lane rule:

- Parent `WIN-38` remains `critical` until planning prerequisites are accepted and runtime work is explicitly re-routed.
- Child items below are `fast` only while the diff remains in `docs/**` and no runtime/protected path is edited.

### WIN-38A

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only endpoint inventory in `docs/**`; no runtime behavior change
- triggering paths: `docs/ai/WIN-38-critical-planning-templates.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer` (docs authoring only)
  - `code-review-engineer`
- reviewer required: yes (non-trivial planning artifact)
- verify-change required: yes (non-trivial repo change policy for this planning PR)
- mandatory checks:
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests when available, otherwise `npm test`
  - `npm run build`
  - manual verification of links/commands/paths
- linear required: no (already nested under parent `WIN-38`)

### WIN-38B

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only contract drafting under `docs/**`
- triggering paths: `docs/ai/WIN-38-critical-planning-templates.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer` (docs authoring only)
  - `code-review-engineer`
- reviewer required: yes (non-trivial planning artifact)
- verify-change required: yes (non-trivial repo change policy for this planning PR)
- mandatory checks:
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests when available, otherwise `npm test`
  - `npm run build`
  - manual verification of links/commands/paths
- linear required: no (already nested under parent `WIN-38`)

### WIN-38C

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only risk matrix with no protected-path implementation
- triggering paths: `docs/ai/WIN-38-critical-planning-templates.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer` (docs authoring only)
  - `code-review-engineer`
- reviewer required: yes (non-trivial planning artifact)
- verify-change required: yes (non-trivial repo change policy for this planning PR)
- mandatory checks:
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests when available, otherwise `npm test`
  - `npm run build`
  - manual verification of links/commands/paths
- linear required: no (already nested under parent `WIN-38`)

### WIN-38D

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only verification planning with no runtime changes
- triggering paths: `docs/ai/WIN-38-critical-planning-templates.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer` (docs authoring only)
  - `code-review-engineer`
- reviewer required: yes (non-trivial planning artifact)
- verify-change required: yes (non-trivial repo change policy for this planning PR)
- mandatory checks:
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests when available, otherwise `npm test`
  - `npm run build`
  - manual verification of links/commands/paths
- linear required: no (already nested under parent `WIN-38`)

---

## Template: WIN-38A Endpoint Inventory

Use this template to list endpoint families before any implementation.

Repeat this record for each endpoint family:

- endpoint family: `<family-name>`
- paths:
  - `<supabase/functions/** or src/server/** path>`
- owner: `<team/person>`
- caller class: `<user session / internal / service>`
- data operations: `<read/write/mutate/export>`
- org-sensitive: `<yes/no>`
- notes: `<constraints>`

Checklist:

- [ ] Every org-sensitive endpoint family is listed.
- [ ] Caller class and trust boundary are explicit.
- [ ] Data operation type is explicit.
- [ ] Unknowns are labeled as open questions, not assumptions.

---

## Template: WIN-38B Org-Context/Authz Contract

Use this template per endpoint family.

### Contract Record: `<endpoint-family>`

- Expected caller identity:
  - `<role/session/system identity>`
- Required org context source (trusted):
  - `<JWT claim/session-derived/server-side context>`
- Forbidden org context source (untrusted):
  - `<header/query/body/path overrides if not trusted>`
- Authn expectation:
  - `<required auth state>`
- Authz expectation:
  - `<required role/policy>`
- Pre-DB authorization gate required:
  - `<yes/no with rationale>`
- Data boundary:
  - `<edge function / server route / rpc / direct query>`
- RLS/grants expectation:
  - `<expected policy/grant posture>`
- Service-role usage:
  - `<none or explicit justification + constrained scope>`
- Expected deny semantics:
  - status: `<401/403/404/etc>`
  - error shape: `<contract>`

Checklist:

- [ ] Trusted org source is explicit.
- [ ] Untrusted override channels are explicitly denied.
- [ ] Role requirements are explicit.
- [ ] Deny behavior is stable and testable.

---

## Template: WIN-38C Allow/Deny + Abuse-Case Matrix

Use this matrix per endpoint family.

Use one record per scenario:

- scenario: `Same-org allowed read`
  - caller identity: `<valid role>`
  - org source supplied: `<trusted org context>`
  - expected result: `Allow`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Same-org allowed write (create/update/delete)`
  - caller identity: `<valid role>`
  - org source supplied: `<trusted org context>`
  - expected result: `Allow`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Cross-org access attempt`
  - caller identity: `<valid role>`
  - org source supplied: `<other org id>`
  - expected result: `Deny`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Valid org context + foreign resource id (IDOR)`
  - caller identity: `<valid role>`
  - org source supplied: `<trusted org>`
  - expected result: `Deny`
  - classification: `Mandatory`
  - evidence/test target: `<integration/security test id>`
- scenario: `List/search/export with mixed-tenant fixture`
  - caller identity: `<valid role>`
  - org source supplied: `<trusted org>`
  - expected result: `Return only same-org data`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Missing org context`
  - caller identity: `<valid role>`
  - org source supplied: `<none>`
  - expected result: `Deny`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Unauthenticated request`
  - caller identity: `<none>`
  - org source supplied: `<any>`
  - expected result: `Deny`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Role mismatch`
  - caller identity: `<insufficient role>`
  - org source supplied: `<trusted org>`
  - expected result: `Deny`
  - classification: `Mandatory`
  - evidence/test target: `<integration test id>`
- scenario: `Forged override input`
  - caller identity: `<valid role>`
  - org source supplied: `<header/query/body override>`
  - expected result: `Deny or neutral non-leaking response per approved contract`
  - classification: `Mandatory`
  - evidence/test target: `<security regression test id>`
- scenario: `High-volume probing`
  - caller identity: `<any>`
  - org source supplied: `<any>`
  - expected result: `Controlled deny / safe handling`
  - classification: `Nice-to-have unless required by risk review`
  - evidence/test target: `<load/abuse test ref>`
- scenario: `Service-role/elevated caller boundary`
  - caller identity: `<service/internal>`
  - org source supplied: `<server-controlled>`
  - expected result: `Allow only when explicitly intended; deny end-user path`
  - classification: `Mandatory when family uses service role/elevated path`
  - evidence/test target: `<integration/security test id>`
- scenario: `Impersonation/guardian/billing-sensitive path`
  - caller identity: `<delegated or privileged caller>`
  - org source supplied: `<trusted org context>`
  - expected result: `Allow only per explicit policy; deny otherwise`
  - classification: `Mandatory when feature is in scope`
  - evidence/test target: `<integration/security test id>`

Checklist:

- [ ] All mandatory allow/deny paths are mapped.
- [ ] Abuse cases include forged org context and role mismatch.
- [ ] Nice-to-have scenarios are clearly separated.

---

## Template: WIN-38D Regression Verification Plan

Use this to define required checks before runtime changes are approved for merge.

Authoritative source:

- Required command union comes from `docs/ai/verification-matrix.md`.
- Critical-lane agent sequence comes from `docs/ai/cto-lane-contract.md`.
- Use the union of lane baseline and category-specific requirements from the verification matrix.

### Mandatory checks (WIN-38 org-sensitive implementation baseline)

- `npm ci`
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`

Notes:

- `docs/ai/cto-lane-contract.md` `critical` core list remains authoritative.
- `npm run validate:tenant` is mandatory for WIN-38 endpoint slices because this workstream is org-scope/tenant-sensitive by definition.

Conditional mandatory checks:

- `npm run test:routes:tier0` when protected route/auth/session flows are affected
- `npm run ci:playwright` when browser auth/session coverage is required
- `npm run verify:local` when required checks are secret-free and supported locally

### Endpoint-family verification table

Repeat this record per endpoint family:

- endpoint family: `<family-name>`
- test level: `<unit/integration/e2e/manual>`
- mandatory cases: `<allow+deny case references>`
- optional cases: `<extra abuse/perf checks>`
- reviewer roles:
  - `code-review`
  - `security`
  - `test`

### Merge gate checklist

- [ ] `route-task` lane/classification confirmed
- [ ] Required checks listed and executed, or explicitly blocked with reason
- [ ] `verify-change` card completed
- [ ] `pr-hygiene` verdict present
- [ ] Reviewer sign-off captured (`code-review`, `security`, `test`)

---

## Queue-Runner Pause Rule

Queue-runner autonomy remains paused for runtime implementation while the top queue item (`WIN-38`) is `critical` and unresolved in approved planning gates.  
Only planning/docs child work under `docs/**` may proceed until critical-path gates are cleared.
