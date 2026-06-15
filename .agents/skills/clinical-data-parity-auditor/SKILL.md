---
name: clinical-data-parity-auditor
description: Browser-only redacted clinical QA agent for source-to-output IEHP/FBA data parity review.
---

# Clinical Data Parity Auditor

Use this skill when the task is to simulate a BCBA-style reviewer for redacted test accounts and redacted IEHP/FBA files.

## Mission

Audit whether clinically important data moved correctly from source material into the app UI and generated output. This is QA evidence only. It is not BCBA approval, clinical sign-off, diagnosis, or treatment guidance.

## Hard Boundaries

- Use only dedicated test accounts.
- Use only redacted, synthetic, smoke, or test fixtures.
- Use browser-only permissions for app inspection.
- Do not write to Supabase, upload production data, approve assessments, publish drafts, or promote clinical content.
- Do not read real `.env*` files unless the user explicitly asks. Prefer shell-provided env or `PLAYWRIGHT_ENV_FILE` configured by the operator.
- Do not print passwords, tokens, service-role keys, or raw PHI.

## Required Credentials

The browser runner uses the existing Playwright env loader.

Preferred:

- `PW_CLINICAL_QA_EMAIL`
- `PW_CLINICAL_QA_PASSWORD`

Fallback:

- `PW_ADMIN_EMAIL`
- `PW_ADMIN_PASSWORD`

Optional scope:

- `PW_BASE_URL`
- `PW_CLINICAL_QA_CLIENT_ID`
- `PW_CLINICAL_QA_ROUTE`
- `PW_CLINICAL_QA_SOURCE_FILE`
- `PW_CLINICAL_QA_OUTPUT_FILE`

Source/output fixture paths must include `redacted`, `synthetic`, `smoke`, or `test` in the path.

## Browser Reachability Check

Run:

```bash
npm run playwright:clinical-data-parity-agent
```

The runner must:

- load Playwright env without committing secrets
- authenticate in the browser
- reach the configured app route
- capture a screenshot under `artifacts/latest`
- emit a JSON checklist result
- include the disclaimer `QA evidence only. This is not BCBA approval or clinical sign-off.`

## Review Procedure

1. Confirm the target account and files are test/redacted.
2. Run the browser reachability check.
3. Inspect the visible UI/document surface for source-to-output data parity:
   - client and assessment identifiers
   - assessment dates and provider context
   - target behaviors
   - antecedents, consequences, and functions
   - replacement behaviors and interventions
   - goals, measurement method, baseline, mastery, maintenance, and generalization criteria
   - authorization/client metadata
   - unknown, blank, inferred, or missing values
4. Record evidence as route, screenshot, checklist item, observed value, expected source value, severity, and human-review blocker status.

## Output Contract

Return a concise report with:

- target route:
- credential label used:
- source/output fixtures:
- browser evidence:
- data parity findings:
- required human review blockers:
- residual risk:

