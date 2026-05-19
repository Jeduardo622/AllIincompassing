# Adobe Acrobat Services API Placeholders

This repository uses server-only placeholders for Adobe Acrobat Services / PDF Services API credentials. Do not expose these values through Vite, runtime config, browser bundles, logs, or test fixtures.

Current approved use: uploaded assessment **PDF extraction only** through Adobe PDF Extract API. Do not use Adobe for final CalOptima PDF generation, signing, embedded viewing, or overlay rendering.

## Credentials

The Adobe Node.js credential bundle includes `pdfservices-api-credentials.json` with:

- `client_credentials.client_id`
- `client_credentials.client_secret`
- `service_principal_credentials.organization_id`

Map those values to the server environment:

```ini
PDF_SERVICES_CLIENT_ID=****
PDF_SERVICES_CLIENT_SECRET=****
PDF_SERVICES_ORGANIZATION_ID=****
```

Optional descriptive aliases are also supported by `src/server/adobeAcrobat.ts`:

```ini
ADOBE_PDF_SERVICES_CLIENT_ID=****
ADOBE_PDF_SERVICES_CLIENT_SECRET=****
ADOBE_PDF_SERVICES_ORGANIZATION_ID=****
```

## Token Request

Use the token endpoint with form-encoded credentials:

```http
POST https://pdf-services.adobe.io/token
Content-Type: application/x-www-form-urlencoded
```

Body placeholders:

```text
client_id={{PDF_SERVICES_CLIENT_ID}}
client_secret={{PDF_SERVICES_CLIENT_SECRET}}
```

## API Request Headers

After receiving a short-lived access token, call Adobe REST operations with:

```http
X-API-Key: {{PDF_SERVICES_CLIENT_ID}}
Authorization: Bearer {{ADOBE_ACCESS_TOKEN}}
Content-Type: application/json
Accept: application/json
```

`ADOBE_ACCESS_TOKEN` is intentionally not an environment placeholder. Treat it as short-lived runtime state from the token response.

## Assessment PDF Extraction Flow

Uploaded PDF assessments are processed only after the server/edge path confirms the authenticated user can access the stored `assessment_documents` row and the requested `bucket_id` / `object_path` match that row.

The edge extraction flow is:

1. `POST https://pdf-services.adobe.io/token`
2. `POST https://pdf-services.adobe.io/assets`
3. `PUT uploadUri` with `Content-Type: application/pdf`
4. `POST https://pdf-services.adobe.io/operation/extractpdf` with `elementsToExtract: ["text", "tables"]`
5. Poll the returned `location`
6. Download the result ZIP from Adobe's returned pre-signed `downloadUri` and parse `structuredData.json`

Adobe's `uploadUri` and result `downloadUri` may point at Adobe-managed cloud storage instead of an `adobe.io` host. The extraction adapter allows only HTTPS storage URLs on Adobe's documented PDF Services storage hosts:

- `dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com`
- `dcplatformstorageservice-prod-eu-west-1.s3.amazonaws.com`

DOCX assessment uploads are still decoded locally through Word XML text/table decoding (`extraction_provider = local_docx`). PDF uploads must use Adobe (`extraction_provider = adobe_pdf_extract`); missing credentials or Adobe failures produce `extraction_failed` with a redacted operator-facing error rather than falling back to legacy PDF parsing.

For IEHP FBA, this means LE-style DOCX files are not sent to Adobe. Their field coverage depends on deterministic IEHP heading aliases and structured-section parsing in `supabase/functions/extract-assessment-fields/index.ts`; Adobe coverage applies only when the uploaded IEHP/assessment source is a PDF.
