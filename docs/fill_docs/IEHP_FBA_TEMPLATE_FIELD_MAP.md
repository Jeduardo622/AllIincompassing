# IEHP FBA Template Field Map

Template: `Inland Empire Health Plan Functional Behavioral Assessment Report`

Source document: `Updated FBA -IEHP (2).docx`
Source mapping JSON: `docs/fill_docs/iehp_fba_template_field_map.json`

This mapping follows the same extraction strategy used for CalOptima:
- `AUTO`: prefilled from structured system data
- `ASSISTED`: prefilled where possible, always clinician-reviewed
- `MANUAL`: clinician-authored in structured workflow fields

## Core sections mapped

- `identification_admin`: member demographics, referral metadata, assessor credentials.
- `behavior_background_services`: behavior targets, school block, medical and service history, availability.
- `assessment_procedures_testing`: procedures table, records reviewed, preference and adaptive assessments.
- `treatment_coordination_recommendations`: behavior intervention blocks, goals, crisis, coordination, discharge, HCPCS rows, signatures.

## Key IEHP-specific deltas from CalOptima

- First/last name are separate template fields.
- School-hour matrix and BHT availability grid are explicit required blocks.
- Environmental analysis includes yes/no checks and noise-level rating.
- Assessment procedures are table-oriented with date/location/person rows.
- HCPCS recommendation rows are explicitly listed in-template (`H2019`, `H0032`, `H0032-HO`, `H0032-HP`, `S5111`, `H2014`).

## Mapping quality gates

- Every `placeholder_key` in `iehp_fba_template_field_map.json` must appear exactly once in the IEHP checklist JSON.
- All `MANUAL` and `ASSISTED` rows default to required unless explicitly documented optional.
- Payer/template type must be persisted on each upload as `template_type = iehp_fba`.
