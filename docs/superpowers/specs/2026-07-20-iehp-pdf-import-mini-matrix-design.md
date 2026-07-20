# IEHP PDF Import Mini-Matrix Design

## Goal

Add an explicit on-demand browser smoke that proves the existing IEHP FBA upload path can consume a small set of deterministic synthetic PDFs while preserving the field-level assessor-phone contract established by WIN-226.

CalOptima FBA behavior is a separate payer contract and is not changed or certified by this slice.

## Scope

The mini-matrix contains three runtime-generated PDF cases:

1. a clean single-page digital PDF
2. a multi-page PDF whose asserted IEHP content appears on page two
3. a PDF whose document-local assessor phone uses a different accepted US phone format

Each case contains only synthetic labels and values. The document phone must differ from the provisioned primary-therapist snapshot phone.

The matrix extends the existing IEHP Playwright smoke rather than introducing a second upload framework. A dedicated package command opts into matrix mode; the existing single-DOCX command and its assertions remain unchanged.

## Runtime fixture generation

Use the already-installed Playwright Chromium runtime to render small HTML documents to PDF in a temporary directory. Do not add a PDF package or commit binary fixture files. Case definitions are declarative and include:

- a stable case identifier
- the synthetic HTML/page layout
- a unique expected `IEHP_FBA_REFERRAL_DATE`
- the document-local phone representation

Temporary generated PDFs are deleted after the run. Uploaded application documents and storage objects remain subject to the existing authenticated cleanup path.

## Per-case proof

After each upload reaches `extracted`, the smoke queries the uploaded document checklist through the existing authenticated application/API path and asserts:

- the current extracted-status proof still passes
- zero draft programs and zero draft goals still pass
- exactly one `IEHP_FBA_ASSESSOR_PHONE` row exists
- its value is non-empty and matches the existing accepted phone format
- it equals the provisioned primary-therapist snapshot phone, not the different document-local phone
- its provenance is exactly `client_snapshot.primary_therapist_phone`
- exactly one `IEHP_FBA_REFERRAL_DATE` row exists
- its value equals the case-specific synthetic referral date
- its provenance is document-derived rather than `client_snapshot`

Missing, duplicated, empty, malformed, wrong-precedence, wrong-referral-date, or wrong-provenance rows fail with case-specific messages.

## Evidence and cleanup

Emit one redacted JSON result per case plus an aggregate JSON result. Evidence includes case ID, upload type, extracted status, draft counts, phone format/precedence/provenance booleans, referral-date value/provenance booleans, and cleanup outcome. It must not include raw phone values, credentials, client IDs, document IDs, storage paths, or PHI.

Each case owns a `try`/`finally` cleanup boundary. Assertion failure cannot skip cleanup. Cleanup failure is fail-closed, uses the existing redacted failure-manifest behavior, and prevents the overall matrix from reporting success. Cases run sequentially to keep upload and cleanup ownership unambiguous.

## Files and boundaries

Expected implementation surfaces:

- `scripts/playwright-iehp-assessment-import-smoke.ts`
- `scripts/lib/iehp-assessment-import-smoke.ts`
- `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
- `tests/scripts/iehp-assessment-import-smoke.test.ts`
- `package.json`
- one concise handoff under `docs/ai/`

The design and implementation plan live under `docs/superpowers/` as required process artifacts.

## Non-goals

- no CalOptima FBA matrix changes
- no parser changes or new extraction fields
- no scanned, OCR, low-quality, or true page-rotation variants yet
- no CI workflow changes or automatic matrix gating
- no server/API, Edge Function, migration, schema, secret, credential, or production-data changes
- no broad Playwright smoke-framework refactor

## Stop conditions

Stop, re-route to `critical`, and report before implementation continues if passing the matrix requires changes under `.github/workflows/**`, `scripts/ci/**`, `src/server/**`, `supabase/functions/**`, `supabase/migrations/**`, runtime configuration, secrets, tenant-sensitive behavior, or production data.

## Verification

Follow test-first development: focused helper/contract test must fail for missing matrix behavior before implementation, then pass after the minimum change. Run the focused script tests, the on-demand hosted matrix when credentials are already available to the process, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, and `npm run build`. Finish with `verify-change`, `pr-hygiene`, code review, and test review.
