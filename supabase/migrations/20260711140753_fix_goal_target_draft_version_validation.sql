-- @migration-intent: Forward-fix first finalization so the deployed atomic finalizer validates persisted draft trials with their capture-time target versions.
-- @migration-dependencies: 20260710210551_goal_target_automatic_progression.sql
-- @migration-rollback: Drop the wrapper, rename finalize_session_note_with_progression_v1 back to finalize_session_note_with_progression, and restore its grants only after automatic progression is disabled; rollback restores the stale-draft bypass.

begin;

alter function public.finalize_session_note_with_progression(uuid, uuid, jsonb, jsonb, jsonb)
  rename to finalize_session_note_with_progression_v1;

revoke execute on function public.finalize_session_note_with_progression_v1(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function app.guard_trial_event_session_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_session_id uuid := case when tg_op <> 'INSERT' then old.session_id else null end;
  v_new_session_id uuid := case when tg_op <> 'DELETE' then new.session_id else null end;
begin
  if coalesce(v_new_session_id, v_old_session_id) is null then
    raise exception using errcode = '22023', message = 'trial event session is required';
  end if;
  if v_old_session_id is not null and v_new_session_id is not null
     and v_old_session_id <> v_new_session_id then
    perform pg_advisory_xact_lock(hashtextextended(least(v_old_session_id, v_new_session_id)::text, 1));
    perform pg_advisory_xact_lock(hashtextextended(greatest(v_old_session_id, v_new_session_id)::text, 1));
  else
    perform pg_advisory_xact_lock(hashtextextended(coalesce(v_new_session_id, v_old_session_id)::text, 1));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function app.guard_trial_event_session_finalization()
  from public, anon, authenticated, service_role;

drop trigger if exists trial_events_guard_session_finalization on public.trial_events;
create trigger trial_events_guard_session_finalization
before insert or update or delete on public.trial_events
for each row execute function app.guard_trial_event_session_finalization();

create or replace function public.finalize_session_note_with_progression(
  target_session_id uuid,
  target_note_id uuid,
  note_payload jsonb,
  trial_events jsonb default '[]'::jsonb,
  expected_target_versions jsonb default '[]'::jsonb
)
returns table (note jsonb, progression_results jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_combined_trial_events jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if jsonb_typeof(coalesce(trial_events, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(expected_target_versions, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid finalization payload';
  end if;

  select sessions.* into v_session
  from public.sessions sessions
  where sessions.id = target_session_id;
  if not found then
    raise exception using errcode = '22023', message = 'session is not finalized';
  end if;
  if not public.current_user_can_capture_trial_event(v_session.organization_id, v_session.client_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_session_id::text, 1));

  if exists (
    select 1
    from public.trial_events persisted
    where persisted.session_id = target_session_id
      and persisted.organization_id = v_session.organization_id
      and persisted.client_id = v_session.client_id
      and jsonb_typeof(persisted.metadata->'progression_version_at_capture') is distinct from 'number'
  ) then
    raise exception using errcode = '22023', message = 'persisted trial target version is missing';
  end if;

  if exists (
    select 1
    from public.trial_events persisted
    where persisted.session_id = target_session_id
      and persisted.organization_id = v_session.organization_id
      and persisted.client_id = v_session.client_id
      and (
        (persisted.metadata->>'progression_version_at_capture')::numeric < 0
        or (persisted.metadata->>'progression_version_at_capture')::numeric
          <> trunc((persisted.metadata->>'progression_version_at_capture')::numeric)
      )
  ) then
    raise exception using errcode = '22023', message = 'persisted trial target version is invalid';
  end if;

  if exists (
    select 1
    from public.trial_events persisted
    where persisted.session_id = target_session_id
      and persisted.organization_id = v_session.organization_id
      and persisted.client_id = v_session.client_id
    group by persisted.target_id
    having count(distinct persisted.metadata->>'progression_version_at_capture') <> 1
  ) then
    raise exception using errcode = '22023', message = 'persisted trial target versions conflict';
  end if;

  if exists (
    select 1
    from (
      select persisted.target_id,
        min((persisted.metadata->>'progression_version_at_capture')::bigint) as progression_version_at_capture
      from public.trial_events persisted
      where persisted.session_id = target_session_id
        and persisted.organization_id = v_session.organization_id
        and persisted.client_id = v_session.client_id
      group by persisted.target_id
    ) persisted_versions
    where not exists (
      select 1
      from jsonb_array_elements(expected_target_versions) expected
      where expected->>'target_id' = persisted_versions.target_id::text
        and jsonb_typeof(expected->'progression_version') = 'number'
        and (expected->>'progression_version')::numeric = persisted_versions.progression_version_at_capture
    )
  ) then
    raise exception using errcode = '40001', message = 'persisted trial target version does not match expected target versions';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'target_id', persisted.target_id,
    'trial_number', persisted.trial_number,
    'response', persisted.response,
    'prompt_type', persisted.prompt_type,
    'prompt_level', persisted.prompt_level,
    'value', persisted.value,
    'event_timestamp', persisted.event_timestamp,
    'metadata', persisted.metadata
  ) order by persisted.target_id, persisted.trial_number, persisted.id), '[]'::jsonb)
  into v_combined_trial_events
  from public.trial_events persisted
  where persisted.session_id = target_session_id
    and persisted.organization_id = v_session.organization_id
    and persisted.client_id = v_session.client_id;

  v_combined_trial_events := v_combined_trial_events || coalesce(trial_events, '[]'::jsonb);

  return query
  select finalized.note, finalized.progression_results
  from public.finalize_session_note_with_progression_v1(
    target_session_id,
    target_note_id,
    note_payload,
    v_combined_trial_events,
    expected_target_versions
  ) finalized;
end;
$$;

revoke execute on function public.finalize_session_note_with_progression(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.finalize_session_note_with_progression(uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
