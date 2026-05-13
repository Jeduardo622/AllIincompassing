# CalOptima PDF Generation Runbook

This runbook describes how to generate and troubleshoot the **completed CalOptima treatment plan PDF** from the staged assessment workflow.

## Scope

- Template: `CalOptima Health FBA Template (2).pdf`
- Flow entry point: `Client Details -> Programs & Goals`
- API endpoint: `POST /api/assessment-plan-pdf`
- Netlify function route: `/.netlify/functions/assessment-plan-pdf`
- Edge function: `supabase/functions/generate-assessment-plan-pdf/index.ts`

## Preconditions

Before generation can succeed:

- An assessment document exists for the client in `assessment_documents`.
- Required checklist rows in `assessment_checklist_items` are `approved`.
- At least one draft program and one draft goal are in `accepted` or `edited` state.
- The CalOptima render map exists and is valid:
  - `docs/fill_docs/caloptima_fba_pdf_render_map.json`
- Every exported render map fallback has bounded overlay metadata: `height`, `line_height`, `max_lines`, and `field_kind`.

If any precondition fails, API returns `409` with details.

## Standard operator flow

1. Open the client in **Programs & Goals**.
2. Select the target assessment in the assessment queue.
3. Confirm checklist required fields are approved.
4. Confirm draft program/goals are accepted or edited.
5. Click **Generate Completed CalOptima PDF**.
6. Verify the signed URL opens/downloads.
7. If the app reports layout warnings, review the PDF before sending and recalibrate the affected render-map keys.
8. Run the visual smoke check before marking the second-stage workflow client-ready.

## API behavior summary

`POST /api/assessment-plan-pdf`:

- Validates user auth and org scope.
- Loads assessment + checklist + drafts + client/provider context.
- Builds payload from checklist values plus derived fallbacks.
- Calls the Edge function for PDF generation.
- Writes `assessment_review_events` action `plan_pdf_generated`.
- Returns:
  - `fill_mode` (`acroform`, `overlay`, or `mixed`)
  - `bucket_id`
  - `object_path`
  - `signed_url`
  - `layout_warnings`
  - `overflow_keys`

## Fill-mode behavior

- `acroform` mode:
  - Used when matching PDF form fields are found from render map candidates.
- `overlay` mode:
  - Automatic fallback when no matching form fields are available.
  - Draws text inside configured page/x/y/font/box metadata.
  - Stops rendering before text crosses the configured box and returns layout warnings for any overflow.
- `mixed` mode:
  - Used when some fields are filled through AcroForm and remaining fields are rendered through bounded overlay.

## Common failures and fixes

- `409 Required checklist items must be approved`
  - Approve all required checklist rows first.
- `409 Accepted draft program and goals are required`
  - Accept/edit at least one draft program and one draft goal.
- `409 Missing required values for final CalOptima PDF generation`
  - Populate missing checklist values listed in `missing_required_keys`.
- `500 Failed to generate completed treatment plan PDF`
  - Check edge function logs and confirm template base64 payload and render map validity.
- `500 Failed to create download URL`
  - Validate storage bucket permissions and service role access.
- PDF opens but app reports layout warnings
  - Do not send it to the client. Update the specific render-map boxes listed in `overflow_keys`, regenerate, and rerun the smoke check.
- PDF values overlap labels, borders, or adjacent fields
  - Treat the workflow as not client-ready. Recalibrate `docs/fill_docs/caloptima_fba_pdf_render_map.json` and rerun `npm run playwright:assessment-pdf-smoke`.

## Verification commands

Run these before release:

```bash
npm run lint
npm run typecheck
npx vitest run \
  src/server/__tests__/assessmentPlanPdfHandler.test.ts \
  src/server/__tests__/assessmentPlanPdfTemplate.test.ts \
  src/components/__tests__/ProgramsGoalsTab.test.tsx
npm run playwright:assessment-pdf-smoke
```

`npm run playwright:assessment-pdf-smoke` requires `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD`, Supabase URL/key env, and `PW_ASSESSMENT_DOCUMENT_ID` pointing to an approved CalOptima assessment with accepted program/goals. The smoke generates through `POST /api/assessment-plan-pdf`, downloads the signed PDF, renders mapped pages to screenshots, and fails if generated pixels appear outside allowed boxes or the renderer reports overflow.

## Audit and traceability

- Generation attempts are logged in `assessment_review_events`.
- Event action: `plan_pdf_generated`.
- Event payload includes:
  - `fill_mode`
  - `generated_bucket_id`
  - `generated_object_path`
  - `missing_required_count`
  - `layout_warning_count`
  - `overflow_keys`
