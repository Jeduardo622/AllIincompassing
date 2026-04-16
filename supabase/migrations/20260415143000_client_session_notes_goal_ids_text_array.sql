-- @migration-intent: Allow client_session_notes.goal_ids to store ad-hoc capture keys (adhoc-skill-|adhoc-bx-) alongside goals.id UUID strings.
-- @migration-dependencies: 20260204193000_programs_goals_bank.sql
-- @migration-rollback: Manually revert only if every goal_ids element is a UUID: cast column back to uuid[] with a vetted USING expression; ad-hoc string keys must be removed first.

begin;

alter table public.client_session_notes
  alter column goal_ids drop default;

alter table public.client_session_notes
  alter column goal_ids type text[]
  using (
    case
      when goal_ids is null then null::text[]
      else array(select unnest(goal_ids)::text)
    end
  );

alter table public.client_session_notes
  alter column goal_ids set default '{}'::text[];

comment on column public.client_session_notes.goal_ids is
  'Per-note goal keys: public.goals.id (UUID text) and/or ad-hoc session capture ids (adhoc-skill-|adhoc-bx- prefix).';

commit;
