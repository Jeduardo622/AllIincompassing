-- @migration-intent: session_audit_created_by_typo_repair
-- @migration-dependencies: 20250917183451_add_session_audit_fields.sql
-- @migration-rollback: restore the prior public.set_sessions_audit_fields() body if the hosted typo must be reintroduced for comparison.

begin;

create or replace function public.set_sessions_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user uuid;
begin
  v_auth_user := auth.uid();

  if tg_op = 'INSERT' then
    if new.updated_at is null then
      new.updated_at := timezone('utc', now());
    end if;

    if new.created_by is null and v_auth_user is not null then
      new.created_by := v_auth_user;
    end if;

    if new.updated_by is null then
      if v_auth_user is not null then
        new.updated_by := v_auth_user;
      elsif new.created_by is not null then
        new.updated_by := new.created_by;
      end if;
    end if;

    if new.created_by is null and new.updated_by is not null then
      new.created_by := new.updated_by;
    end if;
  elsif tg_op = 'UPDATE' then
    new.updated_at := timezone('utc', now());

    if new.created_by is null then
      new.created_by := old.created_by;
    end if;

    if new.updated_by is null then
      if v_auth_user is not null then
        new.updated_by := v_auth_user;
      elsif old.updated_by is not null then
        new.updated_by := old.updated_by;
      elsif old.created_by is not null then
        new.updated_by := old.created_by;
      elsif new.created_by is not null then
        new.updated_by := new.created_by;
      end if;
    end if;

    if new.created_by is null and new.updated_by is not null then
      new.created_by := new.updated_by;
    end if;
  end if;

  return new;
end;
$$;

commit;
