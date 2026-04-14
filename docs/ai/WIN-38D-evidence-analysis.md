# WIN-38D Evidence-First Analysis

This document implements the **Analyze WIN-38D (evidence-first)** plan: inventory code and tests, reconcile planning artifacts, classify residual gaps, and record verification expectations. It does not change runtime behavior.

**Date:** 2026-04-14  
**Scope:** P01 (programs), P02 (goals), P07 (assessment-documents); assertions A01, A02, A05, A06, A09.

---

## 1. Assertion-to-evidence matrix

### P01 / A01 / A05 — Programs

| Layer | Artifact | Role × method coverage (deny / org) |
|-------|----------|-------------------------------------|
| Edge | [`supabase/functions/programs/index.ts`](../../supabase/functions/programs/index.ts) | `requireOrg` → `getUser` → `hasAllowedRole`; POST/PATCH use `orgScopedQuery` / client validation. |
| Edge tests | [`tests/edge/programs.cors.contract.test.ts`](../../tests/edge/programs.cors.contract.test.ts) | Missing org 403; invalid-token + missing-org prioritizes org denial; **CORS** contracts; `programs route org-scope deny matrix`: POST out-of-scope `client_id`, PATCH out-of-org `program_id`, PATCH out-of-scope `client_id` — **each `it.each(roleMatrix)` for therapist, admin, super_admin**. |
| API | [`src/server/api/programs.ts`](../../src/server/api/programs.ts) | Token → `resolveOrgAndRole` → 403 if no org or no role; GET/POST/PATCH scoped by `organizationId` and `clientExistsInOrg`. |
| API tests | [`src/server/__tests__/programsHandler.test.ts`](../../src/server/__tests__/programsHandler.test.ts) | 401 missing auth; 200 scoped GET; 403 POST client outside org (single case); 403 org unresolved; 403 invalid-token + missing-org; **`it.each(roleMatrix)`** out-of-scope POST, out-of-org PATCH, out-of-scope PATCH `client_id`; 400 bad PATCH UUID. |

**Symmetric coverage:** Edge deny matrix and handler tests align on the same three role labels and three mutation shapes (POST client scope, PATCH program scope, PATCH `client_id` scope).

### P02 / A02 / A06 — Goals

| Layer | Artifact | Role × method coverage (deny / org) |
|-------|----------|-------------------------------------|
| Edge | [`supabase/functions/goals/index.ts`](../../supabase/functions/goals/index.ts) | Same ordering as programs: `requireOrg` → `getUser` → `hasAllowedRole`; `loadProgram` via `orgScopedQuery`. |
| Edge tests | [`tests/edge/goals.parity.contract.test.ts`](../../tests/edge/goals.parity.contract.test.ts) | Missing org GET 403; invalid-token + missing-org (org first); out-of-org PATCH **per role**; out-of-org POST `program_id` **per role**. |
| API | [`src/server/api/goals.ts`](../../src/server/api/goals.ts) | Token → `resolveOrgAndRole`; POST validates program in org + client match; PATCH scoped update with 404 “goal not in org” path when lookup empty; 403 when program out of scope or PATCH returns no row. |
| API tests | [`src/server/__tests__/goalsHandler.test.ts`](../../src/server/__tests__/goalsHandler.test.ts) | 401; 400 bad UUID; 400 program/client mismatch POST; happy POST; **`it.each(roleMatrix)`** out-of-org PATCH for all three roles. |

**Note:** There is **no** [`src/server/__tests__/goalsParity.contract.test.ts`](../../src/server/__tests__/goalsParity.contract.test.ts) in the repo (named in WIN-38J as TBD). API coverage for boundary denials lives in **`goalsHandler.test.ts`** plus edge **`goals.parity.contract.test.ts`**.

### P07 / A09 — Assessment documents

| Layer | Artifact | Role × method coverage (deny / org) |
|-------|----------|-------------------------------------|
| Edge | *None (by design)* | No strict edge twin in WIN-38 planning. |
| API | [`src/server/api/assessment-documents.ts`](../../src/server/api/assessment-documents.ts) | Org/role resolution and scoped Rest calls. |
| API tests | [`src/server/__tests__/assessmentDocumentsHandler.test.ts`](../../src/server/__tests__/assessmentDocumentsHandler.test.ts) | Large suite: **403** out-of-org **POST**, **GET** by `assessment_document_id`, **GET** by `client_id`, **DELETE** — each with **`it.each(roleMatrix)`**; extensive **extraction_failed** audit and lifecycle tests (e.g. non-ok extraction API, thrown workflow). |

