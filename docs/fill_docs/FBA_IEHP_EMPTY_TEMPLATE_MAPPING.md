# FBA IEHP Empty Template Mapping (v2)

Source template: `Updated FBA -IEHP (2).docx`  
Extraction artifacts: `tmp/docx_extracted/Updated FBA -IEHP (2).labels.json`, `tmp/docx_extracted/Updated FBA -IEHP (2).structured.txt`

## Mapping scope

- Parsed all Word XML parts (`document`, `header*`, `footer*`) and extracted label candidates.
- Detected 155 labels/tokens in this template variant.
- Normalized those into canonical data groups used by app workflows (client profile, authorization, assessment intake, generated goals, and BCBA review notes).
- Included all numbered sections in the template (`1` through `14`) plus repeated program-goal blocks.

## Canonical section map

### 1) General Information

- **Client identity**: `First Name`, `Last Name`, `Birth Date`, `IEHP Member ID#`
  - Source: `clients.*`, `authorizations.member_id` fallback chain.
  - Mode: auto-fill with BCBA overwrite allowed.
- **Contact/demographics**: `Present Address`, `Parent/Guardian`, `Phone`, `Language`
  - Source: `clients.*`, guardian links.
  - Mode: auto-fill + editable.
- **Referral/assessor metadata**: `Referral Date`, `Report Date`, `Assessor/Certification`, `Assessor's phone number`
  - Source: authorization metadata + logged-in clinician profile.
  - Mode: mixed (auto + manual).

### 2) Reason for Referral and Presenting Concerns

- `Name of Referring Provider, Credentials`, `Date Referred`, `Reason for Referral`
  - Source: intake metadata + clinician narrative.
  - Mode: manual required (with optional auto-suggestions from uploaded assessment text).

### 3) Behaviors

- Behavior checklist domain coverage:
  - Challenging behavior (`Aggression`, `Tantrums`, `Elopement`, `SIB`, etc.)
  - Skill deficit (`Communication`, `Self-Direction`, `Social Skills`, etc.)
  - Other free-text
- Source: extracted assessment observations + clinician confirmation.
- Mode: AI propose -> BCBA select/adjust.

### 4) Background Information

- **Living situation**: household members + additional notes
- **School information**: school name, grade, IEP date, teacher, schedule, district, placement, school services
- **Medical and health**: PCP recency, diagnosis/medical context narrative
- **Current services and activities**: service schedule + extracurriculars
- **Intervention history**: prior service history narrative/table
- **Availability for BHT services**: weekly time grid
- Source: intake form data + uploaded report extraction + manual completion.
- Mode: mixed; time-grid fields manual first release.

### 5) Member Environmental Analysis

- Yes/No environmental readiness checks + distraction level.
- Source: clinician observation and caregiver interview.
- Mode: manual required (structured booleans + notes).

### 6) Description of Assessment Procedures

- Procedures table (`Records Reviewed`, `Clinical Interview`, `1st/2nd Observation`, `Brief Functional Analysis`) with date/location/person.
- Stimulus preference assessment dates.
- Standardized assessment administration dates.
- Indirect FA tools with dates (`FAST`, `MAS`, `QABF`).
- Source: assessor-entered evaluation details.
- Mode: manual required; preserve as structured rows.

### 7) Assessment Measures

- VB-MAPP, Vineland, AFLS, ABAS-3 sections.
- Includes score tables, respondent/interviewer metadata, and summary narratives.
- Source: formal instrument outputs (often attached files) + clinician interpretation.
- Mode: hybrid:
  - Numeric metrics manually entered/imported.
  - Narrative can be AI-assisted from extracted scores.

### 8) Target Behaviors

- Per-behavior descriptive phase:
  - Topography, onset/offset, course, history/recent changes, source, baseline (date/location/value)
  - FAST/MAS/QABF interpretation
  - Antecedent/consequence analysis
  - Function hypothesis
- Verification phase (optional FA testing conditions and results).
- Source: observation data + behavior logs + clinician synthesis.
- Mode: manual with AI drafting support.

### 9) Program Goals

- Repeating goal/program blocks across domains:
  - Behavior, Communication, Self-Help, Social Skills, School Goals
  - Program Name, Instrumental Goal, Short Term, Intermediate
  - Clinical Justification, Data Collection, Mastery Criteria, Generalization Criteria
  - Baseline triplet (date/location/value)
  - Progress states for revised/new goals
- Source: generated program-goal draft + BCBA edits + baseline evidence.
- Mode: staged:
  - AI generate draft goals from assessment
  - BCBA approve/reject/edit each goal
  - Persist approved goals/programs to production tables.

### 10) Behavior Intervention Plan

- Per target behavior:
  - Reduction goal, definition, function, baseline/date
  - proactive/reactive strategies
  - replacement behaviors
- Includes safety/crisis planning narratives.
- Source: clinician-authored intervention design.
- Mode: manual required (AI suggestions optional).

### 11) Teaching Intervention Strategies

- Teaching approach/procedure definitions + implementation instructions.
- Source: clinician protocol choices.
- Mode: manual required.

### 12) Family Involvement and Parent Education

- Parent participation narrative plus at least two parent education goals.
- Parent goal fields mirror baseline structure from treatment goals.
- Source: caregiver training plan.
- Mode: manual required with reusable goal templates.

### 13) Exit Plan (Discharge/Transition)

- Anticipated discharge date, graduation criteria, transition plan, documentation steps.
- Source: progress trend + clinical judgment.
- Mode: manual with system-calculated progress reference.

### 14) Recommendations

- Clinical recommendation table with CPT rows and requested units/visits.
- Includes supervision ratio justification and medical necessity rationale.
- Source: authorization request strategy + clinician recommendation.
- Mode: mixed:
  - CPT rows pre-seeded.
  - requested units and narrative manually entered.

## Normalization notes for this template variant

- The docx extractor emits split/truncated labels in some runs (`st Member Observation`, `s phone number`, etc.); these are normalized to canonical labels above.
- Header/footer noise labels (`Retrieved from https`, mixed date-ID headers) are ignored for data capture.
- Image placeholders/graphs are represented as attachment slots, not inline text fields.

## Output contract for implementation

- Every extracted field must resolve to one of:
  - `AUTO`: direct DB/source mapping.
  - `ASSISTED`: AI-suggested draft requiring review.
  - `MANUAL`: clinician-entered required value.
- No goal/program record is created without explicit BCBA acceptance in staged flow.
