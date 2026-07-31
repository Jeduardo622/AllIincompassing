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
  - `docs/ai/handoffs/WIN-270-api-convergence-exception-renewal.md`
- Non-goals:
  - no edits to `scripts/ci/check-api-convergence.mjs`
  - no edits to `scripts/ci/check-architecture-pack-freshness.mjs`
  - no edits to `docs/api/endpoint-convergence-status.json`
  - no edits to `docs/api/critical-endpoint-authority.json`
  - no edits to `.github/workflows/ci.yml`
  - no edits to `reports/api-cutover-status.md`
  - no runtime, auth, tenant, CI, or deploy behavior changes

## Audit evidence

- `docs/api/runtime-exceptions.json` contains `9` active exceptions, each retaining its existing `functionFile`, `publicApiPath`, `reason`, and `owner`.
- `docs/api/endpoint-convergence-status.json` lists the same `9` non-retired legacy shim entries, including `/api/assessment-template-layout` with `wave: A`, `status: legacy_shim`, and `owner: Backend Platform`.
- `docs/api/critical-endpoint-authority.json` matches the same active shim inventory; no authority/status/owner drift was introduced in this slice.
- `docs/supabase_branching.md` states that preview databases are ephemeral PR branches, while preview, staging, and production promotion all operate against the same hosted Supabase project `wnnjeqheqxxyrgsjmygy`; there is no distinct staging database.
- `.github/workflows/ci.yml` is cited here as repository topology evidence: it shows Markdown-only runs go through `docs-guard`, and it documents that `main` release topology includes `deploy-session-edge`, separate `ci:deploy:fill-docs-function`, and conditional `deploy-ai-agent-edge` when `ai_agent_changed == 'true'`. Because this branch changes JSON governance registries, it is not eligible for that Markdown-only shortcut. Those jobs are evidence for the architecture pack wording, not a claim that this documentation/governance diff itself traverses the deploy paths.
- `reports/api-cutover-status.md` has no content diff in this slice and was intentionally left untouched.

## Verification

- Required checks:
  - manual parity review of `docs/api/runtime-exceptions.json` against `docs/api/endpoint-convergence-status.json`
  - direct architecture freshness check via `node scripts/ci/check-architecture-pack-freshness.mjs`
  - direct API convergence check via `node scripts/ci/check-api-convergence.mjs`
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
  - `npm run ci:check-focused`: pass; database-backed and CI-only subchecks were skipped locally when their required environment was unavailable
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - code-review-engineer: approve after the preview-runtime, preview-database, and staging-deploy wording was corrected
  - security-engineer: approve; no runtime authority, auth, tenant, secret, or deploy behavior changed
- Blocked checks:
  - `npm run test:ci`: failed in the broad pre-existing suite with AI documentation service failures followed by a Node heap out-of-memory error and `ERR_IPC_CHANNEL_CLOSED`
  - `npm run verify:local`: passed policy, lint, and typecheck, then failed at `test:ci` on the same Node heap out-of-memory condition; coverage, build, and Tier-0 were not reached in the composite run
  - database-backed policy subchecks: skipped locally because `SUPABASE_DB_URL` / `DATABASE_URL` was unavailable
  - branch-protection and required function-auth parity: skipped outside CI or disabled in this local environment
- Verification card:
  - classification: `high-risk human-reviewed`
  - lane: `critical`
  - change type: API convergence + architecture freshness docs
  - required checks: manual parity review, direct architecture freshness, direct API convergence, `ci:check-focused`, lint, typecheck, `test:ci`, build, `verify:local`
  - executed checks: manual parity review, direct architecture freshness, direct API convergence, `ci:check-focused`, lint, typecheck, and build passed; code and security review approved
  - blocked checks: `test:ci` and `verify:local` failed on broad-suite AI service / Node heap exhaustion outside the docs-only diff; environment-dependent policy subchecks were skipped locally
  - result: `pass-with-blocked-checks`
  - residual risk: low implementation risk; remaining risk is documentation freshness drift if preview-runtime versus preview-database semantics change again, plus the unresolved broad-suite failures that require CI or a dedicated test-stability slice.

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
- generated artifact drift: none; the API cutover report was restored and is not part of this diff
- protected-path drift: none beyond the explicitly routed policy inputs
- change summary: present
- verification summary: present, including failures and local environment skips
- reviewer: completed and approved
- security review: completed and approved
- required follow-up: push the branch, open the PR, wait boundedly for live checks, obtain human approval, merge, then rebase and publish the separate WIN-265 onboarding CORS fix
