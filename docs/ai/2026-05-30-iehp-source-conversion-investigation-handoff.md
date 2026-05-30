## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: changes `supabase/functions/extract-assessment-fields/**`, IEHP review UI behavior, and a hosted assessment payload for one target document
- triggering paths:
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
  - `src/components/ClientDetails/IehpFbaLayoutReview.tsx`
  - `src/components/__tests__/IehpFbaLayoutReview.test.tsx`

## Scope

- task intent: execute `WIN-163` by determining whether missing VB-MAPP, AFLS, and ABAS-3 source content exists in the WIN-163 uploaded IEHP FBA DOCX, then mark true source absence for clinician review without inventing content
- Linear issue: `WIN-163`
- target document:
  - assessment document: `WIN-163 target assessment document`
  - file name: `WIN-163 target IEHP FBA DOCX`
- hosted rows updated:
  - one `assessment_structured_sections` row for `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES`
  - one `assessment_extractions` row for `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES`
- non-goal: no synthetic VB-MAPP, AFLS, or ABAS-3 clinical narrative

## Source Conversion Evidence

- local original DOCX was found at repository root as the `WIN-163 target IEHP FBA DOCX`
- OpenXML inspection covered all `word/*.xml` parts, not only `word/document.xml`
- result:
  - `word/document.xml` length: `88461`
  - all `word/*.xml` combined text length: `99194`
  - `Vineland`: present
  - adaptive-measure heading: present
  - `VB-MAPP`: absent
  - `AFLS`: absent
  - `ABAS-3`: absent
- conclusion: the missing VB-MAPP, AFLS, and ABAS-3 blocks are absent from the text-bearing DOCX source parts inspected here; this is not explained by the current `word/document.xml` decoder dropping separate Word XML text parts

## Tenant Boundary

- only the existing target assessment document rows were backfilled
- no schema, RLS, grant, auth, or cross-organization query behavior changed
- cross-tenant access must remain impossible through existing Supabase policies and server-side organization filters

## Implementation

- extractor now annotates missing adaptive-measure blocks with:
  - `manual_review_required: true`
  - `review_note: "<measure> content was not found in the source document text; clinician review is required."`
- review UI renders the note for missing blocks, infers the same note for legacy known block slots with no raw text, and includes it in copied staff-readable text
- hosted target rows now carry manual-review markers for VB-MAPP, AFLS, and ABAS-3; Vineland remains the only populated source block

## Verification Card

- required checks:
  - `deno test --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`
  - `npx vitest run src/components/__tests__/IehpFbaLayoutReview.test.tsx`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - local OpenXML inspection of the `WIN-163 target IEHP FBA DOCX`: pass, found Vineland only among target adaptive-measure names
  - hosted Supabase diagnostic query for target adaptive blocks: pass
  - hosted Supabase targeted backfill for `manual_review_required` markers: pass, updated one structured row and one extraction row
  - `deno test --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "adaptive measure block slots"`: pass
  - `npx vitest run src/components/__tests__/IehpFbaLayoutReview.test.tsx`: pass
  - `deno test --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "decodeDocxStructured parses the committed IEHP FBA DOCX fixture"`: pass
  - `deno test --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - none currently
- result: pass
- residual risk: source evidence is based on text-bearing OpenXML parts; if the missing content exists only in embedded images, screenshots, or non-text binary objects, it would require OCR/manual source review rather than DOCX text decoding changes

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-163`)
- protected-path drift: expected `supabase/functions/extract-assessment-fields/**`
- unrelated changes: none expected
- generated artifact drift: none expected
- pr-ready: yes
