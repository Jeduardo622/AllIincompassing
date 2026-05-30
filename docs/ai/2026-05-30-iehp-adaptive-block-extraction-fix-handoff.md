## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: changes `supabase/functions/extract-assessment-fields/**`, a protected Edge Function extraction path
- triggering paths:
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`

## Scope

- task intent: preserve the four expected IEHP adaptive-measure block slots for `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES` during extraction and backfill the target hosted review row
- Linear issue: `WIN-162`
- files touched:
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
  - `docs/ai/2026-05-30-iehp-adaptive-block-extraction-fix-handoff.md`
- hosted document updated:
  - `assessment_documents.id = 86cdd0ce-dba3-44a9-b431-0653f3a2fafa`
  - updated one `assessment_structured_sections` row and one `assessment_extractions` row for `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES`
- single-purpose diff: yes

## Tenant Boundary

- only the existing target document row in the existing organization scope was backfilled
- no schema, RLS, grant, auth, or cross-organization query behavior changed
- cross-tenant access must remain impossible through existing Supabase policies and server-side organization filters

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - Codex performed routing, implementation, hosted verification, and security review directly
- reviewer: completed

## Verification Card

- required checks:
  - `deno test --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `deno test --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "adaptive measure block slots"`: failed before implementation as expected
  - `deno test --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts --filter "adaptive measure block slots"`: pass
  - `deno test --allow-read --allow-env=WS_NO_BUFFER_UTIL --allow-net=0.0.0.0:8000 supabase/functions/extract-assessment-fields/index.test.ts`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run test:ci`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - none
- result: pass
- residual risk: hosted source structure for document `86cdd0ce-dba3-44a9-b431-0653f3a2fafa` still contains only populated Vineland source text; VB-MAPP, AFLS, and ABAS-3 are represented as explicit null block slots until source decoding/content is investigated

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-162`)
- protected-path drift: expected `supabase/functions/extract-assessment-fields/**`
- unrelated changes: none
- generated artifact drift: none
- verification summary: required local checks passed
- pr-ready: yes
- required follow-up:
  - open PR for human review

## Recommended Next Slice

- Linear issue: `WIN-163`
- inspect the original uploaded DOCX/source conversion path for `Le, Ki IEHP FBA December 2025 (1).docx`
- determine whether VB-MAPP, AFLS, and ABAS-3 content exists in the uploaded source but was dropped during DOCX decoding or normalization
- if source text exists, fix the decoder or section extraction path and re-run extraction for the document
- if source text does not exist, keep the review UI empty states and mark those blocks as requiring manual clinician review

## Handoff Summary

This slice fixes the extractor payload shape by preserving the expected VB-MAPP, Vineland, AFLS, and ABAS-3 block slots instead of filtering missing blocks out of `assessment_blocks`. The hosted target document was backfilled so both the structured section row and extraction JSON now expose all four slots; only Vineland remains populated because the persisted source structure does not contain the other three measure names. The next slice should inspect original source conversion, not the review UI or persistence path.
