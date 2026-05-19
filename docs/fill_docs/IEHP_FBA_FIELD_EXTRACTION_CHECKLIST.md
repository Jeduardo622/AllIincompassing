# IEHP FBA Field-Level Extraction Checklist

Template: `Inland Empire Health Plan Functional Behavioral Assessment Report`

Source mapping: `docs/fill_docs/iehp_fba_template_field_map.json`  
Source document reviewed: `Updated FBA -IEHP (2).docx`

Implementation note: IEHP DOCX uploads use local Word XML decoding, not Adobe. IEHP PDFs use Adobe PDF Extract before the same deterministic IEHP mapping runs. The LE-style filled document headings now covered include `Availability for Behavior Health Treatment Services`, `Safety/Crisis Procedure`, `Discharge Criteria`, `Transition of Care`, `Recommendations`, `Clinical Recommendations`, `Report completed by`, `DESCRIPTION OF ASSESSMENT PROCEDURES`, `Records reviewed included`, and adaptive/functional measure headings such as `ASSESSMENT MEAURES`.

## Checklist schema and workflow rules

- `status` lifecycle: `not_started` -> `drafted` -> `verified` -> `approved`
- Requiredness defaults:
  - `AUTO`: required when a source exists
  - `ASSISTED`: required and clinician-verified
  - `MANUAL`: required clinician entry unless explicitly optional
- Parity rule: every `placeholder_key` in the IEHP mapping appears exactly once in the checklist JSON.
- Confidence rule: structured document content can prefill `ASSISTED` or `MANUAL` rows for review, but those rows remain assisted/manual and are not promoted to confident `AUTO` summaries.
- DB-prefill rule: only fields present in the client snapshot sent by `src/server/api/assessment-documents.ts` are DB-prefilled. Current supported snapshot fields include member name parts, birth date, member ID fallback, contact phone, primary guardian, preferred language, and address parts; assessor, clinic, referring-provider, school, household, insurance, and availability fields remain assisted/manual unless the document text supplies a label match.

## How to use

1. Extractor sets row status to `drafted` after first pass.
2. Reviewer verifies value format and source correctness, then sets `verified`.
3. Final clinical reviewer sets `approved` with sign-off notes.

## Identification and Administrative Intake

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| First Name | `IEHP_FBA_FIRST_NAME` | AUTO | true | database_prefill | non_empty_text |
| Last Name | `IEHP_FBA_LAST_NAME` | AUTO | true | database_prefill | non_empty_text |
| Birth Date | `IEHP_FBA_BIRTH_DATE` | AUTO | true | database_prefill | date_mm_dd_yyyy_or_na |
| IEHP Member ID# | `IEHP_FBA_MEMBER_ID` | AUTO | true | database_prefill | non_empty_identifier |
| Present Address | `IEHP_FBA_PRESENT_ADDRESS` | AUTO | true | database_prefill | non_empty_text |
| Parent/Guardian | `IEHP_FBA_PARENT_GUARDIAN` | AUTO | true | database_prefill | non_empty_text |
| Phone | `IEHP_FBA_CONTACT_PHONE` | AUTO | true | database_prefill | phone_us_or_e164_or_na |
| Language | `IEHP_FBA_LANGUAGE` | ASSISTED | true | assisted_draft_plus_review | non_empty_text |
| Referral Date | `IEHP_FBA_REFERRAL_DATE` | ASSISTED | true | assisted_draft_plus_review | date_mm_dd_yyyy_or_na |
| Report Date | `IEHP_FBA_REPORT_DATE` | AUTO | true | database_prefill | date_mm_dd_yyyy_or_na |
| Assessor/Certification | `IEHP_FBA_ASSESSOR_CERTIFICATION` | AUTO | true | database_prefill | non_empty_text |
| Assessor's phone number | `IEHP_FBA_ASSESSOR_PHONE` | ASSISTED | true | assisted_draft_plus_review | phone_us_or_e164_or_na |
| Name of Referring Provider, Credentials | `IEHP_FBA_REFERRING_PROVIDER` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Reason for Referral | `IEHP_FBA_REASON_FOR_REFERRAL` | MANUAL | true | clinician_manual_entry | non_empty_text |

## Behavior, Background, and Services

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Behaviors and Functional Skills to be Addressed | `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Persons in Household and Relationship to IEHP Member | `IEHP_FBA_HOUSEHOLD_MEMBERS` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| School Information Block | `IEHP_FBA_SCHOOL_INFORMATION_BLOCK` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| BHT School Hours Matrix | `IEHP_FBA_BHT_SCHOOL_HOURS_MATRIX` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Health and Medical Summary | `IEHP_FBA_HEALTH_MEDICAL_SUMMARY` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | non_empty_text |
| Current Services and Activities | `IEHP_FBA_CURRENT_SERVICES_ACTIVITIES` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Intervention History | `IEHP_FBA_INTERVENTION_HISTORY` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| BHT Availability Grid | `IEHP_FBA_BHT_AVAILABILITY_GRID` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| Member Environmental Analysis | `IEHP_FBA_ENVIRONMENTAL_ANALYSIS` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |

## Assessment Procedures and Testing

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Assessment Procedures Table | `IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Records Reviewed Table | `IEHP_FBA_RECORDS_REVIEWED_TABLE` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Preference Assessment Summary | `IEHP_FBA_PREFERENCE_ASSESSMENT_SUMMARY` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | non_empty_text |
| Adaptive and Functional Measure Summaries | `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |

## Treatment, Coordination, and Recommendations

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Target Behavior and Intervention Blocks | `IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Skill and School Goal Blocks | `IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | structured_payload_required |
| Safety Procedure / Crisis Plan | `IEHP_FBA_CRISIS_PLAN` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | non_empty_text |
| Coordination of Care | `IEHP_FBA_COORDINATION_OF_CARE` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | non_empty_text |
| Discharge, Transition and Exit Plans | `IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | non_empty_text |
| Recommendations and HCPCS Rows | `IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| Signature Block | `IEHP_FBA_SIGNATURE_BLOCK` | ASSISTED | true | deterministic_docx_or_pdf_structured_extract | signature_and_date_present |

## Known limitations

- DOCX checkbox/radio-style answers are preserved as option text when selected-state markers are absent from Word XML; those rows are extracted as reviewable structured payloads with `needs_review`.
- IEHP completed PDF export is not implemented; the review UI marks IEHP PDF export unavailable instead of sending the CalOptima-only export request.
- Referring provider and reason-for-referral remain manual unless the uploaded document provides a direct label/alias match.