---

## 2. Architecture: API path vs edge (parity meaning)

- [`src/server/api/programs.ts`](../../src/server/api/programs.ts) and [`src/server/api/goals.ts`](../../src/server/api/goals.ts) do **not** use `getApiAuthorityMode` or `proxyToEdgeAuthority` (unlike [`dashboard.ts`](../../src/server/api/dashboard.ts) and [`sessions-start.ts`](../../src/server/api/sessions-start.ts)).
- **WIN-38D “parity”** for programs/goals is **behavioral equivalence** between:
  - **Edge:** JWT + `requireOrg` + `auth.getUser` + role RPCs + `orgScopedQuery`.
  - **API:** Bearer token + `resolveOrgAndRole` + PostgREST with explicit `organization_id` filters.
- **Auth ordering differs:** Edge handlers enforce **organization context before `getUser`** (and parity tests assert invalid-token + missing-org → **403** org denial first). API handlers use **token first**, then **`resolveOrgAndRole`** (no `getUser` on the Node path). Matching **status codes** for “bad token + missing org” is not guaranteed by identical code paths; edge contract tests document the edge-specific ordering.

---

## 3. Doc drift (planning artifacts vs repository)

| Source | Claim | Repository evidence | Verdict |
|--------|--------|----------------------|---------|
| WIN-38G / WIN-38C | Programs: “cross-org POST/PATCH deny matrix by role+client scope **incomplete**” | [`programsHandler.test.ts`](../../src/server/__tests__/programsHandler.test.ts) + [`programs.cors.contract.test.ts`](../../tests/edge/programs.cors.contract.test.ts) both use **full role matrices** for POST and PATCH denial cases. | **Outdated** if “complete” means the three roles × three denial shapes; **narrow** gap if “complete” means live DB integration or additional client-scope variants. |
| WIN-38G / WIN-38C | Goals: “out-of-org update deny … **incomplete**”; “`/api/goals` parity … **incomplete**” | [`goalsHandler.test.ts`](../../src/server/__tests__/goalsHandler.test.ts) has out-of-org PATCH for all roles; edge [`goals.parity.contract.test.ts`](../../tests/edge/goals.parity.contract.test.ts) covers org ordering + PATCH + POST program denial. | **Partially outdated:** boundary denials are **strongly** covered; **residual** gaps are optional proxy-style file naming, integration/E2E, or PATCH body variants (changing `program_id`/`client_id` together) per handler logic. |
| WIN-38J | `goalsParity.contract.test.ts` “not yet added” | File absent; behavior covered elsewhere. | **Accurate naming**; **misleading** if read as “no API parity tests exist.” |
| WIN-38I | P01 readiness **blocked** on “define cross-org POST/PATCH deny matrix” | Matrix is **implemented in tests** (see above). | **Stale readiness** — should be reclassified to **partial** or **done** for the matrix definition; **blocked** only if product adds new acceptance rows. |
| WIN-38I | P07 **blocked** on “define cross-org delete/extraction fail-closed assertions” | DELETE + GET + POST out-of-org **403** role-matrix tests; extraction fail-closed audit tests. | **Stale** for “no matrix”; **residual** may be cross-org on **other verbs** or **production-only** RLS paths not exercised by mocks. |

---

## 4. Residual risk register (1–5)

1. **Mock-only boundaries:** Handler tests stub `fetchJson` / `resolveOrgAndRole`; production failures could differ (PostgREST errors, RLS, network). Ledger “protected-path integration” is not fully replaced by unit tests.
2. **Edge vs API ordering:** Invalid-token + missing-org: edge prioritizes org denial; API path may classify differently depending on `resolveOrgAndRole` — **not a bug by default** but **not byte-identical** behavior.
3. **Goals:** API returns **404** for “goal not in organization scope” in some PATCH branches; edge behavior should be cross-checked for the same inputs (manual or one integration test).
4. **Goals GET 400 fallback:** API may return **[]** on some 400 paths for backward compatibility ([`goals.ts`](../../src/server/api/goals.ts)); edge may differ — parity is **not** strict for that branch.
5. **Assessment documents:** Heavy unit coverage; **E2E** coverage of real storage/RLS is still a separate risk from handler mocks.

---

