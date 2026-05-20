# WIN-154 IEHP DOCX-Like Layout Review

## Scope

Implement IEHP-only page-by-page review/save parity for the `Updated FBA -IEHP (11).docx` template without changing CalOptima review behavior or adding one clinical column per field.

## Routing

- Classification: high-risk human-reviewed
- Lane: critical
- Protected surfaces: `supabase/migrations/**`, `supabase/functions/**`, `src/server/**`, `netlify.toml`, IEHP review UI
- Tenant boundary: template metadata is global/read-only to authenticated users; assessment values remain org-scoped through existing assessment document, checklist, and structured-section tables.

## Implemented Design

- `docs/fill_docs/iehp_fba_layout_manifest.json` is the deterministic IEHP layout source for 30 pages, 22 template tables, and all `IEHP_FBA_*` checklist keys.
- Supabase stores versioned template metadata in `assessment_template_versions`, `assessment_template_pages`, and `assessment_template_fields`.
- IEHP uploads resolve and store `assessment_documents.template_version_id`.
- `/api/assessment-template-layout` returns the active IEHP layout plus org-scoped checklist and structured-section values.
- `IehpFbaLayoutReview` renders an IEHP document-style editable review surface and saves through `/api/assessment-checklist`.
- DOCX extraction remains `local_docx`; Adobe remains the PDF extraction path only.

## Verification Targets

- Manifest coverage: 30 pages, 22 tables, all checklist keys.
- Server/API: IEHP layout API auth/org scoping and IEHP upload version linkage.
- UI: IEHP page renderer shows IEHP copy, not CalOptima copy, and saves checklist values.
- Edge extraction: IEHP filled-heading aliases capture health/medical, current services, intervention history, BHT school hours, goals, recommendations, and signature sections with honest assisted/manual status.

## Known Out Of Scope

- Completed IEHP PDF/DOCX export generation.
- Production data reprocessing.
- Auth, secrets, CI workflow, and tenant-boundary model changes beyond template metadata read policies.

