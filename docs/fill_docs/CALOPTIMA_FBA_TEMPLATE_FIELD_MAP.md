# CalOptima FBA Field Map (Redacted Template)

Source document reviewed: `7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`

This mapping is specific to the CalOptima Functional Behavior Assessment / Initial Treatment Plan template and is separate from the IEHP mapping.

## Notes

- The reviewed file is a redacted, populated exemplar (not an empty form template).
- Fields below are grouped as:
  - `AUTO`: can be prefilled from existing platform data.
  - `ASSISTED`: can be drafted from extracted report/session content and reviewed.
  - `MANUAL`: clinician-entered required content.
- Placeholder keys follow `CALOPTIMA_FBA_*`.

## Core header and demographics

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Member Name | `CALOPTIMA_FBA_MEMBER_NAME` | AUTO | `clients.full_name` | Prefer `first_name + last_name` when present. |
| Member DOB | `CALOPTIMA_FBA_MEMBER_DOB` | AUTO | `clients.date_of_birth` | Format `MM/DD/YYYY`. |
| CIN # | `CALOPTIMA_FBA_CIN` | AUTO | `authorizations.member_id \|\| clients.cin_number \|\| clients.client_id` | CalOptima member identifier fallback chain. |
| Diagnoses/with ICD Code | `CALOPTIMA_FBA_DIAGNOSES_ICD` | AUTO | `clients.diagnosis[]` + optional `authorizations.diagnosis_code` | Join code + description lines. |
| Guardian Name | `CALOPTIMA_FBA_GUARDIAN_NAME` | AUTO | `clients.parent1_first_name/last_name` (fallback parent2) | Include relationship if known. |
| Phone (guardian/member) | `CALOPTIMA_FBA_CONTACT_PHONE` | AUTO | `clients.parent1_phone \|\| clients.phone` | Prefer guardian contact for this template section. |
| Primary Care Provider | `CALOPTIMA_FBA_PCP` | ASSISTED | `clients.insurance_info.pcp` | Not a first-class column today. |
| Known Allergies | `CALOPTIMA_FBA_KNOWN_ALLERGIES` | ASSISTED | `clients.insurance_info.allergies` | Not first-class; keep editable. |
| Current Medications/Dosage | `CALOPTIMA_FBA_MEDICATIONS` | ASSISTED | `clients.insurance_info.medications` | Prefer list format. |
| Dietary Restrictions | `CALOPTIMA_FBA_DIETARY_RESTRICTIONS` | ASSISTED | `clients.insurance_info.dietary_restrictions` | Keep editable. |
| Service Initiation Date | `CALOPTIMA_FBA_SERVICE_INITIATION_DATE` | AUTO | earliest ABA start from sessions/authorizations | Fallback manual if not derivable. |
| Date ABA first began | `CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN` | ASSISTED | intake/history narrative | Often differs from current authorization start. |
| Prior Applied Behavioral Health Agencies | `CALOPTIMA_FBA_PRIOR_ABH_AGENCIES` | MANUAL | N/A | Free text or "First time receiving ABA services". |
| Administrative Contact Full Name and Title | `CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE` | AUTO | `company_settings`/org profile | May require a dedicated org contact field. |
| Administrative Contact Phone Number | `CALOPTIMA_FBA_ADMIN_CONTACT_PHONE` | AUTO | `company_settings.phone` | |
| Administrative Contact Fax Number | `CALOPTIMA_FBA_ADMIN_CONTACT_FAX` | ASSISTED | `company_settings.fax` | Not always modeled; editable. |
| Chief Complaint/Reason for Seeking ABA Treatment | `CALOPTIMA_FBA_CHIEF_COMPLAINT` | MANUAL | N/A | Narrative clinical statement. |

## Data sources and interviews

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Records Reviewed (table) | `CALOPTIMA_FBA_RECORDS_REVIEWED` | MANUAL | N/A | Multi-row: record type, author, date. |
| Initial Interview/Observation | `CALOPTIMA_FBA_INITIAL_INTERVIEW_OBSERVATION` | MANUAL | N/A | Narrative with location/date/attendees. |
| Second Interview/Observation | `CALOPTIMA_FBA_SECOND_INTERVIEW_OBSERVATION` | MANUAL | N/A | Narrative with location/date/attendees. |

