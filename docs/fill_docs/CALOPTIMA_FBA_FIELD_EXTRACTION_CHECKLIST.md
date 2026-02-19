# CalOptima FBA Field-Level Extraction Checklist

Template: `CalOptima Health Functional Behavior Assessment / Initial Treatment Plan`

Source mapping: `docs/fill_docs/caloptima_fba_template_field_map.json`
Source document reviewed: `7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`
PDF render map (for completed PDF output): `docs/fill_docs/caloptima_fba_pdf_render_map.json`

## Checklist schema and workflow rules

- `status` lifecycle: `not_started` -> `drafted` -> `verified` -> `approved`.
- Requiredness defaults:
  - `AUTO`: required when a source is defined.
  - `ASSISTED`: required and must be clinician-verified.
  - `MANUAL`: required clinician entry unless explicitly marked optional.
- Parity rule: every `placeholder_key` in mapping must appear exactly once in this checklist.

## How to use

1. Extractor sets `status` to `drafted` after initial population.
2. Reviewer validates format/source and sets `status` to `verified`.
3. BCBA or final approver sets `status` to `approved` with any sign-off notes.

## Identification and Administrative Intake

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Member Name | `CALOPTIMA_FBA_MEMBER_NAME` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started | Prefer first_name + last_name when available. |
| Member DOB | `CALOPTIMA_FBA_MEMBER_DOB` | AUTO | true | database_prefill | date_mm_dd_yyyy_or_na | IntakeCoordinator | ClinicalReviewer | not_started | Format MM/DD/YYYY. |
| CIN # | `CALOPTIMA_FBA_CIN` | AUTO | true | database_prefill | non_empty_identifier | IntakeCoordinator | ClinicalReviewer | not_started | CalOptima member identifier fallback chain. |
| Diagnoses/with ICD Code | `CALOPTIMA_FBA_DIAGNOSES_ICD` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started | Join as code + description lines. |
| Guardian Name | `CALOPTIMA_FBA_GUARDIAN_NAME` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started | Include relationship if known. |
| Phone (guardian/member) | `CALOPTIMA_FBA_CONTACT_PHONE` | AUTO | true | database_prefill | phone_us_or_e164_or_na | IntakeCoordinator | ClinicalReviewer | not_started | Prefer guardian contact for this section. |
| Primary Care Provider | `CALOPTIMA_FBA_PCP` | ASSISTED | true | assisted_draft_plus_review | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Not first-class modeled today. |
| Known Allergies | `CALOPTIMA_FBA_KNOWN_ALLERGIES` | ASSISTED | true | assisted_draft_plus_review | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Not first-class modeled today. |
| Current Medications/Dosage | `CALOPTIMA_FBA_MEDICATIONS` | ASSISTED | true | assisted_draft_plus_review | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Editable list. |
| Dietary Restrictions | `CALOPTIMA_FBA_DIETARY_RESTRICTIONS` | ASSISTED | true | assisted_draft_plus_review | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Editable list. |
| Service Initiation Date | `CALOPTIMA_FBA_SERVICE_INITIATION_DATE` | AUTO | true | database_prefill | date_mm_dd_yyyy_or_na | IntakeCoordinator | ClinicalReviewer | not_started | Fallback manual if not derivable. |
| Date ABA first began | `CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN` | ASSISTED | true | assisted_draft_plus_review | date_mm_dd_yyyy_or_na | ClinicalAuthor | BCBAReviewer | not_started | Often differs from current authorization start. |
| Prior Applied Behavioral Health Agencies | `CALOPTIMA_FBA_PRIOR_ABH_AGENCIES` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Free text or first-time flag. |
| Administrative Contact Full Name and Title | `CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started | May need dedicated org contact field. |
| Administrative Contact Phone Number | `CALOPTIMA_FBA_ADMIN_CONTACT_PHONE` | AUTO | true | database_prefill | phone_us_or_e164_or_na | IntakeCoordinator | ClinicalReviewer | not_started |  |
| Administrative Contact Fax Number | `CALOPTIMA_FBA_ADMIN_CONTACT_FAX` | ASSISTED | true | assisted_draft_plus_review | phone_us_or_e164_or_na | ClinicalAuthor | BCBAReviewer | not_started | Editable fallback. |
| Chief Complaint/Reason for Seeking ABA Treatment | `CALOPTIMA_FBA_CHIEF_COMPLAINT` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Narrative clinical statement. |

## Data Sources and Interviews

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Records Reviewed (table) | `CALOPTIMA_FBA_RECORDS_REVIEWED` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Record type, author, date rows. |
| Initial Interview/Observation | `CALOPTIMA_FBA_INITIAL_INTERVIEW_OBSERVATION` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Narrative with location/date/attendees. |
| Second Interview/Observation | `CALOPTIMA_FBA_SECOND_INTERVIEW_OBSERVATION` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Narrative with location/date/attendees. |

## Background, School, and Intervention History

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Daily schedule of all activities | `CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE` | ASSISTED | true | assisted_draft_plus_review | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Formatting transform required. |
| Daily school schedule | `CALOPTIMA_FBA_SCHOOL_SCHEDULE` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | From IEP/school records. |
| Current IEP/equivalent | `CALOPTIMA_FBA_HAS_IEP` | MANUAL | true | clinician_manual_entry | checkbox_yes_no_or_na | ClinicalAuthor | BCBAReviewer | not_started | Checkbox value. |
| Date of current IEP/equivalent | `CALOPTIMA_FBA_IEP_DATE` | ASSISTED | true | assisted_draft_plus_review | date_mm_dd_yyyy_or_na | ClinicalAuthor | BCBAReviewer | not_started |  |
| Previous interventions | `CALOPTIMA_FBA_PREVIOUS_INTERVENTIONS` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Provider/service/start/end/termination reason table. |

## Coordination of Care and Adaptive Testing

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Coordination of care sections | `CALOPTIMA_FBA_COORDINATION_OF_CARE` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Parent/school/regional center/speech-OT-PT/PCP/MH narratives. |
| Vineland domain score table | `CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Structured instrument output. |

