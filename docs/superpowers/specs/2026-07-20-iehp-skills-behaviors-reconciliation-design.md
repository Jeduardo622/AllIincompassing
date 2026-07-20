# IEHP Skills & Behaviors Reconciliation Design

## Goal

Produce one clinician-reviewable Skills & Behaviors result from both IEHP FBA sources:

1. the early `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` summary list
2. the later `IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS` and `IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS` detail sections

The detailed child-goal sections are authoritative for behavior-versus-skill classification. The summary list contributes source coverage but cannot classify an unmatched item by wording alone.

## Current boundary

The summary list is currently stored as `payload.targets: string[]`. The later detailed sections already carry goal payloads and are promoted as live goals with `clinical_goal_type = behavior | skill` based on their field key. Parent education goals share the skill/school field destination but remain parent goals and must not enter the child Skills & Behaviors result.

The reconciliation must preserve the existing summary `targets` array and detailed goal payloads so current document review, generation, promotion, and historical records remain compatible.

## Reconciled result

Attach a versioned `skills_behaviors` object to the existing `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` payload. Do not add a checklist key, structured-section row, table, or migration.

The object contains one ordered `items` array plus aggregate counts. Each item contains:

- `name`: preserved clinician-readable target name
- `clinical_goal_type`: `behavior`, `skill`, or `null`
- `reconciliation_status`: `matched`, `summary_only`, `detailed_only`, or `ambiguous`
- `summary_target_index`: source-list position when present
- `matched_goal_refs`: zero or more `{ field_key, section_index }` references
- `classification_source`: `explicit_goal_type`, `detailed_goal_field_key`, or `null`

The aggregate contains total, behavior, skill, summary-only, detailed-only, and ambiguous counts. The UI groups the single ordered result into Behavior Reduction, Skill Acquisition, and Needs Review without altering the stored order.

## Matching and classification

Matching is deterministic and fail-closed:

- compare the normalized summary target against the detailed goal `program_name`, `title`, and `target_behavior`
- normalization is limited to case folding, whitespace collapse, and surrounding punctuation; do not use semantic, fuzzy, substring, or model-based matching
- exactly one matching detailed child goal classifies the summary target from an explicit supported `clinical_goal_type` when present, otherwise from that goal's field key
- no match produces `summary_only` with `clinical_goal_type: null`
- multiple candidate matches or conflicting classifications produce `ambiguous` with `clinical_goal_type: null`
- a detailed child goal with no summary-list match is appended once as `detailed_only`, retaining its authoritative type
- parent goals are excluded even when stored under `IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS`
- incomplete detailed sections without a usable name do not create a classified item

This contract never infers that a phrase such as “functional communication” is a skill or that “aggression” is a behavior without corresponding detailed-section evidence.

## Data flow

After deterministic IEHP structured-section extraction completes, a pure reconciliation helper reads the three existing field-key groups and enriches the summary section payload. The result is review data and may be present while sections are still drafted; it does not affect live promotion until the existing clinician approval and publication gates succeed. Existing storage persists the JSON payload in `assessment_structured_sections`; the authenticated `/api/assessment-checklist` response already returns those rows.

The IEHP document-layout review reads `skills_behaviors.items` when available and renders the three review groups. Historical rows without the new object continue to render the legacy `targets` list. A present-but-malformed object renders an explicit invalid reconciliation / Needs Review warning instead of silently falling back.

IEHP publication remains based on the reviewed detailed goal sections. Reconciliation does not bypass approval, create drafts, or independently write live programs/goals.

## Error handling and compatibility

- An absent summary section yields no synthetic summary row and does not mutate unrelated structured sections.
- An empty summary list can still carry detailed-only child goals if the summary structured row exists.
- Unmatched and ambiguous items remain visible under Needs Review and cannot silently become typed live goals through this result.
- A missing `skills_behaviors` key uses the legacy `targets` renderer; a present-but-malformed key fails closed in the UI with an explicit invalid reconciliation warning and leaves the editable raw payload available to staff review.
- The original `targets`, raw text, section status, source span, and review notes remain unchanged.
- CalOptima extraction and promotion are unchanged.

## Proof contract

Use only synthetic fixtures and test first.

The focused red test must require a synthetic IEHP document containing:

- one early-list target matching a later target-behavior block
- one early-list target matching a later skill/replacement block
- one early-list target with no detailed match
- one later child goal absent from the early list
- one parent education goal
- duplicate normalized detailed labels that must remain ambiguous
- one explicit supported `clinical_goal_type` proving it takes precedence over field-key fallback

The green proof must assert exactly one reconciled item per logical child target, correct behavior/skill classification, the unmatched target in Needs Review, the detailed-only item retained, parent exclusion, deterministic references, counts, and preservation of `payload.targets`.

Add narrow UI coverage proving the grouped review output and legacy fallback. Extend the existing on-demand IEHP browser smoke with one synthetic reconciliation case that uploads through the authenticated application path, waits for `extracted`, queries the document's structured sections, and asserts the same field-level contract. JSON evidence reports only case ID, counts, statuses, classification booleans, and cleanup outcome; no raw clinical text, identifiers, credentials, phone values, or storage paths.

Hosted proof is reported separately if the required test environment or credentials are unavailable. It cannot be claimed as passed unless it ran against a deployment containing the parser change.

## Expected implementation surfaces

- `supabase/functions/extract-assessment-fields/index.ts`
- `supabase/functions/extract-assessment-fields/index.test.ts`
- `src/components/ClientDetails/IehpFbaLayoutReview.tsx`
- its narrow component test
- existing IEHP smoke/helper tests and package command only as needed for the opt-in proof case
- one concise handoff under `docs/ai/`

No `src/server/**` change is expected because the authenticated document response already exposes structured sections and IEHP promotion already uses the authoritative detailed sections.

## Non-goals

- no migration or new extraction field/checklist key
- no model-based or fuzzy clinical classification
- no automatic approval or publication
- no change to IEHP promotion semantics
- no CalOptima behavior change
- no parser-framework or smoke-framework refactor
- no real customer data or PHI

## Verification

Run the focused extraction test red, then green; narrow UI and smoke-helper tests; the opt-in hosted smoke when a compatible environment and credentials are available; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; and `npm run build`. Complete `verify-change`, `pr-hygiene`, code review, test review, architecture review, and security review. Human review is required before merge.