## Background, school, intervention history

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Individual Description/Living Arrangements | `CALOPTIMA_FBA_LIVING_ARRANGEMENTS` | ASSISTED | `clients.insurance_info.household` + notes | Human review required. |
| Significant Medical History | `CALOPTIMA_FBA_MEDICAL_HISTORY` | ASSISTED | `clients.insurance_info.medical_history` | |
| Functional Communication Skills | `CALOPTIMA_FBA_FUNCTIONAL_COMMUNICATION` | MANUAL | N/A | Clinical narrative. |
| Self-Care and Activities of Daily Living Skills | `CALOPTIMA_FBA_ADL_SKILLS` | MANUAL | N/A | Clinical narrative. |
| Social and Play Skills | `CALOPTIMA_FBA_SOCIAL_PLAY_SKILLS` | MANUAL | N/A | Clinical narrative. |
| Mobility Functioning and Restrictions | `CALOPTIMA_FBA_MOBILITY_RESTRICTIONS` | ASSISTED | `clients.insurance_info.mobility` | Editable. |
| Daily schedule of all activities (table) | `CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE` | ASSISTED | `clients.availability_hours` + external services | Requires formatting transform. |
| Daily school schedule (table) | `CALOPTIMA_FBA_SCHOOL_SCHEDULE` | MANUAL | N/A | Usually from IEP/school records. |
| School setting requested? (Yes/No) | `CALOPTIMA_FBA_SCHOOL_SETTING_REQUESTED` | MANUAL | N/A | Checkbox value. |
| Current IEP/equivalent? (Yes/No) | `CALOPTIMA_FBA_HAS_IEP` | MANUAL | N/A | Checkbox value. |
| Date of current IEP/equivalent | `CALOPTIMA_FBA_IEP_DATE` | ASSISTED | `clients.insurance_info.school.last_iep_date` | |
| IEP details/services | `CALOPTIMA_FBA_IEP_DETAILS` | MANUAL | N/A | Table + narrative. |
| Previous interventions (table) | `CALOPTIMA_FBA_PREVIOUS_INTERVENTIONS` | MANUAL | N/A | Provider/service/start/end/termination reason. |

## Coordination of care and adaptive testing

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Parent/Caregiver coordination | `CALOPTIMA_FBA_COORD_PARENT` | MANUAL | N/A | Narrative. |
| School coordination | `CALOPTIMA_FBA_COORD_SCHOOL` | MANUAL | N/A | Narrative/NA. |
| Regional Center coordination | `CALOPTIMA_FBA_COORD_REGIONAL_CENTER` | MANUAL | N/A | Narrative/NA. |
| Speech/OT/PT coordination | `CALOPTIMA_FBA_COORD_THERAPIES` | MANUAL | N/A | Narrative. |
| PCP/Specialist coordination | `CALOPTIMA_FBA_COORD_PCP` | MANUAL | N/A | Narrative. |
| Mental Health Provider coordination | `CALOPTIMA_FBA_COORD_MH` | MANUAL | N/A | Narrative/NA. |
| Vineland baseline date administered | `CALOPTIMA_FBA_VINELAND_BASELINE_DATE` | MANUAL | N/A | Must be current for authorization requirements. |
| Vineland facilitated by | `CALOPTIMA_FBA_VINELAND_FACILITATED_BY` | AUTO | `therapists.full_name + title` | |
| Vineland respondent | `CALOPTIMA_FBA_VINELAND_RESPONDENT` | MANUAL | N/A | |
| Vineland domain score table | `CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES` | MANUAL | N/A | Structured table payload. |

