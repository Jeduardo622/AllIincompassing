-- @migration-intent: Allow client_session_notes.goal_ids to store ad-hoc capture keys (adhoc-skill-|adhoc-bx-) alongside goals.id UUID strings.
-- @migration-dependencies: 20260204193000_programs_goals_bank.sql
-- @migration-rollback: Manually revert only if every goal_ids element is a UUID: cast column back to uuid[] with a vetted USING expression; ad-hoc string keys must be removed first.

-- Postgres rejects subqueries directly inside ALTER COLUMN ... USING. Use a short-lived SQL helper, then drop it.

begin;

create or replace function public.__migration_client_session_notes_goal_ids_uuid_to_text(p_goal_ids uuid[])
returns text[]
language sql
immutable
as $function$
  select case
    when p_goal_ids is null then null::text[]
    else coalesce(
      (
        select array_agg(u::text order by ord)
        from unnest(p_goal_ids) with ordinality as t(u, ord)
      ),
      array[]::text[]
    )
  end;
$function$;

alter table public.client_session_notes
  alter column goal_ids drop default;

alter table public.client_session_notes
  alter column goal_ids type text[]
  using (public.__migration_client_session_notes_goal_ids_uuid_to_text(goal_ids));

alter table public.client_session_notes
  alter column goal_ids set default '{}'::text[];

drop function public.__migration_client_session_notes_goal_ids_uuid_to_text(uuid[]);

comment on column public.client_session_notes.goal_ids is
  'Per-note goal keys: public.goals.id (UUID text) and/or ad-hoc session capture ids (adhoc-skill-|adhoc-bx- prefix).';

commit;
