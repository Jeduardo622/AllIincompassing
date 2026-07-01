# WIN-192 CalOptima Inline Extraction Parity Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the slice changes a protected Supabase edge function used by the CalOptima upload route and affects persisted extraction values
- triggering paths:
  - `supabase/functions/**`

## Scope

- task intent: repair hosted CalOptima upload extraction drift where adjacent inline labels collapse into the wrong scalar fields, then re-prove deployed extraction parity
- files touched:
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
- non-goals:
  - no route/UI behavior changes
  - no schema, RLS, grant, or migration changes
  - no broader CalOptima mapping refactor
- single-purpose diff: yes

## Tenant Boundary

- read/write boundary: extraction remains scoped to the existing uploaded assessment document for the current tenant/client context
- guarantee preserved: this slice changes scalar parsing only; it does not widen org access, bypass auth, or introduce cross-tenant reads/writes
- high-risk surface: `supabase/functions/extract-assessment-fields/index.ts`

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - none
- reviewer: blocked

## Verification Card

- change type:
  - `server/API/edge integration`
  - `database/RLS/migrations/tenant isolation`
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "adjacent CalOptima inline labels aligned to source values"`
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass via `npm run verify:local`
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "adjacent CalOptima inline labels aligned to source values"`: pass after reproducing the failure pre-fix
  - `deno test --node-modules-dir=auto --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`: pass
- blocked checks:
  - hosted production re-verification on fixed code -> blocked until PR merge and deploy
- result: pass-with-blocked-checks
- residual risk: local verification is clean, but current production still runs the pre-fix extractor until this branch is merged and deployed

## Hosted Evidence

- current hosted route status: operational
- current hosted parity status before this fix: failed for retained CalOptima docs because several scalar fields were misaligned with uploaded source text
- mismatched hosted examples observed during audit:
  - `CALOPTIMA_FBA_CONTACT_PHONE = "Emma Jean Burgess"`
  - `CALOPTIMA_FBA_SERVICE_INITIATION_DATE = "D ate services started with your agency"`
  - `CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN = "D ate when ABA services started for this member"`
  - `CALOPTIMA_FBA_IEP_DATE = "Did the ABA provider participate in the IEP/equivalent meeting(s)?"`
  - `CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES = "(Full Name & credential)"`
  - `CALOPTIMA_FBA_DIAGNOSES_ICD = "(including physical, mental health and medical diagnoses)"`

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-192`)
- unrelated changes:
  - `src/pages/__tests__/Schedule.event.test.tsx`
  - `docs/ai/2026-06-30-staff-messaging-policy-advisor-drift-handoff.md`
  - `supabase/migrations/20260630235958_repair_live_staff_messaging_policy_advisor_drift.sql`
  - `tests/integration/staff-messaging-policy-advisor-drift.test.ts`
- generated artifact drift: none in the intended diff
- protected-path drift:
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
- change summary: present
- verification summary: present
- pr-ready: no
- pr handoff: missing push/PR/live-check evidence
- required follow-up:
  - stage only the extractor files plus this handoff
  - push the branch and open a PR linked to `WIN-192`
  - obtain protected-path human review
  - merge/deploy, then rerun hosted CalOptima upload proof and row-level extraction audit

## Handoff Summary

This slice fixes a real hosted CalOptima extraction regression in the protected `extract-assessment-fields` edge function. The new coverage reproduces adjacent inline-label drift and the implementation adds narrow CalOptima-specific scalar parsing so guardian/phone, PCP, medications, service dates, IEP date, and diagnosis fields stay aligned to the uploaded source text. Local critical-lane verification passed, but production proof is still pending merge and deploy because the hosted site currently runs the old extractor.
