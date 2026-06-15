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

## Source Text Fixture Extraction

When `PW_CLINICAL_QA_EXPECTATIONS_FILE` is omitted and `PW_CLINICAL_QA_SOURCE_FILE` points to a redacted `.txt` or `.md` fixture, the runner derives expectations from supported source labels:

- `Target behaviors: ...`
- `Replacement behavior: ...`
- `Measurement terms: ...`

A safe example lives at `tests/fixtures/redacted-iehp-source.example.txt`. Source-only extraction currently does not parse DOCX or PDF. For DOCX/PDF source documents, provide a redacted expectations JSON fixture until a dedicated parser is added.

## Report Artifacts

Each successful run writes durable artifacts under `artifacts/latest`:

- screenshot: `clinical-data-parity-agent-<timestamp>.png`
- JSON report: `clinical-data-parity-agent-<timestamp>.json`
- markdown report: `clinical-data-parity-agent-<timestamp>.md`

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

- Browser evidence now supports source-to-output term parity when a redacted expectations JSON fixture is configured. It still requires fixture curation and human review of findings.
- The agent can reduce reviewer workload but cannot replace BCBA sign-off.
