// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
import { selectSuite } from '../utils/testControls.ts';

const POSTGRES_URL = process.env.WIN211_POSTGRES_URL;
const runIfPostgres = selectSuite({
  run: Boolean(POSTGRES_URL),
  reason: 'WIN211_POSTGRES_URL is not configured',
});
const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260709170000_quarantine_stale_user_therapist_links.sql'
);
const QUARANTINE_BATCH = '20260709170000_quarantine_stale_user_therapist_links';

const ids = {
  orgA: '00000000-0000-0000-0000-0000000000a1',
  orgB: '00000000-0000-0000-0000-0000000000b1',
  validUser: '00000000-0000-0000-0000-000000000101',
  missingOrgUser: '00000000-0000-0000-0000-000000000102',
  crossOrgUser: '00000000-0000-0000-0000-000000000103',
  missingRoleUser: '00000000-0000-0000-0000-000000000104',
  newStaleUser: '00000000-0000-0000-0000-000000000105',
  therapistA: '00000000-0000-0000-0000-000000000201',
  therapistInactive: '00000000-0000-0000-0000-000000000202',
  validLink: '00000000-0000-0000-0000-000000000301',
  missingOrgLink: '00000000-0000-0000-0000-000000000302',
  crossOrgLink: '00000000-0000-0000-0000-000000000303',
  inactiveTherapistLink: '00000000-0000-0000-0000-000000000304',
  missingRoleLink: '00000000-0000-0000-0000-000000000305',
  newStaleLink: '00000000-0000-0000-0000-000000000306',
};

const queryArray = async (client, sql, values = []) => {
  const result = await client.query(sql, values);
  return result.rows.map((row) => row.value);
};

const resetHarness = async (client) => {
  await client.query(`
    create extension if not exists pgcrypto;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;

    drop table if exists public.user_therapist_links_quarantine cascade;
    drop table if exists public.user_therapist_links cascade;
    drop table if exists public.therapists cascade;
    drop table if exists public.user_roles cascade;
    drop table if exists public.roles cascade;
    drop table if exists public.win211_user_orgs cascade;
    drop schema if exists app cascade;

    create schema app;
    create table public.win211_user_orgs (
      user_id uuid primary key,
      organization_id uuid
    );
    create function app.resolve_user_organization_id(target_user_id uuid)
    returns uuid
    language sql
    stable
    as $$
      select organization_id
      from public.win211_user_orgs
      where user_id = target_user_id
    $$;

    create table public.therapists (
      id uuid primary key,
      organization_id uuid,
      status text,
      deleted_at timestamptz
    );
    create table public.roles (
      id uuid primary key default gen_random_uuid(),
      name text not null unique
    );
    create table public.user_roles (
      user_id uuid not null,
      role_id uuid not null references public.roles(id),
      is_active boolean,
      expires_at timestamptz
    );
    create table public.user_therapist_links (
      id uuid primary key,
      user_id uuid not null,
      therapist_id uuid not null,
      created_at timestamptz not null default now()
    );
  `);
};

const seedHarness = async (client) => {
  await client.query(`
    insert into public.roles (name)
    values ('therapist'), ('bt'), ('admin'), ('client')
    on conflict (name) do nothing;
  `);
  await client.query(
    `
      insert into public.win211_user_orgs (user_id, organization_id)
      values
        ($1, $2),
        ($3, null),
        ($4, $5),
        ($6, $2);
    `,
    [ids.validUser, ids.orgA, ids.missingOrgUser, ids.crossOrgUser, ids.orgB, ids.missingRoleUser]
  );
  await client.query(
    `
      insert into public.therapists (id, organization_id, status, deleted_at)
      values
        ($1, $2, 'active', null),
        ($3, $2, 'inactive', null);
    `,
    [ids.therapistA, ids.orgA, ids.therapistInactive]
  );
  await client.query(
    `
      insert into public.user_roles (user_id, role_id, is_active, expires_at)
      select $1::uuid, id, true, null::timestamptz from public.roles where name = 'therapist'
      union all select $2::uuid, id, true, null::timestamptz from public.roles where name = 'bt'
      union all select $3::uuid, id, true, null::timestamptz from public.roles where name = 'admin'
      union all select $4::uuid, id, true, null::timestamptz from public.roles where name = 'client';
    `,
    [ids.validUser, ids.missingOrgUser, ids.crossOrgUser, ids.missingRoleUser]
  );
  await client.query(
    `
      insert into public.user_therapist_links (id, user_id, therapist_id, created_at)
      values
        ($1, $2, $3, '2026-07-01T00:00:00Z'),
        ($4, $5, $3, '2026-07-01T00:00:00Z'),
        ($6, $7, $3, '2026-07-01T00:00:00Z'),
        ($8, $2, $9, '2026-07-01T00:00:00Z'),
        ($10, $11, $3, '2026-07-01T00:00:00Z');
    `,
    [
      ids.validLink,
      ids.validUser,
      ids.therapistA,
      ids.missingOrgLink,
      ids.missingOrgUser,
      ids.crossOrgLink,
      ids.crossOrgUser,
      ids.inactiveTherapistLink,
      ids.therapistInactive,
      ids.missingRoleLink,
      ids.missingRoleUser,
    ]
  );
};

