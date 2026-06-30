/*
  @migration-intent: Seed the Supervision Session Note template extracted from the provided template screenshot so the field contract exists in Supabase before UI/UX work.
  @migration-dependencies: 20250923120000_baseline_legacy_note_and_pattern_tables.sql, 20250923121500_enforce_org_scope.sql
  @migration-rollback: Delete rows from public.session_note_templates where template_type = 'supervision_session_note' and template_name = 'Supervision Session Note' if the template is intentionally retired before use.
*/

begin;

with extracted_template as (
  select
    'Supervision Session Note'::text as template_name,
    'supervision_session_note'::text as template_type,
    'Supervision note completed by a supervising admin after a BT/RBT session is finished.'::text as description,
    $${
      "version": 1,
      "source": {
        "type": "provided_png",
        "file_name": "image-1.png",
        "extracted_at": "2026-06-29"
      },
      "workflow": {
        "trigger": "bt_session_finished",
        "assigned_role": "supervising_admin",
        "notification": {
          "recipient_role": "supervising_admin",
          "reason": "complete_supervision_session_note"
        }
      },
      "sections": [
        {
          "key": "billing_and_location",
          "label": "Supervision Session Note",
          "fields": [
            {"key": "place_of_service", "label": "Place of Service", "type": "text", "required": false},
            {"key": "modifier_1", "label": "Modifier1", "type": "text", "required": false},
            {"key": "modifier_2", "label": "Modifier2", "type": "text", "required": false},
            {"key": "modifier_3", "label": "Modifier3", "type": "text", "required": false},
            {"key": "modifier_4", "label": "Modifier4", "type": "text", "required": false},
            {"key": "billing_code", "label": "Billing Code", "type": "text", "required": false}
          ]
        },
        {
          "key": "purpose_of_session",
          "label": "Purpose of Session",
          "required": true,
          "fields": [
            {
              "key": "purpose_of_session",
              "label": "Purpose of Session",
              "type": "checkbox_group",
              "required": true,
              "options": [
                "Direct Supervision",
                "Assessment or Ongoing Assessment",
                "Treatment Planning",
                "Team Collaboration",
                "Parent Training",
                "Other"
              ],
              "other_field_key": "purpose_of_session_other"
            },
            {"key": "purpose_of_session_other", "label": "Other", "type": "text", "required_when": "purpose_of_session includes Other"}
          ]
        },
        {
          "key": "supervision_updates",
          "label": "Updates, progress or comments on specific goals addressed during supervision",
          "fields": [
            {
              "key": "supervision_goal_updates",
              "label": "Updates, progress or comments on specific goals addressed during supervision",
              "type": "textarea",
              "required": false,
              "placeholder": "Include any updates, programs or comments on specific goals addressed during supervision"
            }
          ]
        },
        {
          "key": "daily_summary_sheet",
          "label": "Daily Summary Sheet",
          "fields": [
            {
              "key": "daily_summary_data_points_scope",
              "label": "Daily Summary Sheet",
              "type": "radio_group",
              "required": false,
              "options": ["Include Only Linked Data Points", "Include ALL data points"]
            },
            {
              "key": "link_unlinked_data_for_same_user_client_day",
              "label": "Click here to link all unlinked data for same user and client for the day",
              "type": "checkbox",
              "required": false
            },
            {"key": "daily_summary_collected_by", "label": "Collected By", "type": "select", "required": false}
          ]
        },
        {
          "key": "rbt_bt",
          "label": "Registered Behavior Technician/Behavior Technician",
          "fields": [
            {
              "key": "rbt_in_attendance",
              "label": "Was the RBT in attendance?",
              "type": "radio_group",
              "required": true,
              "options": ["Yes", "No"]
            },
            {
              "key": "rbt_support_received",
              "label": "RBT/BT was present and received the following support",
              "type": "checkbox_group",
              "required": true,
              "options": [
                "N/A RBT/BT was not present during session",
                "Modeled strategies/interventions",
                "Problem-solved concerns",
                "Discussed programs/progress/data collection",
                "Other"
              ],
              "other_field_key": "rbt_support_other"
            },
            {
              "key": "rbt_support_other",
              "label": "Other",
              "type": "text",
              "required_when": "rbt_support_received includes Other",
              "placeholder": "If other was checked above, include details here"
            }
          ]
        },
        {
          "key": "strategies_and_interventions_used",
          "label": "Strategies and Interventions Used",
          "fields": [
            {
              "key": "skill_strategies_interventions_used",
              "label": "Skill Strategies/Interventions Used",
              "type": "checkbox_group",
              "required": false,
              "options": [
                "N/A",
                "Modeling/Role Play",
                "Natural Environment Teaching",
                "Discrete Trial Training",
                "Providing support with prompt fading",
                "Shaping",
                "Chaining",
                "Behavior Momentum",
                "Generalization",
                "Maintenance",
                "Other"
              ],
              "other_field_key": "skill_strategies_other"
            },
            {
              "key": "skill_strategies_other",
              "label": "Other",
              "type": "text",
              "required_when": "skill_strategies_interventions_used includes Other",
              "help_text": "List other Strategies/Interventions used"
            },
            {
              "key": "behavior_strategies_interventions_used",
              "label": "Behavior Strategies/Interventions Used",
              "type": "checkbox_group",
              "required": true,
              "options": [
                "N/A",
                "Modeling",
                "Verbal Reminders",
                "Differential Reinforcement",
                "Contingent Rewards/Reinforcement",
                "First/Then Statements",
                "Visual Support",
                "Functional Communication Training",
                "Other"
              ],
              "other_field_key": "behavior_strategies_other"
            },
            {
              "key": "behavior_strategies_other",
              "label": "Other",
              "type": "text",
              "required_when": "behavior_strategies_interventions_used includes Other",
              "help_text": "List other Strategies/Interventions used"
            }
          ]
        },
        {
          "key": "coordination_of_care",
          "label": "Coordination of Care",
          "required": true,
          "fields": [
            {
              "key": "coordination_of_care",
              "label": "Coordination of Care",
              "type": "radio_group",
              "required": true,
              "options": [
                "No team collaboration occurred during this session",
                "The following collaboration occurred"
              ]
            },
            {
              "key": "team_members_involved",
              "label": "Team members that were involved in the supervision meeting",
              "type": "textarea",
              "required": false,
              "placeholder": "Enter N/A if applicable; Enter team member names and titles"
            },
            {
              "key": "focus_of_collaboration",
              "label": "Focus of collaboration",
              "type": "textarea",
              "required": false,
              "placeholder": "Enter N/A if applicable"
            }
          ]
        },
        {
          "key": "client_response_to_treatment",
          "label": "Client Response to Treatment",
          "fields": [
            {
              "key": "client_response_to_treatment",
              "label": "Client Response to Treatment",
              "type": "textarea",
              "required": false,
              "placeholder": "Describe the client's affect and demeanor during the session. In addition, review areas of progress and areas of need."
            }
          ]
        },
        {
          "key": "session_note",
          "label": "Session Note",
          "fields": [
            {
              "key": "session_note_description",
              "label": "Session Note",
              "type": "textarea",
              "required": false,
              "placeholder": "ABA Treatment session with member _____, age ___, male/female, Member continues show"
            }
          ]
        },
        {
          "key": "team_signatures",
          "label": "Team Signatures",
          "fields": [
            {"key": "mid_tier_supervisor_signature", "label": "Mid tier supervisor", "type": "signature", "required": false},
            {"key": "mid_tier_licensure_credential", "label": "Mid tiers Licensure/Credential", "type": "text", "required": false},
            {"key": "bcba_supervisor_signature", "label": "BCBA supervisor", "type": "signature", "required": false},
            {"key": "bcba_licensure_credential", "label": "Licensure/Credential: BCBA", "type": "text", "required": false},
            {"key": "parent_guardian_digital_signature", "label": "Parent/Guardian Digital Signature", "type": "signature", "required": false},
            {"key": "parent_guardian_name", "label": "Parent/Guardian Name", "type": "text", "required": false},
            {"key": "parent_guardian_relationship", "label": "Relationship", "type": "text", "required": false},
            {"key": "rbt_bt_licensure_credential", "label": "RBT/BT Licensure/Credential", "type": "text", "required": false}
          ]
        }
      ]
    }$$::jsonb as template_structure,
    '{"payer": "ABA", "state": "CA", "source": "provided supervision session note screenshot"}'::jsonb as compliance_requirements
)
insert into public.session_note_templates (
  template_name,
  template_type,
  template_structure,
  description,
  compliance_requirements,
  is_california_compliant,
  organization_id,
  created_at,
  updated_at
)
select
  extracted_template.template_name,
  extracted_template.template_type,
  extracted_template.template_structure,
  extracted_template.description,
  extracted_template.compliance_requirements,
  true,
  organizations.id,
  now(),
  now()
from public.organizations
cross join extracted_template
where not exists (
  select 1
  from public.session_note_templates existing
  where existing.organization_id = organizations.id
    and existing.template_name = extracted_template.template_name
    and existing.template_type = extracted_template.template_type
);

do $$
declare
  expected_count integer;
  actual_count integer;
begin
  select count(*) into expected_count from public.organizations;

  select count(distinct organization_id)
  into actual_count
  from public.session_note_templates
  where template_name = 'Supervision Session Note'
    and template_type = 'supervision_session_note';

  if expected_count > 0 and actual_count < expected_count then
    raise exception 'Supervision Session Note template seed incomplete: expected % organization rows, found %', expected_count, actual_count;
  end if;
end
$$;

commit;
