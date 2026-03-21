# AGENTS.md

## Mission

This repository is an AI-assisted engineering lab for a React/Vite app with Supabase, Netlify, and policy-heavy CI. Optimize for small, reviewable changes that preserve auth, tenant isolation, and deployment safety.

## Working Style

- Inspect the relevant architecture before changing code.
- Prefer existing patterns over new abstractions.
- Keep diffs small and easy to review.
- Do not bypass tests, lint, typecheck, or policy checks.
- For non-trivial changes, summarize risk and verification before closing the task.

## Commands

- Install: `npm ci`
- Dev: `npm run dev`
- Test: `npm run test:ci`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

Useful extras:

- Fast unit run: `npm test`
- Tier-0 browser gate: `npm run test:routes:tier0`
- Auth/session browser gate: `npm run ci:playwright`
- Policy checks: `npm run ci:check-focused`
- Coverage verification: `npm run ci:verify-coverage`
- Tenant isolation: `npm run validate:tenant`

## High-Risk Paths

Human review is required before merge for changes in:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also treat anything affecting billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, or secrets as high risk.

## Data And Secrets Rules

- Never modify secrets, deployment credentials, billing settings, or provider keys.
- Never read from or edit real `.env*` files unless explicitly asked.
- Do not copy real customer data, PHI, or operational artifacts into tests, docs, or commits.
- Prefer redacted or synthetic fixtures only.

See:

- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`

## Verification

Use the minimum verification required for the change type. See `docs/ai/verification-matrix.md`.

At minimum:

- UI-only changes: lint, typecheck, targeted tests, build
- Auth/routing/runtime-config changes: policy checks, lint, typecheck, test:ci, tier-0 browser gate, build
- Database or tenant-isolation changes: policy checks, test:ci, tenant validation, build

## Subagent Use

For non-trivial tasks:

- Use `tester` for targeted test selection, reproduction, and verification.
- Use `reviewer` for auth, security, CI-policy, and high-risk diff review.

Subagent findings must reference specific files, diffs, or commands when possible.

## Definition Of Done

A task is done only when:

1. Code is implemented.
2. Required verification has passed, or any unrun checks are explicitly called out.
3. Docs/comments are updated when behavior or process changes.
4. The result is ready for human PR review.
5. High-risk changes include a short risk summary.