runIfPostgres('stale user therapist link cleanup migration postgres execution', () => {
  let client;
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');

  beforeAll(async () => {
    client = new Client({ connectionString: POSTGRES_URL });
    await client.connect();
    await resetHarness(client);
    await seedHarness(client);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('executes the real migration twice and only deletes links that still evaluate stale', async () => {
    await client.query(migrationSql);

    await expect(
      queryArray(client, 'select id as value from public.user_therapist_links order by id')
    ).resolves.toEqual([ids.validLink]);
    await expect(
      queryArray(client, 'select link_id as value from public.user_therapist_links_quarantine order by link_id')
    ).resolves.toEqual([
      ids.missingOrgLink,
      ids.crossOrgLink,
      ids.inactiveTherapistLink,
      ids.missingRoleLink,
    ]);

    await client.query(migrationSql);
    await expect(
      queryArray(client, 'select link_id as value from public.user_therapist_links_quarantine order by link_id')
    ).resolves.toHaveLength(4);

    await client.query(
      `
        insert into public.user_therapist_links (id, user_id, therapist_id, created_at)
        values ($1, $2, $3, '2026-07-01T00:00:00Z')
      `,
      [ids.missingOrgLink, ids.missingOrgUser, ids.therapistA]
    );
    await client.query(
      `
        update public.win211_user_orgs
        set organization_id = $1
        where user_id = $2
      `,
      [ids.orgA, ids.missingOrgUser]
    );

    await client.query(migrationSql);
    await expect(
      queryArray(client, 'select id as value from public.user_therapist_links order by id')
    ).resolves.toEqual([ids.validLink, ids.missingOrgLink]);
    await expect(
      queryArray(client, 'select link_id as value from public.user_therapist_links_quarantine order by link_id')
    ).resolves.toHaveLength(4);

    await client.query('insert into public.win211_user_orgs (user_id, organization_id) values ($1, null)', [
      ids.newStaleUser,
    ]);
    await client.query(
      `
        insert into public.user_roles (user_id, role_id, is_active, expires_at)
        select $1::uuid, id, true, null::timestamptz from public.roles where name = 'bt'
      `,
      [ids.newStaleUser]
    );
    await client.query(
      `
        insert into public.user_therapist_links (id, user_id, therapist_id, created_at)
        values ($1, $2, $3, '2026-07-01T00:00:00Z')
      `,
      [ids.newStaleLink, ids.newStaleUser, ids.therapistA]
    );

    await client.query(migrationSql);
    await expect(
      queryArray(client, 'select id as value from public.user_therapist_links order by id')
    ).resolves.toEqual([ids.validLink, ids.missingOrgLink]);
    await expect(
      queryArray(client, 'select link_id as value from public.user_therapist_links_quarantine order by link_id')
    ).resolves.toEqual([
      ids.missingOrgLink,
      ids.crossOrgLink,
      ids.inactiveTherapistLink,
      ids.missingRoleLink,
      ids.newStaleLink,
    ]);

    await expect(
      queryArray(
        client,
        `
          select grantee || ':' || privilege_type as value
          from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'user_therapist_links_quarantine'
            and grantee in ('anon', 'authenticated', 'service_role')
          order by value
        `
      )
    ).resolves.toEqual(['service_role:SELECT']);
    await expect(
      client.query(
        `
          select relrowsecurity, relforcerowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'user_therapist_links_quarantine'
        `
      )
    ).resolves.toMatchObject({ rows: [{ relrowsecurity: true, relforcerowsecurity: true }] });
    await expect(
      client.query(
        `
          select policyname, cmd, roles, qual, with_check
          from pg_policies
          where schemaname = 'public'
            and tablename = 'user_therapist_links_quarantine'
        `
      )
    ).resolves.toMatchObject({
      rows: [
        {
          policyname: 'user_therapist_links_quarantine_service_role_select',
          cmd: 'SELECT',
          roles: '{service_role}',
          qual: 'true',
          with_check: null,
        },
      ],
    });
    await expect(
      client.query(
        'select count(*)::int as count from public.user_therapist_links_quarantine where quarantine_batch = $1',
        [QUARANTINE_BATCH]
      )
    ).resolves.toMatchObject({ rows: [{ count: 5 }] });
  });
});
