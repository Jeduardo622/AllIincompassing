begin;

create or replace function public.record_session_audit(
  p_session_id uuid,
  p_event_type text,
  p_actor_id uuid default null,
  p_event_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, app
as $$
begin
  perform app.record_session_audit(p_session_id, p_event_type, p_actor_id, p_event_payload);
end;
$$;

grant execute on function public.record_session_audit(uuid, text, uuid, jsonb) to authenticated;

commit;
