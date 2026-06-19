# Authorization PDF Prefill Design

## Summary

Add extraction-assisted prefill to the existing admin/super-admin authorization upload wizard. When an admin uploads an authorization PDF, the browser extracts embedded PDF text, parses known authorization fields, and fills only safe empty wizard fields before the admin reviews and submits.

This first slice does not add server-side OCR, AI extraction, background processing, schema changes, or automatic submission.

## Route Classification

- `exact issue key used`: `WIN-179`
- `classification`: `high-risk human-reviewed`
- `lane`: `critical`
- `why`: the feature handles authorization documents and influences tenant-scoped authorization records.
- `triggering paths`:
  - `src/components/ClientDetails/PreAuthTab.tsx`
  - `src/lib/authorizations/**`
  - `src/components/__tests__/PreAuthTab.test.tsx`
  - package dependency files if a browser PDF text extraction dependency is required
- `required agents`: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`
- `reviewer required`: yes
- `verify-change required`: yes
- `linear required`: yes before PR-ready state

## Goals

- Help admins reduce manual data entry when uploading authorization PDFs.
- Preserve the current manual upload workflow when extraction fails or returns incomplete data.
- Keep all extraction local to the browser for this slice.
- Require admin review before any authorization data is saved.
- Avoid storing raw extracted text.
- Use synthetic test fixtures only.

## Non-Goals

- No BT or therapist access changes.
- No route guard changes.
- No server-side OCR or AI document processing.
- No Supabase schema, RLS, grant, RPC, or storage policy changes.
- No automatic authorization creation from PDF upload alone.
- No use of real member documents in tests or committed fixtures.

## User Flow

1. An admin opens the client record and selects the Pre-Authorizations tab.
2. The admin starts the existing new authorization wizard.
3. The admin uploads one or more authorization PDF documents in the document upload step.
4. For each PDF candidate, the app attempts embedded text extraction in the browser.
5. The parser maps recognized fields into a prefill candidate.
6. The wizard applies the candidate only to empty fields or safe service-code matches.
7. The UI shows extraction status and reminds the admin to review values.
8. The admin edits any value and submits through the existing authorization save path.

## Architecture

### PDF Text Extraction

Create a small browser-only helper that accepts a `File` and returns extracted text for PDFs with embedded text. It should reject unsupported files and return a clear failure for scanned image-only PDFs.

The helper must not upload the file, call external services, or persist raw text.

### Deterministic Parser

Create a pure parser that accepts plain text and returns a partial prefill object. It should recognize common authorization notice shapes seen in IEHP and CalOptima-style documents:

- authorization or referral number
- status
- start and end dates
- member ID or CIN
- diagnosis code and nearby description
- service codes and requested or approved units

The parser should normalize dates to `YYYY-MM-DD` and leave ambiguous values unset.

### Wizard Merge Rules

The wizard should merge extracted values conservatively:

- Fill blank scalar fields only.
- Do not overwrite values the admin already typed.
- Add service codes only when the code exists in the loaded CPT/service catalog.
- Set units only for services that are selected by the merge and have a valid positive integer unit value.
- Prefer approved units over requested units when both are present.
- Leave unknown service codes visible only as extraction status text, not as saved service rows.

### UI Feedback

The document step should show one compact extraction status banner:

- extracting PDF text
- prefilled fields applied and review required
- no embedded text found, manual entry required
- extraction failed, manual entry still available
- extracted unsupported service codes skipped

The status must not display raw document text.

## Security And Privacy

- Extraction runs client-side only.
- Raw extracted text is held in memory only while parsing.
- Raw extracted text is not logged, stored, submitted, or committed.
- Existing admin/super-admin route and tab access remains the enforcement boundary.
- Existing tenant/org-scoped save behavior remains the only write path.
- Real PHI documents must not be added to the repository as fixtures.

## Testing Strategy

Add pure parser tests using synthetic text that resembles authorization notices without real member data.

Add component coverage for the wizard by mocking PDF text extraction:

- uploading a PDF can prefill empty authorization fields
- admin-entered fields are not overwritten
- recognized service codes are selected only when present in the service catalog
- unknown service codes are skipped and shown in status
- extraction failure leaves the manual flow usable

Required verification for implementation:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- targeted Vitest tests for parser and wizard behavior
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local` when local environment supports the required checks

## Residual Risk

Embedded-text PDF extraction will not work for scanned image-only documents. This is an intentional limitation of the first slice. If scanned PDFs are common, OCR must be evaluated as a separate routed slice with explicit PHI, server/API, cost, and security review.
