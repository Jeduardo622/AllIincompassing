# Short-Term Remediation Closure (1-4 Weeks)

Date: 2026-03-09

## Dependency Removal Ledger

Removed as unused in this remediation window:
- `@headlessui/react`
- `@supabase/auth-ui-react`
- `@supabase/auth-ui-shared`
- `node-fetch`

Restored after usage verification:
- `chart.js` (used by monitoring chart UI)
- `react-chartjs-2` (used by monitoring chart UI)

Deferred major-upgrade items (separate branch plan already prepared):
- `supabase` CLI major-line migration validation
  - owner: Platform Engineering
  - target date: 2026-03-23
- `isomorphic-dompurify` major-line migration validation
  - owner: Frontend Engineering
  - target date: 2026-03-23

Current security snapshot:
- `npm audit --json`: `0` vulnerabilities.

## CORS Hardening Matrix

Policy baseline:
- CORS origin now resolves via `CORS_ALLOWED_ORIGINS` with environment fallback.
- Wildcard origin is removed from protected edge functions in scope.

Protected functions hardened in this pass:
- `agent-trace-report`
- `ai-agent-optimized`
- `ai-session-note-generator`
- `ai-transcription`
- `extract-assessment-fields`
- `generate-program-goals`
- `get-therapist-details`
- `process-message`
- `sessions-cancel`
- `sessions-confirm`
- `sessions-hold`
- `suggest-alternative-times`
- `transcription-retention`

Shared CORS utilities:
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/feature-flags-v2/_shared/cors.ts`

Regression coverage:
- `tests/edge/cors-policy.test.ts` prevents wildcard-origin regression for protected functions.

## Export Normalization Tracker (`src/**`)

Rule enforcement:
- ESLint now rejects `ExportDefaultDeclaration` under `src/**`.

Status:
- Remaining default exports in lint scope: `0`.
- Non-source backup exception excluded from lint via ignore pattern:
  - `src/App.tsx.backup`

## Ready for Medium-Term

Short-term exit criteria now aligned with CI gates:
- Named exports enforced in application source.
- Protected edge CORS no longer wildcard.
- Dependency set reduced and re-verified.
- Coverage baseline and CI verification remain green in the immediate remediation baseline.
