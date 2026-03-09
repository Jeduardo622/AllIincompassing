# Major Upgrade Branch Plan: supabase CLI + isomorphic-dompurify

## Scope
- Package A: `supabase` (devDependency) from `^1.99.10` to `^2.77.0` (major).
- Package B: `isomorphic-dompurify` (dependency) from `^0.13.0` to `^3.x` (major).

## Why this is isolated
- Current `npm audit --json` reports high vulnerabilities on `supabase` via `tar`, and moderate vulnerabilities on `isomorphic-dompurify` via `dompurify`.
- Both upgrades are semver-major and must be landed in isolated hardening branches.

## Branching strategy
1. `codex/remediate-supabase-cli-v2`
2. `codex/remediate-isomorphic-dompurify-v3`
3. `codex/remediate-merge-major-security` (optional integration branch after both pass independently)

## Track A: supabase CLI v2 (safe rollout)

### A1. Branch prep
- Create branch `codex/remediate-supabase-cli-v2`.
- Update `devDependencies.supabase` to `^2.77.0`.
- Regenerate lockfile.

### A2. CLI command compatibility audit
Validate every repo command that shells out to Supabase CLI:
- `scripts/check-database-security.js`
- `scripts/check-database-performance.js`
- `scripts/production-health-check.js`
- `scripts/verify-auth-system.js`
- CI workflows using `supabase db lint`, `db reset`, `gen types`.

### A3. Execute non-destructive smoke set
- `npx supabase --version`
- `npx supabase db lint --linked`
- `npx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public`
- `npm run db:check:security`
- `npm run db:check:performance`

### A4. Failure containment rules
- If any command syntax changed, patch only wrappers/scripts, not business logic.
- Do not change migration SQL in this branch unless CLI parsing requires it.

### A5. Acceptance criteria
- All Supabase CLI-backed npm scripts pass.
- CI workflow commands remain compatible.
- `npm audit --json` no longer reports high issues via `supabase -> tar`.

## Track B: isomorphic-dompurify v3 (safe rollout)

### B1. Branch prep
- Create branch `codex/remediate-isomorphic-dompurify-v3`.
- Upgrade `isomorphic-dompurify` to latest `3.x`.

### B2. App usage blast-radius
Primary usage currently in:
- `src/lib/validation.ts`

Secondary validation points:
- any code paths that sanitize user text before DB writes/UI rendering.

### B3. Contract test additions (targeted)
Add/expand tests in:
- `src/lib/__tests__/validation.test.ts` (create if absent)

Required assertions:
- strips HTML tags (`<script>`, event handlers, inline SVG script vectors)
- preserves safe plain text
- handles empty/whitespace input deterministically
- same output shape as pre-upgrade for existing validated payloads

### B4. Runtime regression checks
- `npm run test:ci`
- targeted forms/components that consume sanitized values
- verify no SSR/runtime import break from DOMPurify wrapper changes

### B5. Acceptance criteria
- Sanitization behavior is stable or stricter (never weaker).
- No XSS-related regressions in validation tests.
- `npm audit --json` no longer reports `dompurify` advisory path via `isomorphic-dompurify`.

## Integration branch (optional)
Use `codex/remediate-merge-major-security` only after A and B are green individually.

Checks:
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run ci:verify-coverage`
- `npm audit --json`

## Rollback plan
- Revert each upgrade branch independently if regressions appear.
- Keep lockfile-only rollback commits scoped per package to reduce blast radius.
- Do not bundle both major upgrades in one revert.

## Evidence to attach per PR
- pre/post `npm audit --json` vulnerability counts
- command logs for Supabase CLI smoke set
- validation test diff + before/after sanitizer outputs

