-- Create base CPT linkage tables if missing (non-destructive, idempotent)
set search_path = public;

-- billing_modifiers (catalog)
create table if not exists public.billing_modifiers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  billing_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_modifiers_code_unique unique (code),
  constraint billing_modifiers_code_format check (code ~ '^[A-Z0-9]{2,4}$')
);

alter table public.billing_modifiers enable row level security;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='billing_modifiers' and policyname='Billing modifiers select';
  if not found then
    create policy "Billing modifiers select"
      on public.billing_modifiers
      for select
      to authenticated
      using (true);
  end if;
end $$;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='billing_modifiers' and policyname='Billing modifiers service role';
  if not found then
    create policy "Billing modifiers service role"
      on public.billing_modifiers
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- session_cpt_entries
create table if not exists public.session_cpt_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  session_id uuid not null references public.sessions(id) on delete cascade,
  cpt_code_id uuid not null references public.cpt_codes(id) on delete restrict,
  line_number integer not null default 1,
  units numeric(6,2) not null default 1,
  billed_minutes integer null,
  rate numeric null,
  is_primary boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_cpt_entries_line_unique unique (session_id, line_number)
);

-- unique primary line per session (partial unique index)
create unique index if not exists session_cpt_entries_primary_unique
  on public.session_cpt_entries (session_id)
  where is_primary;

create index if not exists session_cpt_entries_session_id_idx
  on public.session_cpt_entries (session_id);

create index if not exists session_cpt_entries_org_session_idx
  on public.session_cpt_entries (organization_id, session_id);

alter table public.session_cpt_entries enable row level security;

-- Therapist/admin scoped policies based on owning session
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_entries' and policyname='Session CPT entries scoped select';
  if not found then
    create policy "Session CPT entries scoped select"
      on public.session_cpt_entries
      for select
      to authenticated
      using (
        app.is_admin() OR EXISTS (
          select 1 from public.sessions s
          where s.id = public.session_cpt_entries.session_id
            and s.therapist_id = auth.uid()
        )
      );
  end if;
end $$;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_entries' and policyname='Session CPT entries scoped insert';
  if not found then
    create policy "Session CPT entries scoped insert"
      on public.session_cpt_entries
      for insert
      to authenticated
      with check (
        app.is_admin() OR EXISTS (
          select 1 from public.sessions s
          where s.id = public.session_cpt_entries.session_id
            and s.therapist_id = auth.uid()
        )
      );
  end if;
end $$;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_entries' and policyname='Session CPT entries scoped update';
  if not found then
    create policy "Session CPT entries scoped update"
      on public.session_cpt_entries
      for update
      to authenticated
      using (
        app.is_admin() OR EXISTS (
          select 1 from public.sessions s
          where s.id = public.session_cpt_entries.session_id
            and s.therapist_id = auth.uid()
        )
      )
      with check (
        app.is_admin() OR EXISTS (
          select 1 from public.sessions s
          where s.id = public.session_cpt_entries.session_id
            and s.therapist_id = auth.uid()
        )
      );
  end if;
end $$;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_entries' and policyname='Session CPT entries scoped delete';
  if not found then
    create policy "Session CPT entries scoped delete"
      on public.session_cpt_entries
      for delete
      to authenticated
      using (
        app.is_admin() OR EXISTS (
          select 1 from public.sessions s
          where s.id = public.session_cpt_entries.session_id
            and s.therapist_id = auth.uid()
        )
      );
  end if;
end $$;

-- service role can manage
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_entries' and policyname='Session CPT entries service role access';
  if not found then
    create policy "Session CPT entries service role access"
      on public.session_cpt_entries
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- session_cpt_modifiers (link each entry to modifiers catalog)
create table if not exists public.session_cpt_modifiers (
  session_cpt_entry_id uuid not null references public.session_cpt_entries(id) on delete cascade,
  modifier_id uuid not null references public.billing_modifiers(id) on delete cascade,
  position integer not null,
  constraint session_cpt_modifiers_entry_position_unique unique (session_cpt_entry_id, position)
);

create index if not exists session_cpt_modifiers_entry_id_idx
  on public.session_cpt_modifiers (session_cpt_entry_id);

create index if not exists session_cpt_modifiers_modifier_id_idx
  on public.session_cpt_modifiers (modifier_id);

alter table public.session_cpt_modifiers enable row level security;

-- Access aligned with owning session via entry
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_modifiers' and policyname='Session CPT modifiers scoped access';
  if not found then
    create policy "Session CPT modifiers scoped access"
      on public.session_cpt_modifiers
      for all
      to authenticated
      using (
        app.is_admin() OR EXISTS (
          select 1
          from public.session_cpt_entries e
          join public.sessions s on s.id = e.session_id
          where e.id = public.session_cpt_modifiers.session_cpt_entry_id
            and s.therapist_id = auth.uid()
        )
      )
      with check (
        app.is_admin() OR EXISTS (
          select 1
          from public.session_cpt_entries e
          join public.sessions s on s.id = e.session_id
          where e.id = public.session_cpt_modifiers.session_cpt_entry_id
            and s.therapist_id = auth.uid()
        )
      );
  end if;
end $$;

do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='session_cpt_modifiers' and policyname='Session CPT modifiers service role';
  if not found then
    create policy "Session CPT modifiers service role"
      on public.session_cpt_modifiers
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;


