// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { selectSuite } from '../utils/testControls.ts';

const POSTGRES_URL = process.env.WIN224_POSTGRES_URL;
const runIfPostgres = selectSuite({
  run: Boolean(POSTGRES_URL),
  reason: 'WIN224_POSTGRES_URL is not configured',
});
const migrationSql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260718204735_allow_exact_bt_proof_history_cleanup.sql',
), 'utf8');
const schemaUsageMigrationSql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260718210522_grant_service_role_app_schema_usage.sql',
), 'utf8');
const behaviorMigrationSql = migrationSql
  .replaceAll('app.', 'win224_cleanup_app.')
  .replaceAll('public.', 'win224_cleanup_data.');
const behaviorSchemaUsageMigrationSql = schemaUsageMigrationSql
  .replaceAll('schema app', 'schema win224_cleanup_app');
const cascadeContextMigrationSql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260718210937_preserve_service_role_cleanup_context.sql',
), 'utf8');
const behaviorCascadeContextMigrationSql = cascadeContextMigrationSql
  .replaceAll('app.', 'win224_cleanup_app.')
  .replaceAll('public.', 'win224_cleanup_data.');

const ids = {
  exactOrg: '10000000-0000-4000-8000-000000000001',
  exactActor: '10000000-0000-4000-8000-000000000002',
  ordinaryOrg: '20000000-0000-4000-8000-000000000001',
  ordinaryActor: '20000000-0000-4000-8000-000000000002',
  exactCorrection: '30000000-0000-4000-8000-000000000001',
  ordinaryCorrection: '30000000-0000-4000-8000-000000000002',
  authenticatedCorrection: '30000000-0000-4000-8000-000000000003',
  exactRequest: '40000000-0000-4000-8000-000000000001',
  exactAmendment: '50000000-0000-4000-8000-000000000001',
};

