# WIN-253 Fill Docs production handoff

## Routing

- Classification: high-risk, human-reviewed
- Lane: critical
- Triggering surfaces: `supabase/functions/fill-docs/**` and `supabase/config.toml`
- Linear: WIN-253

## Scope

Restore the production Mid Tier Fill Docs workflow with the smallest contained
Edge Function change:

- bundle the three tracked DOCX templates;
- correct the FBA and PR template filenames;
- generate the document in memory;
- return the existing base64 response variant;
- remove storage uploads, signed URLs, and `therapist_documents` manifest writes.

Non-goals include role-policy changes, shared auth refactors, migrations, RLS or
storage-policy changes, and deploy-workflow expansion.

## Verification

- Focused Deno test RED: missing handler/template exports before implementation.
- Focused Deno test GREEN:
  `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/fill-docs/index.test.ts`
  (`4 passed`, `0 failed`).
- `npm run ci:check-focused`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run validate:tenant`: passed; no schema or RLS change was made.
- `npm run build`: passed.
- `npm run test:ci`: failed on existing unrelated regressions in
  `tests/workflows/bt-aba-disposable-browser-proof.test.ts` and
  `src/lib/__tests__/supabase.edge.test.ts` (`blob.text is not a function`).
- Production proof remains required after human review, merge, and a dedicated
  `fill-docs` Edge Function deployment.

### Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: server/API/Edge integration and protected Supabase function
- Required checks: `npm run ci:check-focused`, `npm run lint`,
  `npm run typecheck`, focused Deno tests, `npm run test:ci`,
  `npm run build`, `npm run validate:tenant`,
  `npm run test:routes:tier0`, `npm run ci:playwright`,
  and `npm run verify:local`
- Executed checks:
  - focused Deno tests: passed (`4 passed`, `0 failed`)
  - `npm run ci:check-focused`: passed
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run validate:tenant`: passed
  - `npm run test:routes:tier0`: passed (`220 passed`, `0 failed`)
  - `npm run test:ci`: failed on the unrelated baseline failures listed above
  - `npm run ci:playwright`: blocked at preflight because local privileged
    Playwright credentials are not configured
- Blocked checks:
  - `npm run ci:playwright`: missing `PW_SUPERADMIN_*` or `PW_ADMIN_*`
    credentials in the local process
  - `npm run verify:local`: cannot complete while the same credential gate and
    baseline `test:ci` failures remain
- Result: pass-with-blocked-checks
- Residual risk: production remains on the stale function until human merge
  and a dedicated deploy; live ER/FBA/PR proof is mandatory afterward.

## Required agents

Completed: specification engineer, software architect, implementation
engineer, code review engineer, test engineer, security engineer, and Supabase
reviewer.

## Deployment and live proof

After merge:

1. Deploy only the production `fill-docs` Edge Function with all three bundled
   DOCX assets.
2. Prove `OPTIONS` returns promptly with the expected CORS response.
3. Generate synthetic ER, FBA, and PR documents as Mid Tier and verify valid
   DOCX downloads.
4. Confirm no storage object or `therapist_documents` row is created.

## Production v15 follow-up

PR #862 was merged and deployed as hosted `fill-docs` version 15 with all
three static DOCX assets, but live browser-origin `OPTIONS` requests still
timed out. Control Edge Functions answered preflight normally, and
unauthenticated `fill-docs` requests were rejected promptly at the gateway,
isolating the defect to the `fill-docs` runtime entrypoint.

The deployed module exported the protected route without registering it with
`Deno.serve`. The bounded follow-up on
`codex/win-253-fill-docs-entrypoint` adds only that served entrypoint and its
focused regression:

- RED with the module-level serve call removed: `4 passed`, `1 failed`
  because the main-module process never served the expected `204` preflight.
- GREEN:
  `$denoExe = (Get-Command deno).Source; & $denoExe test --no-lock --no-check --allow-env --allow-net --allow-read "--allow-run=$denoExe" supabase/functions/fill-docs/index.test.ts`
  (`5 passed`, `0 failed`).
- The child process clears inherited environment variables and receives only
  synthetic Supabase values plus the non-secret Windows runtime roots required
  to initialize networking.
- `deno fmt --check` for the function and focused test: passed.
- `npm run ci:check-focused`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run validate:tenant`: passed.
- `npm run build`: passed.
- `npm run test:routes:tier0`: passed (`220 passed`, `0 failed`).
- `npm run test:ci`: blocked by unrelated baseline failures also reproduced
  in the clean PR #862 worktree, including the BCBA migration line-ending
  assertion, async PDF Blob mock, BT/ABA workflow drift, and synthetic BCBA
  workflow-contract drift.
- `npm run ci:playwright`: blocked by missing local privileged Playwright
  credentials.
- `deno check`: blocked by the existing `TS2589` deep type-instantiation
  error in `supabase/functions/_shared/org.ts`.

Independent re-review, human merge, a dedicated version 16 deployment, and
live Computer proof remain required.

### Follow-up verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: Supabase Edge Function runtime entrypoint
- Required checks: focused Deno entrypoint/preflight test,
  `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`,
  `npm run test:ci`, `npm run validate:tenant`, `npm run build`,
  `npm run test:routes:tier0`, `npm run ci:playwright`, and
  `npm run verify:local`
- Executed checks:
  - focused Deno entrypoint/preflight test: passed (`5 passed`, `0 failed`)
  - `deno fmt --check`: passed
  - `npm run ci:check-focused`: passed
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run validate:tenant`: passed
  - `npm run build`: passed
  - `npm run test:routes:tier0`: passed (`220 passed`, `0 failed`)
  - `npm run test:ci`: failed only on clean-baseline regressions outside this
    diff; the affected files were reproduced in the clean PR #862 worktree
- Blocked checks:
  - `npm run ci:playwright`: local privileged credentials are unavailable
  - `npm run verify:local`: cannot complete while the same baseline
    `test:ci` failures and Playwright credential gate remain
  - `deno check`: existing shared `org.ts` `TS2589` error
- Result: pass-with-blocked-checks
- Review: implementation engineer, code review engineer, security engineer,
  and Supabase reviewer approved the bounded follow-up
- Residual risk: production behavior is unproven until CI passes, the exact
  merged function is deployed, and live preflight plus authenticated Mid Tier
  document generation succeed

## Residual risk

The largest template produces roughly a 1 MB base64 JSON response. This is
acceptable for the current low-volume authenticated workflow but should not be
generalized to large or public document generation. The broader CI/deployment
gap that allowed the production function bundle to drift is a separate slice.
