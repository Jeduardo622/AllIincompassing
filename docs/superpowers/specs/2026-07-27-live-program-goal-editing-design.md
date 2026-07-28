# Live Program, Goal, and Skill Editing Design

## Goal

Allow authorized users to edit live program and goal/skill blocks after either manual creation or accepted assessment promotion, with one consistent authorization contract at the UI, API/Edge, and RLS layers.

## Approved role contract

- May manage Programs & Goals: `admin`, `midtier`, `bcba`, `super_admin`.
- Read-only: `bt`, `therapist`, `admin_schedule`, clients, and guardians.
- Authorization source of truth: active, non-expired organization-scoped `user_roles`, evaluated through `current_user_can_manage_programs_goals`.
- `super_admin` retains the existing trusted global bypass in the exact-role helper.

## Data-flow design

Manual creation writes directly to live `programs` and `goals`. Assessment promotion validates accepted draft records and copies them into those same live tables. The live editor therefore operates only on live records and does not merge the draft and live persistence models.

Draft acceptance state, review notes, extraction provenance, publish rollback, and review history remain in the assessment workflow. Published records use the existing live program and goal mutation endpoints.

## Editing behavior

### Programs

The live program card exposes inline editing for:

- `name`
- `description`

Status remains controlled by the existing archive/remove lifecycle.

### Goals and skills

Skills are goals whose `clinical_goal_type` is `skill`; they do not receive a separate authorization or storage model.

The live goal card exposes inline editing for:

- `title`
- `description`
- `clinical_goal_type`
- `domain_id`
- `measurement_type`
- `baseline_data` / `baseline`
- short-, intermediate-, and long-term target criteria
- `mastery_criteria`
- `maintenance_criteria`
- `generalization_criteria`
- `teaching_strategies`
- `operational_definition`
- `objective_data_points`
- `status`, except progression-owned target state

Published provenance stays immutable:

- `source`
- `original_text`
- organization, client, and creation identity

Goal-target editing and progression remain separate existing controls.

## Authorization design

All Programs & Goals mutation affordances fail closed behind `manageProgramsGoals`, including create, edit, archive, draft review, checklist review, publish, and program-note creation.

All protected handlers use `currentUserCanManageProgramsGoals` for mutations instead of legacy booleans such as `isTherapist`, `isAdmin`, and `isSuperAdmin`. Read paths retain their existing scoped read contract.

The database helper and policies enforce the same role set. `therapist` is removed from the manage helper, and stale `program_notes` policies are aligned to the canonical helper. Organization, client, program, goal, and domain scope checks remain mandatory.

## Error handling

- Invalid or empty edits remain client-disabled and server-rejected.
- Authorization lookup failures fail closed and return an upstream validation error.
- Unauthorized roles receive `403` without issuing the mutation.
- Out-of-organization and mismatched client/program/domain updates remain rejected.
- Failed mutations keep the editor open with the submitted values and show the existing toast error.
- Successful mutations update the React Query cache and then invalidate the scoped query for server truth.

## Verification

Tests must prove:

- positive edits for `admin`, `midtier`, `bcba`, and `super_admin`;
- negative mutation access for `bt`/`therapist` and `admin_schedule`;
- identical live editing for manually created and promoted records;
- program and goal payload correctness;
- immutable provenance exclusion;
- organization/client/domain scope preservation;
- UI mutation controls are absent for read-only roles;
- migration/RLS helper parity.

The critical-lane verification union is:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- focused Vitest files
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run test:routes:tier0`
- `npm run ci:playwright` when the required credentials are available
- `npm run verify:local` when all required local checks are secret-free

## Non-goals

- No draft/live table merge.
- No extraction or document-generation changes.
- No changes to goal-target progression algorithms.
- No hard-delete expansion.
- No broad Programs & Goals visual redesign.
- No edits to real customer data or environment secrets.
