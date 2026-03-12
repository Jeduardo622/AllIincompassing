# Phase 0 Execution Status (2026-03-12)

## Scope Executed
- Enforced strict CORS handling for `book` and `dashboard` API handlers using shared allowlist helpers.
- Tightened dashboard authorization from `admin | therapist | super_admin` to `admin | super_admin`.
- Added baseline API rate limiting for high-sensitivity routes (`book`, `dashboard`) with `Retry-After` responses.
- Hardened Supabase MCP edge function authentication to JWT-validated requests and removed static token auth path.
- Enabled JWT verification at function config level for MCP edge function.
- Executed targeted tests, lint, typecheck, focused CI policy checks, and preview smoke checks.

## Code Changes
- `src/server/api/book.ts`
  - Replaced wildcard CORS behavior with `isDisallowedOriginRequest` + `corsHeadersForRequest`.
  - Added in-memory baseline rate limiting (`30 req/min` per subject/IP).
  - Switched success responses to `jsonForRequest`.
- `src/server/api/dashboard.ts`
  - Replaced wildcard CORS behavior with request-scoped shared CORS helpers.
  - Removed therapist-only authorization path.
  - Added in-memory baseline rate limiting (`120 req/min` per subject/IP).
  - Standardized response emission via `jsonForRequest`.
- `src/server/api/shared.ts`
  - Added shared `consumeRateLimit` utility + test reset helper.
- `supabase/functions/mcp/function.toml`
  - Set `verify_jwt = true`.
- `supabase/functions/mcp/index.ts`
  - Removed `MCP_TOKEN` and `x-mcp-token` static token authentication.
  - Added bearer JWT extraction + user validation (`supabase.auth.getUser`).
  - Added allowlist-based CORS (`MCP_ALLOWED_ORIGINS` + static safe defaults).
  - Added explicit disallowed-origin rejection.
- `src/server/__tests__/bookHandler.test.ts`
  - Updated OPTIONS CORS assertion to allowed origin.
  - Added disallowed-origin rejection test.
- `src/server/__tests__/dashboardHandler.test.ts`
  - Added OPTIONS CORS assertion.
  - Added disallowed-origin rejection test.
  - Updated request-count expectations after therapist role check removal.

## Validation Evidence
- `npm run test -- src/server/__tests__/bookHandler.test.ts src/server/__tests__/dashboardHandler.test.ts`
  - Pass: 2 files, 18 tests.
- `npm run typecheck`
  - Pass.
- `npm run lint -- src/server/api/book.ts src/server/api/dashboard.ts src/server/__tests__/bookHandler.test.ts src/server/__tests__/dashboardHandler.test.ts`
  - Pass.
- `npm run ci:check-focused`
  - Pass.
  - Note: DB parity checks requiring `SUPABASE_DB_URL`/`SUPABASE_URL` were skipped by existing script logic.
- `npm run preview:build && npm run preview:smoke`
  - Pass.
- `npm run playwright:auth`
  - Pass.
- `npm run playwright:therapist-authorization`
  - Pass after fixing env IDs and login selector robustness in script.
- `node -r dotenv/config scripts/check-database-security.js` (`DOTENV_CONFIG_PATH=.env.codex`)
  - Pass execution; report generated under `.reports/`.
- `node -r dotenv/config scripts/check-database-performance.js local` (`DOTENV_CONFIG_PATH=.env.codex`)
  - Pass execution; report generated under `.reports/`.
- `node -r dotenv/config scripts/generate-health-report.js local` (`DOTENV_CONFIG_PATH=.env.codex`)
  - Pass execution; consolidated report generated under `.reports/`.

## MCP and External Baseline Evidence
- GitHub MCP (`get_me`): authenticated operator context confirmed.
- Supabase MCP (`list_projects`): project `wnnjeqheqxxyrgsjmygy` confirmed active.
- Supabase MCP (`get_advisors`):
  - Security advisors: no active lints returned.
  - Performance advisors: findings returned (unused index backlog still present).

## Remaining Phase 0 Gaps
- Tighten DB health npm script wrappers so they load `.env.codex` automatically (currently requires `node -r dotenv/config` invocation).
- Add automated tests for hardened `supabase/functions/mcp/index.ts` auth/CORS behavior.
- Apply equivalent CORS/rate-limit hardening review to remaining sensitive edge endpoints outside this change set.

## Release Gate Status
- Security hardening implementation: **In progress (core API + MCP endpoint complete)**.
- Focused CI policy gate: **Pass**.
- Preview smoke gate: **Pass**.
- Critical E2E gate: **Pass** (`playwright:auth`, `playwright:therapist-authorization`).
