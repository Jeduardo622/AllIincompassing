# IEHP FBA Field-Level Extraction Checklist

Template: `Inland Empire Health Plan Functional Behavioral Assessment Report`

Source mapping: `docs/fill_docs/iehp_fba_template_field_map.json`  
Source document reviewed: `Updated FBA -IEHP (2).docx`

## Checklist schema and workflow rules

- `status` lifecycle: `not_started` -> `drafted` -> `verified` -> `approved`
- Requiredness defaults:
  - `AUTO`: required when a source exists
  - `ASSISTED`: required and clinician-verified
  - `MANUAL`: required clinician entry unless explicitly optional
- Parity rule: every `placeholder_key` in the IEHP mapping appears exactly once in the checklist JSON.

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
| Behaviors and Functional Skills to be Addressed | `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Persons in Household and Relationship to IEHP Member | `IEHP_FBA_HOUSEHOLD_MEMBERS` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| School Information Block | `IEHP_FBA_SCHOOL_INFORMATION_BLOCK` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| BHT School Hours Matrix | `IEHP_FBA_BHT_SCHOOL_HOURS_MATRIX` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Health and Medical Summary | `IEHP_FBA_HEALTH_MEDICAL_SUMMARY` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Current Services and Activities | `IEHP_FBA_CURRENT_SERVICES_ACTIVITIES` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Intervention History | `IEHP_FBA_INTERVENTION_HISTORY` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| BHT Availability Grid | `IEHP_FBA_BHT_AVAILABILITY_GRID` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| Member Environmental Analysis | `IEHP_FBA_ENVIRONMENTAL_ANALYSIS` | MANUAL | true | clinician_manual_entry | structured_payload_required |

## Assessment Procedures and Testing

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Assessment Procedures Table | `IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Records Reviewed Table | `IEHP_FBA_RECORDS_REVIEWED_TABLE` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Preference Assessment Summary | `IEHP_FBA_PREFERENCE_ASSESSMENT_SUMMARY` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Adaptive and Functional Measure Summaries | `IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES` | MANUAL | true | clinician_manual_entry | structured_payload_required |

## Treatment, Coordination, and Recommendations

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Target Behavior and Intervention Blocks | `IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Skill and School Goal Blocks | `IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS` | MANUAL | true | clinician_manual_entry | structured_payload_required |
| Safety Procedure / Crisis Plan | `IEHP_FBA_CRISIS_PLAN` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Coordination of Care | `IEHP_FBA_COORDINATION_OF_CARE` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Discharge, Transition and Exit Plans | `IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN` | MANUAL | true | clinician_manual_entry | non_empty_text |
| Recommendations and HCPCS Rows | `IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required |
| Signature Block | `IEHP_FBA_SIGNATURE_BLOCK` | MANUAL | true | clinician_manual_entry | signature_and_date_present |