## Diagnostic and behavior analysis sections

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Current diagnosis code(s) | `CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES` | AUTO | `clients.diagnosis[]` / auth diagnosis | |
| Diagnosis description(s) | `CALOPTIMA_FBA_DIAGNOSIS_DESCRIPTIONS` | AUTO | `clients.diagnosis[]` | |
| Date of diagnosis/report | `CALOPTIMA_FBA_DIAGNOSIS_DATE` | ASSISTED | `clients.insurance_info.diagnosis_date` | |
| Diagnosed by (name/credential) | `CALOPTIMA_FBA_DIAGNOSED_BY` | ASSISTED | `clients.insurance_info.diagnosed_by` | |
| Target behavior blocks (1..n) | `CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS` | MANUAL | N/A | Includes identifying behavior/history/ABC/function. |
| Behavior intervention plan blocks | `CALOPTIMA_FBA_BIP_BLOCKS` | MANUAL | N/A | Ecological/replacement/focused/reactive/data procedures. |
| Mediator analysis | `CALOPTIMA_FBA_MEDIATOR_ANALYSIS` | MANUAL | N/A | Narrative. |
| Reinforcer assessment | `CALOPTIMA_FBA_REINFORCER_ASSESSMENT` | MANUAL | N/A | Narrative/list. |

## Goal sections and treatment planning

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Target and replacement behavior goals | `CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS` | MANUAL | N/A | Structured repeating goals with LT/IT/ST and baseline. |
| Skill acquisition goals (all domains) | `CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS` | MANUAL | N/A | Communication/daily living/social/self-direction sections. |
| Parent/Caregiver goals | `CALOPTIMA_FBA_PARENT_GOALS` | MANUAL | N/A | Repeating goals with setting/baseline fields. |
| Generalization & maintenance plan | `CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN` | MANUAL | N/A | Includes procedural reliability and reinforcement thinning. |
| Transition plan and exit criteria | `CALOPTIMA_FBA_TRANSITION_PLAN` | MANUAL | N/A | Includes checkboxes + 1-4 prompts. |
| Crisis plan | `CALOPTIMA_FBA_CRISIS_PLAN` | MANUAL | N/A | Required narrative and procedures. |

## Summary, recommendations, coding, and signatures

| Label | Placeholder key | Mode | Source | Notes |
| --- | --- | --- | --- | --- |
| Clinical summary/recommendations | `CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS` | MANUAL | N/A | Narrative justification of requested hours. |
| HCPCS recommendation rows | `CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS` | ASSISTED | authorization/planning payload | Multi-row table output. |
| Telehealth consent (Yes/No) | `CALOPTIMA_FBA_TELEHEALTH_CONSENT` | MANUAL | N/A | Checkbox with consent date. |
| Telehealth consent date | `CALOPTIMA_FBA_TELEHEALTH_CONSENT_DATE` | MANUAL | N/A | |
| Parent/guardian involvement answers | `CALOPTIMA_FBA_PARENT_INVOLVEMENT` | MANUAL | N/A | Yes/No + explanation. |
| Report written by | `CALOPTIMA_FBA_REPORT_WRITTEN_BY` | AUTO | `therapists.full_name + credentials` | |
| Title, License/Certificate # | `CALOPTIMA_FBA_WRITER_CREDENTIALS` | AUTO | `therapists.title + license_number/bcba_number/rbt_number` | |
| Date of Report Completed | `CALOPTIMA_FBA_REPORT_COMPLETED_DATE` | AUTO | `today (server)` | |
| Writer signature/date | `CALOPTIMA_FBA_WRITER_SIGNATURE_DATE` | MANUAL | N/A | Signature capture flow. |
| Report reviewed by | `CALOPTIMA_FBA_REPORT_REVIEWED_BY` | MANUAL | N/A | May be required if reviewer exists. |
| Reviewer signature/date | `CALOPTIMA_FBA_REVIEWER_SIGNATURE_DATE` | MANUAL | N/A | Signature capture flow. |

## Minimal implementation set (recommended first pass)

For immediate automation without risking bad autofill in clinical narratives:

- Implement `AUTO` fields in "Core header and demographics" and "Summary, recommendations, coding, and signatures".
- Keep all narrative sections as `MANUAL`.
- Add structured support for:
  - `CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS`
  - `CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS`
  - `CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS`
  - `CALOPTIMA_FBA_PARENT_GOALS`