## Diagnostic and Behavior Analysis

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current diagnosis code(s) | `CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started |  |
| Target behavior blocks | `CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Includes identifying behavior/history/ABC/function. |
| Behavior intervention plan blocks | `CALOPTIMA_FBA_BIP_BLOCKS` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Ecological/replacement/focused/reactive/data procedures. |
| Crisis plan | `CALOPTIMA_FBA_CRISIS_PLAN` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Preventative, response, and post-crisis protocol narrative. |

## Goals and Treatment Planning

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Target and replacement behavior goals | `CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Repeating LT/IT/ST goals plus baseline and settings. |
| Skill acquisition goals | `CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Communication/daily living/social/self-direction blocks. |
| Parent/Caregiver goals | `CALOPTIMA_FBA_PARENT_GOALS` | MANUAL | true | clinician_manual_entry | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Repeating LT/IT/ST goals with baseline and setting. |
| Generalization and maintenance plan | `CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Includes procedural reliability, reinforcement thinning, family training. |
| Transition plan and exit criteria | `CALOPTIMA_FBA_TRANSITION_PLAN` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Checkboxes + required prompts. |

## Summary, Recommendations, and Signatures

| Label | Placeholder key | Mode | Required | Extraction method | Validation rule | Extraction owner | Review owner | Status | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Summary and recommendations | `CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS` | MANUAL | true | clinician_manual_entry | non_empty_text | ClinicalAuthor | BCBAReviewer | not_started | Clinical rationale for requested hours. |
| HCPCS recommendation rows | `CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS` | ASSISTED | true | assisted_draft_plus_review | structured_payload_required | ClinicalAuthor | BCBAReviewer | not_started | Structured code/units/hours/location rows. |
| Telehealth consent confirmation | `CALOPTIMA_FBA_TELEHEALTH_CONSENT` | MANUAL | true | clinician_manual_entry | checkbox_yes_no_or_na | ClinicalAuthor | BCBAReviewer | not_started | Checkbox + consent date. |
| Parent/guardian involvement | `CALOPTIMA_FBA_PARENT_INVOLVEMENT` | MANUAL | true | clinician_manual_entry | checkbox_yes_no_or_na | ClinicalAuthor | BCBAReviewer | not_started | Yes/No responses + explanation. |
| Report written by | `CALOPTIMA_FBA_REPORT_WRITTEN_BY` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started |  |
| Title, License/Certificate # | `CALOPTIMA_FBA_WRITER_CREDENTIALS` | AUTO | true | database_prefill | non_empty_text | IntakeCoordinator | ClinicalReviewer | not_started |  |
| Date of Report Completed | `CALOPTIMA_FBA_REPORT_COMPLETED_DATE` | AUTO | true | database_prefill | date_mm_dd_yyyy_or_na | IntakeCoordinator | ClinicalReviewer | not_started |  |
| Writer and reviewer signatures | `CALOPTIMA_FBA_SIGNATURES` | MANUAL | true | clinician_manual_entry | signature_and_date_present | ClinicalAuthor | BCBAReviewer | not_started | Signature capture/approval workflow. |