## 5. Verified residual gaps (classification)

| Category | Applies? | Detail |
|----------|----------|--------|
| Integration / E2E vs Vitest mocks | **Yes** | Optional next step: one **integration** or **Playwright** smoke per family using real JWT + org fixtures (repo may already have patterns under `tests/`). |
| Symmetric edge/API scenario | **Partially** | Core deny matrix matches; **ordering** and **error body shapes** may differ (see §2). |
| Missing `goalsParity.contract.test.ts` | **Low** unless `/api/goals` gains **edge proxy mode** | Renaming/consolidating is docs/naming hygiene only today. |
| P07 extraction fail-closed | **Largely addressed in unit tests** | Ledger “extraction fail-closed assertions need strengthening” is **stale** for audit events; re-open only if new extraction paths ship. |

---

## 6. Verification bar (when WIN-38D code or docs change)

Per [WIN-38 critical planning templates](WIN-38-critical-planning-templates.md) (WIN-38D Regression Verification Plan) and [verification-matrix.md](verification-matrix.md):

**Union for server/API + edge (typical WIN-38D PR):**

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci` (or targeted Vitest for touched `*Handler.test.ts` / `tests/edge/*.contract.test.ts`)
- `npm run build`
- `npm run validate:tenant` — **required** when `supabase/functions/**` or tenant-scoped behavior changes; **recommended** for any org-scope API review.

**If** routes, auth, or session flows change: add `npm run test:routes:tier0` and `npm run ci:playwright` per verification matrix **Server, API, And Edge Integration** and **Auth** sections.

**Optional:** `npm run verify:local` when checks are secret-free.

---

## 7. Decision options (follow-up, not executed here)

| Option | When to use |
|--------|-------------|
| **Docs-only refresh** | Update WIN-38C/G/H/I/J rows to reflect §1 and §3; reclassify P01/P07 readiness; clarify `goalsParity.contract.test.ts` as optional or renamed. |
| **Targeted tests** | Add integration smoke only for gaps confirmed in §5 (e.g. edge vs API status for one PATCH). |
| **Close WIN-38D criteria** | Reviewer agreement: e.g. “ledger partial + mocks sufficient” vs “+1 integration test per family.” |

---

## 8. Summary

- **Programs (P01):** Cross-org **POST/PATCH deny matrix by role** is **implemented** in both edge and API test suites; planning docs that still call this “incomplete” or P01 “blocked” are **out of date** for that scope.
- **Goals (P02):** Edge + API denial coverage is **strong**; remaining work is **optional** (naming file, integration, strict parity on edge cases like GET fallback `[]`).
- **Assessment documents (P07):** Out-of-org **POST/GET/DELETE** role matrix and extraction failure audits are **substantially tested**; P07 **blocked** is **overstated** unless the team wants E2E or new product paths.

---

## 9. Planning doc alignment (2026-04-14)

The following artifacts were refreshed to match this analysis and to record **baseline closure** for child workstreams where Vitest evidence exists:

- `docs/ai/WIN-38I-parity-scenario-execution-index.md` — P01 and P07 **blocked** → **partial**; P01/P02/P07/WIN-38D baseline **closed** in repo; **WIN-38E** / **WIN-38F** baselines noted closed; traceability link to this file.
- `docs/ai/WIN-38G-assertion-ledger.md`, `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`, `docs/ai/WIN-38H-parity-test-plan.md` — evidence gap columns updated; follow-on **WIN-38D** marked **optional residual** where baseline is complete.
- `docs/ai/WIN-38J-parity-naming-fixture-dictionary.md` — canonical filenames (`programs.cors…`, `goalsHandler`, `assessmentDocumentsHandler`); **Single next executable child** superseded by baseline-closure note; **P05** closed via `docs/ai/P05-rpc-org-role-equivalence.md` + Vitest contracts; **P06** spec + Vitest in `docs/ai/P06-mcp-edge-contract-spec.md` and `tests/edge/mcp.parity.contract.test.ts` (handler extract `supabase/functions/mcp/mcpHandler.ts`).

**Linear / issue hygiene:** Close or narrow **WIN-38E**, **WIN-38F**, and **WIN-38D** (for P01/P02/P07 scope) when your process allows “baseline parity + docs” completion; **P05** and **P06** baseline parity are **closed** in-repo (**WIN-38** parent can be closed when your process allows or after optional hosted smoke sign-off).