runIfPostgres('WIN-224 proof cleanup trigger behavior', () => {
  const client = new Client({ connectionString: POSTGRES_URL });

  beforeAll(async () => {
    await client.connect();
    await client.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;
      drop schema if exists win224_cleanup_app cascade;
      drop schema if exists win224_cleanup_data cascade;
      create schema win224_cleanup_app;
      create schema win224_cleanup_data;
      create table win224_cleanup_data.organizations (
        id uuid primary key,
        slug text not null,
        metadata jsonb not null default '{}'::jsonb,
        created_by uuid
      );
      create table win224_cleanup_data.profiles (
        id uuid primary key,
        organization_id uuid not null references win224_cleanup_data.organizations(id),
        role text not null,
        is_active boolean not null
      );
      create table win224_cleanup_data.therapists (
        id uuid primary key,
        organization_id uuid not null references win224_cleanup_data.organizations(id),
        email text not null,
        status text not null,
        deleted_at timestamptz
      );
      alter table win224_cleanup_data.organizations
        add constraint organizations_created_by_fkey foreign key (created_by) references win224_cleanup_data.profiles(id);
      create table win224_cleanup_data.supervision_session_note_requests (
        id uuid not null,
        organization_id uuid not null references win224_cleanup_data.organizations(id),
        primary key (id, organization_id)
      );
      create table win224_cleanup_data.supervision_session_note_corrections (
        id uuid primary key,
        organization_id uuid not null references win224_cleanup_data.organizations(id),
        request_id uuid,
        foreign key (request_id, organization_id)
          references win224_cleanup_data.supervision_session_note_requests(id, organization_id)
          on delete cascade
      );
      create table win224_cleanup_data.bt_session_note_amendments (
        id uuid primary key,
        organization_id uuid not null references win224_cleanup_data.organizations(id),
        request_id uuid,
        foreign key (request_id, organization_id)
          references win224_cleanup_data.supervision_session_note_requests(id, organization_id)
          on delete cascade
      );
      create function win224_cleanup_data.prevent_supervision_session_note_corrections_delete()
      returns trigger language plpgsql as $$ begin raise exception 'supervision correction history is immutable'; end $$;
      create function win224_cleanup_data.prevent_bt_session_note_amendment_mutations()
      returns trigger language plpgsql as $$ begin raise exception 'bt session note amendments are immutable'; end $$;
      create trigger supervision_session_note_corrections_prevent_delete before delete on win224_cleanup_data.supervision_session_note_corrections
        for each row execute function win224_cleanup_data.prevent_supervision_session_note_corrections_delete();
      create trigger bt_session_note_amendments_prevent_delete before delete on win224_cleanup_data.bt_session_note_amendments
        for each row execute function win224_cleanup_data.prevent_bt_session_note_amendment_mutations();
      grant usage on schema win224_cleanup_data to service_role, authenticated;
      grant select on win224_cleanup_data.organizations, win224_cleanup_data.profiles, win224_cleanup_data.therapists to service_role, authenticated;
      grant select, delete on win224_cleanup_data.supervision_session_note_requests, win224_cleanup_data.supervision_session_note_corrections, win224_cleanup_data.bt_session_note_amendments to service_role, authenticated;
    `);
    await client.query(behaviorMigrationSql);
    await client.query(behaviorSchemaUsageMigrationSql);
    await client.query(behaviorCascadeContextMigrationSql);
    await client.query(`
      insert into win224_cleanup_data.organizations (id, slug, metadata) values
        ($1, 'bt-proof-bt-aba-proof-1234', '{"tags":["bt-aba-proof-1234"],"notes":"Synthetic fixture bt-aba-proof-1234"}'),
        ($2, 'ordinary-org', '{}');
    `, [ids.exactOrg, ids.ordinaryOrg]);
    await client.query(`
      insert into win224_cleanup_data.profiles values
        ($3, $1, 'bt', true),
        ($4, $2, 'bt', true);
    `, [ids.exactOrg, ids.ordinaryOrg, ids.exactActor, ids.ordinaryActor]);
    await client.query(`
      update win224_cleanup_data.organizations
      set created_by = case when id = $1 then $3::uuid when id = $2 then $4::uuid end
      where id in ($1, $2);
    `, [ids.exactOrg, ids.ordinaryOrg, ids.exactActor, ids.ordinaryActor]);
    await client.query(`
      insert into win224_cleanup_data.therapists values
        ($3, $1, 'playwright.ci.bt.bt-aba-proof-1234@example.com', 'active', null),
        ($4, $2, 'ordinary@example.com', 'active', null);
    `, [ids.exactOrg, ids.ordinaryOrg, ids.exactActor, ids.ordinaryActor]);
    await client.query('insert into win224_cleanup_data.supervision_session_note_requests values ($1, $2)', [ids.exactRequest, ids.exactOrg]);
    await client.query(`
      insert into win224_cleanup_data.supervision_session_note_corrections values
        ($3, $1, $6), ($4, $2, null), ($5, $1, null);
    `, [ids.exactOrg, ids.ordinaryOrg, ids.exactCorrection, ids.ordinaryCorrection, ids.authenticatedCorrection, ids.exactRequest]);
    await client.query('insert into win224_cleanup_data.bt_session_note_amendments values ($1, $2, $3)', [ids.exactAmendment, ids.exactOrg, ids.exactRequest]);
  });

  afterAll(async () => {
    await client.query('reset role');
    await client.query('drop schema if exists win224_cleanup_app cascade; drop schema if exists win224_cleanup_data cascade;');
    await client.end();
  });

  it('allows service-role deletion only for the exact synthetic ownership graph', async () => {
    await client.query('set role service_role');
    await expect(client.query('delete from win224_cleanup_data.supervision_session_note_requests where id = $1', [ids.exactRequest])).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query('select id from win224_cleanup_data.bt_session_note_amendments where id = $1', [ids.exactAmendment])).resolves.toMatchObject({ rowCount: 0 });
    await expect(client.query('delete from win224_cleanup_data.supervision_session_note_corrections where id = $1', [ids.ordinaryCorrection])).rejects.toThrow(/immutable/i);
    await client.query('reset role');
  });

  it('rejects an authenticated delete even for the exact synthetic ownership graph', async () => {
    await client.query('set role authenticated');
    await expect(client.query('delete from win224_cleanup_data.supervision_session_note_corrections where id = $1', [ids.authenticatedCorrection])).rejects.toThrow();
    await client.query('reset role');
  });
});
