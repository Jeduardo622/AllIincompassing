-- @migration-intent: Enforce goal-target measurement payload shape for every raw trial insert or update, including direct public-finalizer calls.
-- @migration-dependencies: 20260711140753_fix_goal_target_draft_version_validation.sql
-- @migration-rollback: Drop trial_events_validate_measurement_payload and app.validate_trial_event_measurement_payload only after the finalizer is no longer directly executable by authenticated users.

begin;

alter table public.trial_events
  drop constraint if exists trial_events_value_nonnegative,
  add constraint trial_events_value_nonnegative
  check (value is null or (value <> 'NaN'::numeric and value >= 0));

create or replace function app.validate_trial_event_measurement_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_measurement_type text;
begin
  select targets.measurement_type into v_measurement_type
  from public.goal_targets targets
  where targets.id = new.target_id
    and targets.organization_id = new.organization_id
    and targets.client_id = new.client_id;
  if not found then
    raise exception using errcode = '23514', message = 'trial target is out of scope';
  end if;

  if v_measurement_type in ('correctIncorrect', 'taskAnalysis') then
    if new.response is null or char_length(btrim(new.response)) = 0 then
      raise exception using errcode = '22023', message = 'response is required for this target measurement type';
    end if;
    if new.value is not null then
      raise exception using errcode = '22023', message = 'value is not allowed for this target measurement type';
    end if;
  elsif v_measurement_type in ('frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT') then
    if new.value is null then
      raise exception using errcode = '22023', message = 'value is required for this target measurement type';
    end if;
    if new.value = 'NaN'::numeric or new.value < 0 then
      raise exception using errcode = '22023', message = 'value must be nonnegative';
    end if;
    if new.response is not null and char_length(btrim(new.response)) > 0 then
      raise exception using errcode = '22023', message = 'response is not allowed for this target measurement type';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function app.validate_trial_event_measurement_payload()
  from public, anon, authenticated, service_role;

drop trigger if exists trial_events_validate_measurement_payload on public.trial_events;
create trigger trial_events_validate_measurement_payload
before insert or update of target_id, organization_id, client_id, response, value
on public.trial_events
for each row execute function app.validate_trial_event_measurement_payload();

commit;
