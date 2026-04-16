-- @migration-intent: Upgrade client_session_notes.goal_ids from uuid[] to text[] when a prior migration attempt left the column as uuid[] (invalid USING subquery on Postgres).
-- @migration-dependencies: 20260415143000_client_session_notes_goal_ids_text_array.sql
-- @migration-rollback: Not automated; after success the column is text[] and may already contain ad-hoc string keys.

begin;

do $repair$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_session_notes'
      and column_name = 'goal_ids'
      and udt_name = '_uuid'
  ) then
    create or replace function public.__migration_repair_csn_goal_ids_uuid_to_text(p_goal_ids uuid[])
    returns text[]
    language sql
    immutable
    as $fn$
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
    $fn$;

    alter table public.client_session_notes
      alter column goal_ids drop default;

    alter table public.client_session_notes
      alter column goal_ids type text[]
      using (public.__migration_repair_csn_goal_ids_uuid_to_text(goal_ids));

    alter table public.client_session_notes
      alter column goal_ids set default '{}'::text[];

    drop function public.__migration_repair_csn_goal_ids_uuid_to_text(uuid[]);
  end if;
end;
$repair$;

commit;
