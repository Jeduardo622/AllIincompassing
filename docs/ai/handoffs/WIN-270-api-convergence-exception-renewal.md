# WIN-270 API convergence exception renewal

## Route

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering rationale: runtime API convergence exception governance for active legacy compatibility shims requires human-reviewed critical-lane handling even though this slice is limited to docs artifacts.
- Stop conditions:
  - any required edit outside the approved docs files
  - any need to change `scripts/ci/**`, `.github/workflows/**`, runtime/config code, allowlist/status/authority JSON, or exception owner/reason/status data
  - any evidence that an exception should be removed rather than renewed

## Scope

- Issue: `WIN-270`
- Owned files only:
  - `docs/api/runtime-exceptions.json`
  - `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md`
  - `docs/architecture/pack-metadata.json`
  - `docs/architecture/NEW_ENGINEER_PACK.md`
  - `reports/api-cutover-status.md`
  - `docs/ai/handoffs/WIN-270-api-convergence-exception-renewal.md`
- Non-goals:
  - no edits to `scripts/ci/check-api-convergence.mjs`
  - no edits to `scripts/ci/check-architecture-pack-freshness.mjs`
  - no edits to `docs/api/endpoint-convergence-status.json`
  - no edits to `docs/api/critical-endpoint-authority.json`
  - no edits to `.github/workflows/ci.yml`
  - no runtime, auth, tenant, CI, or deploy behavior changes

## Audit evidence

- `docs/api/runtime-exceptions.json` contains `9` active exceptions, each retaining its existing `functionFile`, `publicApiPath`, `reason`, and `owner`.
- `docs/api/endpoint-convergence-status.json` lists the same `9` non-retired legacy shim entries, including `/api/assessment-template-layout` with `wave: A`, `status: legacy_shim`, and `owner: Backend Platform`.
- `docs/api/critical-endpoint-authority.json` matches the same active shim inventory; no authority/status/owner drift was introduced in this slice.
- `docs/supabase_branching.md` states that preview databases are ephemeral PR branches, while preview, staging, and production promotion all operate against the same hosted Supabase project `wnnjeqheqxxyrgsjmygy`; there is no distinct staging database.
- `.github/workflows/ci.yml` is cited here as repository topology evidence: it shows Markdown-only runs go through `docs-guard`, and it documents that `main` release topology includes `deploy-session-edge`, separate `ci:deploy:fill-docs-function`, and conditional `deploy-ai-agent-edge` when `ai_agent_changed == 'true'`. Because this branch changes JSON governance registries, it is not eligible for that Markdown-only shortcut. Those jobs are evidence for the architecture pack wording, not a claim that this documentation/governance diff itself traverses the deploy paths.
- `npm run ci:report:api-cutover` regenerated `reports/api-cutover-status.md` from the current Netlify function, redirect, and application-callsite surface. It now includes all `9` governed active shims and reports the broader 14-function inventory as `1` retire-ready and `13` still migrating.
- The retire-ready background extractor is not one of the `9` governed exceptions; retiring that function requires a separate runtime slice and is not bundled into this registry renewal.

## Verification

- Required checks:
  - manual parity review of `docs/api/runtime-exceptions.json` against `docs/api/endpoint-convergence-status.json`
  - direct architecture freshness check via `node scripts/ci/check-architecture-pack-freshness.mjs`
  - direct API convergence check via `node scripts/ci/check-api-convergence.mjs`
  - generated cutover evidence refresh via `npm run ci:report:api-cutover`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - manual parity review (pass: all `9` active exceptions preserved; matrix row added for `/api/assessment-template-layout`; all exception expiry cells updated to `2026-09-01T23:59:59.999Z`)
  - direct architecture pack review (pass: deployment diagram/prose now distinguishes Netlify deploy previews from Supabase preview branch databases, matches `docs/ENVIRONMENT_MATRIX.md` + `docs/supabase_branching.md`, and preserves the `main` deploy fan-out evidenced by `.github/workflows/ci.yml`; `lastReviewedAt` updated to `2026-07-31`)
  - `node scripts/ci/check-architecture-pack-freshness.mjs`: pass
  - `node scripts/ci/check-api-convergence.mjs`: pass
  - `npm run ci:report:api-cutover`: pass; regenerated the 14-function evidence report and included all `9` governed active shims
  - `npm run ci:check-focused`: pass; database-backed and CI-only subchecks were skipped locally when their required environment was unavailable
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci` with `NODE_OPTIONS=--max-old-space-size=6144`: pass (`437` files and `3621` tests passed; `2` files and `5` tests skipped)
  - `npm run build`: pass
  - `npm run verify:local` with `NODE_OPTIONS=--max-old-space-size=6144`: pass, including policy, lint, typecheck, `test:ci`, coverage, build, and Tier-0 routes (`220` tests passed)
  - code-review-engineer and security-engineer initially requested the current cutover evidence refresh; that generated artifact is now included and their stated governance-evidence blocker is addressed
- Blocked checks:
  - database-backed policy subchecks: skipped locally because `SUPABASE_DB_URL` / `DATABASE_URL` was unavailable
  - branch-protection and required function-auth parity: skipped outside CI or disabled in this local environment
- Verification card:
  - classification: `high-risk human-reviewed`
  - lane: `critical`
  - change type: API convergence + architecture freshness docs
  - required checks: manual parity review, direct architecture freshness, direct API convergence, generated cutover report, `ci:check-focused`, lint, typecheck, `test:ci`, build, `verify:local`
  - executed checks: manual parity review, direct architecture freshness, direct API convergence, generated cutover report, `ci:check-focused`, lint, typecheck, `test:ci`, build, and `verify:local` passed
  - blocked checks: environment-dependent policy subchecks were skipped locally
  - result: `pass-with-environment-skips`
  - residual risk: low implementation risk; remaining risk is documentation freshness drift if preview-runtime versus preview-database semantics change again, plus the separate runtime work required before the generated report's background extractor can actually be retired.

## Human review

- Human review remains mandatory because the slice is explicitly routed `critical` / `high-risk human-reviewed`.
- Reviewer focus:
  - confirm the renewed UTC cutoff `2026-09-01T23:59:59.999Z`
  - confirm `/api/assessment-template-layout` remains an approved active shim exception
  - confirm the deployment map distinguishes Netlify deploy previews from Supabase preview branch databases and no longer implies a separate staging database
  - confirm the `main` deploy fan-out wording matches current CI jobs
  - confirm no owner, reason, status, allowlist, or authority inventory drift

## PR hygiene

- pr-ready: yes, for human review; not merge-ready until live required checks and human review complete
- lane: `critical`
- branch-ready: yes, `codex/win-270-api-exception-renewal`
- linear-ready: yes, `WIN-270`
- single-purpose: yes, refresh the two expired governance artifacts that blocked the same mandatory policy chain
- unrelated changes: none
- generated artifact drift: resolved; the current API cutover report is included in this diff
- protected-path drift: none beyond the explicitly routed policy inputs
- change summary: present
- verification summary: present, including failures and local environment skips
- reviewer: completed; the requested cutover evidence refresh is now addressed and needs final confirmation
- security review: completed; the requested cutover evidence refresh is now addressed and needs final confirmation
- required follow-up: commit and push the cutover evidence refresh to PR #879, wait boundedly for live checks, obtain human approval, merge, then rebase and publish the separate WIN-269 IPC fix
