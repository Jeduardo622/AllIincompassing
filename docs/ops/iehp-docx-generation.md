# IEHP DOCX generation runbook

IEHP FBA final generation uses the Netlify `/api/assessment-plan-pdf` route and the Supabase Edge Function `generate-assessment-plan-docx`.

## Runtime dependencies

- `ASSESSMENT_GENERATION_SECRET` must be configured with the same value in Netlify and the Supabase Edge Function environment.
- The Edge Function is configured to bundle `supabase/functions/generate-assessment-plan-docx/fill_docs/Updated FBA -IEHP.docx`.
- Hosted deployments also require the private storage fallback template at `client-documents/templates/assessment/iehp/Updated FBA -IEHP.docx`.

Do not paste secret values or real assessment data into tickets, logs, or commits.

## Preflight behavior

`POST /api/assessment-plan-pdf` with `preflight_only: true` checks the approved IEHP review state and asks the Edge Function to verify that the DOCX template is readable. If the bundled template and storage fallback are unavailable, preflight returns a `template_unavailable` blocker and generation is not attempted.

Expected blocker:

```json
{
  "code": "template_unavailable",
  "message": "IEHP DOCX template is not available to the deployed generation function."
}
```

## Deployment verification

After deploying the Edge Function or rotating storage/template configuration:

1. Confirm `ASSESSMENT_GENERATION_SECRET` is present in Netlify and Supabase without printing the value.
2. Confirm the fallback template object exists at `client-documents/templates/assessment/iehp/Updated FBA -IEHP.docx`.
3. Run an IEHP preflight against a synthetic/redacted assessment and confirm no `template_unavailable` blocker is returned.
4. Run the hosted synthetic IEHP smoke before enabling routine clinician use.

If preflight reports `template_unavailable`, redeploy the Edge Function and re-upload the tracked IEHP template object from `supabase/functions/generate-assessment-plan-docx/fill_docs/Updated FBA -IEHP.docx`.
