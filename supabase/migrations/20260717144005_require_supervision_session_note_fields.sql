/*
  @migration-intent: Require the supervisor session note fields requested for completed supervision notes across already-seeded tenant templates.
  @migration-dependencies: 20260629233000_create_supervision_session_note_workflow.sql
  @migration-rollback: Update public.session_note_templates to restore the prior optional flags for the affected supervision session note fields if this contract is intentionally reverted.
*/

begin;

do $$
declare
  missing_template_count integer;
begin
  select count(*)
  into missing_template_count
  from public.organizations as organization
  where not exists (
    select 1
    from public.session_note_templates as template
    where template.organization_id = organization.id
      and template.template_type = 'supervision_session_note'
      and template.template_name = 'Supervision Session Note'
  );

  if missing_template_count > 0 then
    raise exception 'Missing Supervision Session Note template for % organization rows', missing_template_count;
  end if;
end
$$;

update public.session_note_templates as template
set
  template_structure = jsonb_set(
    template.template_structure,
    '{sections}',
    (
      select jsonb_agg(
        case
          when section.value ? 'fields' then jsonb_set(
            section.value,
            '{fields}',
            (
              select jsonb_agg(
                case
                  when field.value->>'key' in (
                    'rbt_in_attendance',
                    'skill_strategies_interventions_used',
                    'behavior_strategies_interventions_used',
                    'coordination_of_care',
                    'client_response_to_treatment',
                    'session_note_description'
                  ) then jsonb_set(field.value, '{required}', 'true'::jsonb, true)
                  else field.value
                end
                order by field.ordinality
              )
              from jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) with ordinality as field(value, ordinality)
            ),
            true
          )
          else section.value
        end
        order by section.ordinality
      )
      from jsonb_array_elements(coalesce(template.template_structure->'sections', '[]'::jsonb)) with ordinality as section(value, ordinality)
    ),
    true
  ),
  updated_at = timezone('utc', now())
where template.template_type = 'supervision_session_note'
  and template.template_name = 'Supervision Session Note';

do $$
declare
  missing_required_count integer;
begin
  select count(*)
  into missing_required_count
  from public.session_note_templates template
  where template.template_type = 'supervision_session_note'
    and template.template_name = 'Supervision Session Note'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(template.template_structure->'sections', '[]'::jsonb)) section(value)
      cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) field(value)
      where field.value->>'key' in (
        'rbt_in_attendance',
        'skill_strategies_interventions_used',
        'behavior_strategies_interventions_used',
        'coordination_of_care',
        'client_response_to_treatment',
        'session_note_description'
      )
      and coalesce((field.value->>'required')::boolean, false) is false
    );

  if missing_required_count > 0 then
    raise exception 'Supervision session note required field backfill incomplete for % template rows', missing_required_count;
  end if;
end
$$;

commit;
