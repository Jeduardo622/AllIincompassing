# Clinical Data Parity Agent Handoff

## Scope

- Added a repo-local `clinical-data-parity-auditor` agent skill for browser-only redacted IEHP/FBA QA.
- Added `npm run playwright:clinical-data-parity-agent` to prove browser reachability and credential validity without hosted writes.
- Added explicit `PW_CLINICAL_QA_*` env placeholders for dedicated test-account credentials and redacted fixtures.

## Route Classification

- classification: low-risk autonomous
- lane: standard
- triggering paths: `.agents/skills/**`, `scripts/**`, `tests/**`, `package.json`, `.env.example`, `docs/ai/**`
- protected paths touched: none

## Credential Contract

Preferred:

- `PW_CLINICAL_QA_EMAIL`
- `PW_CLINICAL_QA_PASSWORD`

Fallback:

- `PW_ADMIN_EMAIL`
- `PW_ADMIN_PASSWORD`

Optional:

- `PW_BASE_URL`
- `PW_CLINICAL_QA_CLIENT_ID`
- `PW_CLINICAL_QA_ROUTE`
- `PW_CLINICAL_QA_SOURCE_FILE`
- `PW_CLINICAL_QA_OUTPUT_FILE`
- `PW_CLINICAL_QA_EXPECTATIONS_FILE`
- `PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR`

The runner rejects placeholder passwords, API routes, admin-only routes, and fixture paths that are not clearly redacted, synthetic, smoke, or test fixtures.

## Expectations Fixture Contract

`PW_CLINICAL_QA_EXPECTATIONS_FILE` points to a redacted, synthetic, smoke, or test JSON fixture. A safe example lives at `tests/fixtures/redacted-iehp-expectations.example.json`:

```json
{
  "expectations": [
    {
      "key": "target_behaviors",
      "label": "Target behaviors",
      "sourceSection": "FBA target behavior summary",
      "expectedTerms": ["elopement", "property destruction"],
      "observedSectionTerms": ["Programs", "Goals"],
      "severity": "high",
      "humanReviewBlocker": true
    }
  ]
}
```

The browser runner compares each `expectedTerms` entry against the visible browser text and emits `dataParityFindings` plus `humanReviewBlockers` in the JSON payload. Findings include:

- `sourceSection`: the redacted source section the expectation came from, or `null`.
- `observedSectionTerms`: visible UI terms expected near the reviewed surface.
- `mismatchType`: `match`, `partial`, or `missing`.
- `observedTextSnippet`: a compact browser-text excerpt around matched evidence when available.
- `sectionEvidenceStatus`: whether matched terms also appear inside the expected browser or generated-output section.

## Source Text Fixture Extraction

When `PW_CLINICAL_QA_EXPECTATIONS_FILE` is omitted and `PW_CLINICAL_QA_SOURCE_FILE` points to a redacted `.txt`, `.md`, `.docx`, or `.pdf` fixture, the runner extracts source text and derives expectations from supported source labels:

- `Target behaviors: ...`
- `Replacement behavior: ...`
- `Measurement terms: ...`
- `Antecedents: ...`
- `Consequences: ...`
- `Functions: ...`
- `Interventions: ...`
- `Client identifiers: ...`
- `Authorization details: ...`

A safe example lives at `tests/fixtures/redacted-iehp-source.example.txt`. DOCX/PDF extraction is intended for redacted QA fixtures only; provide a redacted expectations JSON fixture when the source format is not reliably extractable.

## Generated Output Capture

When `PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR` is set, the runner:

- waits for the browser `POST /api/assessment-plan-pdf` response triggered by that selector
- parses the returned `generated_file_type`, `signed_url`, and optional `filename`
- downloads the signed DOCX/PDF artifact through the Playwright browser context
- saves the artifact under `artifacts/latest/redacted-clinical-qa-generated-output-<timestamp>.<docx|pdf>`
- extracts text from that redacted artifact and uses it for output parity
- records generated-output section evidence from labeled text blocks when the artifact text is extractable

The signed URL is used only for immediate download and is not written to the JSON/markdown report payload.

## Report Artifacts

Each successful run writes durable artifacts under `artifacts/latest`:

- screenshot: `clinical-data-parity-agent-<timestamp>.png`
- JSON report: `clinical-data-parity-agent-<timestamp>.json`
- markdown report: `clinical-data-parity-agent-<timestamp>.md`
- optional generated output artifact: `redacted-clinical-qa-generated-output-<timestamp>.<docx|pdf>`

The JSON report matches the stdout payload. The markdown report is intended for reviewer handoff and redacts browser-visible email addresses from observed snippets.

## Non-Goals

- No production account access.
- No Supabase writes.
- No upload, publish, approval, or promotion action.
- No service-role key usage.
- No clinical approval claim.

## Verification Plan

- `npm test -- tests/scripts/clinical-data-parity-agent.test.ts`
- `npm run playwright:clinical-data-parity-agent` when dedicated test credentials are configured
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Residual Risk

- Browser evidence now supports source-to-output term parity when a redacted expectations JSON fixture or supported redacted source fixture is configured. It still requires fixture curation and human review of findings.
- Live generated-output capture requires an approved redacted test assessment route with a stable generate-control selector.
- The agent can reduce reviewer workload but cannot replace BCBA sign-off.
