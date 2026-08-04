import { randomUUID } from "node:crypto";
import { Client } from "pg";

const REQUIRED_TABLES = [
  "agent_work_items",
  "agent_work_item_dependencies",
  "agent_work_assessment_links",
  "agent_work_steps",
  "agent_work_step_dependencies",
  "agent_work_evidence",
  "agent_work_approvals",
  "agent_work_attempts",
  "agent_work_effects",
  "agent_work_events",
];

const INTERNAL_MUTATION_TABLES = [
  "agent_work_items",
  "agent_work_item_dependencies",
  "agent_work_assessment_links",
  "agent_work_steps",
  "agent_work_step_dependencies",
  "agent_work_evidence",
  "agent_work_approvals",
  "agent_work_attempts",
  "agent_work_effects",
  "agent_work_events",
];

const FUNCTION_CONTRACTS = [
  {
    signature: "app.current_user_can_read_agent_work_row(uuid,uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "app.current_user_can_manage_agent_work_row(uuid,uuid)",
    searchPath: "public, app, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "app.actor_can_manage_agent_work_row(uuid,uuid,uuid)",
    searchPath: "public, app, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "current_user_can_manage_agent_work_row(uuid,uuid)",
    searchPath: "public, app, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "agent_work_user_has_exact_role(uuid,uuid,text,timestamp with time zone)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_user_has_client_access(uuid,uuid,uuid,timestamp with time zone)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_compute_input_hash(uuid,uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_compute_evidence_hash(uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_compute_approval_hash(uuid,uuid,integer,text,uuid,text,text,text)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "current_user_can_decide_agent_work_approval(uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "current_user_decidable_agent_work_approval_ids(uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "current_user_visible_agent_work_approval_ids(uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "app.current_user_can_read_agent_work_item_endpoint(uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "current_user_can_read_agent_work_item_endpoint(uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "current_user_can_read_agent_work_assessment_endpoint(uuid,text,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "create_agent_assessment_work_item(uuid,uuid,uuid,uuid,integer,text)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "create_agent_caloptima_draft_review_work_item(uuid,uuid,uuid,uuid,integer,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "begin_agent_work_caloptima_model_attempt(uuid,uuid,uuid,uuid,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "complete_agent_work_caloptima_model_attempt(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,integer,integer,numeric,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "fail_agent_work_caloptima_model_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "snapshot_agent_work_caloptima_draft_packet(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "read_agent_work_caloptima_draft_packet(uuid,uuid,uuid,uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "refresh_agent_work_caloptima_evidence(uuid,uuid,uuid,uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "agent_work_recompute_item_status(uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_enforce_dependency_scope()",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_enforce_parent_scope()",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "claim_agent_work_step(uuid,text,integer)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "transition_agent_work_step(uuid,bigint,agent_work_step_status,text,text,jsonb)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "request_agent_work_approval_handoff(uuid,uuid,uuid,uuid,text,timestamp with time zone)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "decide_agent_work_approval(uuid,uuid,uuid,text,text)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "agent_work_validate_queue_payload(jsonb)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_log_queue_event(uuid,text,text,text,jsonb)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "enqueue_agent_work_message(uuid,timestamp with time zone,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "read_agent_work_messages(integer,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "archive_agent_work_message(text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "load_agent_work_runtime_policy(text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "snapshot_agent_work_model_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,numeric,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "record_agent_work_model_attempt_result(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,numeric,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "claim_queued_agent_work_step(uuid,uuid,text,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "read_agent_work_runner_scope(uuid,uuid,uuid,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "agent_work_advisory_projection_descriptor(uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "read_agent_work_advisory_projection_descriptor(uuid)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "agent_work_lock_advisory_projection_context(uuid,uuid,text,bigint,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "record_agent_work_advisory_projection_effect(uuid,uuid,text,bigint,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "read_agent_work_advisory_projection_effect(uuid,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "finalize_agent_work_advisory_projection_effect(uuid,uuid,text,bigint,text,text)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "schedule_agent_work_step_retry(uuid,integer,text,jsonb)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "requeue_expired_agent_work_leases(timestamp with time zone,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "wake_due_agent_work_steps(timestamp with time zone,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "expire_agent_work_approvals(timestamp with time zone,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "revoke_stale_agent_work_approvals(timestamp with time zone,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "archive_agent_work_poison_messages(timestamp with time zone,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: true },
  },
  {
    signature: "enable_local_agent_work_queue_scheduler(text,integer,integer)",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "disable_local_agent_work_queue_scheduler()",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
  {
    signature: "agent_work_enqueue_ready_step_trigger()",
    searchPath: "\"\"",
    execute: { public: false, anon: false, authenticated: false, service_role: false },
  },
];

const REQUIRED_TRACE_COLUMNS = ["work_item_id", "step_id", "attempt_id"];
const RUN_TOKEN = randomUUID().replace(/-/g, "").slice(0, 12);

const FIXTURES = {
  orgA: "00000000-0000-4000-8000-00000000a001",
  orgB: "00000000-0000-4000-8000-00000000a002",
  adminA: "00000000-0000-4000-8000-00000000a011",
  btA: "00000000-0000-4000-8000-00000000a012",
  bcbaA: "00000000-0000-4000-8000-00000000a013",
  adminB: "00000000-0000-4000-8000-00000000a014",
  clientAssigned: "00000000-0000-4000-8000-00000000a101",
  clientUnassigned: "00000000-0000-4000-8000-00000000a102",
  clientCrossOrg: "00000000-0000-4000-8000-00000000a103",
  docAssigned: randomUUID(),
  docUnassigned: randomUUID(),
  smokeDocAssigned: "00000000-0000-4000-8000-00000000a201",
  smokeCalOptimaDocAssigned: "00000000-0000-4000-8000-00000000a204",
  approvalAssigned: randomUUID(),
};

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const getRequiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const toPrivilegeList = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  }
  return [];
};

const expectFailure = async (label, fn, matcher) => {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!matcher.test(message)) {
      throw new Error(`${label} failed with unexpected error: ${message}`);
    }
    return;
  }

  throw new Error(`${label} unexpectedly succeeded`);
};

const expectFailureInTransaction = async (client, label, fn, matcher) => {
  const savepoint = `contract_${randomUUID().replace(/-/g, "")}`;
  await client.query(`savepoint ${savepoint}`);
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);

  if (!caught) {
    throw new Error(`${label} unexpectedly succeeded`);
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  if (!matcher.test(message)) {
    throw new Error(`${label} failed with unexpected error: ${message}`);
  }
};

const withActor = async (client, dbRole, claimRole, userId, callback, { commit = false } = {}) => {
  await client.query("begin");

  try {
    await client.query(`set local role ${dbRole}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [claimRole]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { role: claimRole, sub: userId } : { role: claimRole }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);

    const result = await callback();
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const withOwnerTransaction = async (client, callback, { commit = false } = {}) => {
  await client.query("begin");

  try {
    const result = await callback();
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const withOwnerSetupAndActor = async (
  client,
  setup,
  dbRole,
  claimRole,
  userId,
  callback,
  { commit = false } = {},
) => {
  await client.query("begin");

  try {
    await setup();
    await client.query(`set local role ${dbRole}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [claimRole]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { role: claimRole, sub: userId } : { role: claimRole }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);

    const result = await callback();
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const seedFixtures = async (client) => {
  await client.query(`
    insert into public.organizations (id, name, slug, metadata)
    values
      ('${FIXTURES.orgA}', 'Ledger Contract Org A', 'ledger-contract-org-a', '{"tags":["ledger-contract"],"notes":"synthetic ledger contract fixture"}'::jsonb),
      ('${FIXTURES.orgB}', 'Ledger Contract Org B', 'ledger-contract-org-b', '{"tags":["ledger-contract"],"notes":"synthetic ledger contract fixture"}'::jsonb)
    on conflict (id) do nothing;
  `);

  await client.query(`
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data
    )
    values
      ('00000000-0000-0000-0000-000000000000', '${FIXTURES.adminA}', 'authenticated', 'authenticated', 'ledger-admin-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"${FIXTURES.orgA}"}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', '${FIXTURES.btA}', 'authenticated', 'authenticated', 'ledger-bt-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"${FIXTURES.orgA}"}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', '${FIXTURES.bcbaA}', 'authenticated', 'authenticated', 'ledger-bcba-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"${FIXTURES.orgA}"}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', '${FIXTURES.adminB}', 'authenticated', 'authenticated', 'ledger-admin-b@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"${FIXTURES.orgB}"}'::jsonb)
    on conflict (id) do nothing;
  `);

  await client.query(`
    select set_config('app.bypass_profile_role_guard', 'on', true);

    update public.profiles
    set role = values_table.role::public.role_type,
        first_name = values_table.first_name,
        last_name = values_table.last_name,
        organization_id = values_table.organization_id::uuid,
        is_active = true,
        updated_at = now()
    from (
      values
        ('${FIXTURES.adminA}'::uuid, 'admin', 'Ledger', 'AdminA', '${FIXTURES.orgA}'),
        ('${FIXTURES.btA}'::uuid, 'bt', 'Ledger', 'BTA', '${FIXTURES.orgA}'),
        ('${FIXTURES.bcbaA}'::uuid, 'bcba', 'Ledger', 'BCBAA', '${FIXTURES.orgA}'),
        ('${FIXTURES.adminB}'::uuid, 'admin', 'Ledger', 'AdminB', '${FIXTURES.orgB}')
    ) as values_table(id, role, first_name, last_name, organization_id)
    where profiles.id = values_table.id;

    select set_config('app.bypass_profile_role_guard', 'off', true);
  `);

  await client.query(`
    insert into public.user_roles (user_id, role_id, is_active)
    select values_table.user_id, roles.id, true
    from (
      values
        ('${FIXTURES.adminA}'::uuid, 'admin'),
        ('${FIXTURES.btA}'::uuid, 'bt'),
        ('${FIXTURES.bcbaA}'::uuid, 'bcba'),
        ('${FIXTURES.adminB}'::uuid, 'admin')
    ) as values_table(user_id, role_name)
    join public.roles on roles.name = values_table.role_name
    on conflict do nothing;
  `);

  await client.query(`
    insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
    values
      ('${FIXTURES.btA}', 'ledger-bt-a@example.invalid', 'Ledger BT A', 'Ledger', 'BT A', 'active', '${FIXTURES.orgA}')
    on conflict (id) do nothing;
  `);

  await client.query(`
    insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
    values
      ('${FIXTURES.clientAssigned}', 'Ledger Assigned Client', 'active', '${FIXTURES.orgA}', '${FIXTURES.btA}', '${FIXTURES.adminA}', '${FIXTURES.adminA}'),
      ('${FIXTURES.clientUnassigned}', 'Ledger Unassigned Client', 'active', '${FIXTURES.orgA}', null, '${FIXTURES.adminA}', '${FIXTURES.adminA}'),
      ('${FIXTURES.clientCrossOrg}', 'Ledger Cross Org Client', 'active', '${FIXTURES.orgB}', null, '${FIXTURES.adminB}', '${FIXTURES.adminB}')
    on conflict (id) do nothing;
  `);

  await client.query(`
    insert into public.client_therapist_links (client_id, therapist_id, organization_id, created_by)
    values ('${FIXTURES.clientAssigned}', '${FIXTURES.btA}', '${FIXTURES.orgA}', '${FIXTURES.adminA}')
    on conflict do nothing;
  `);

  await client.query(`
    insert into public.assessment_documents (
      id,
      organization_id,
      client_id,
      uploaded_by,
      template_type,
      file_name,
      mime_type,
      file_size,
      bucket_id,
      object_path
    )
    values
      ('${FIXTURES.docAssigned}', '${FIXTURES.orgA}', '${FIXTURES.clientAssigned}', '${FIXTURES.adminA}', 'iehp_fba', 'assigned-${RUN_TOKEN}.pdf', 'application/pdf', 128, 'client-documents', 'synthetic/${RUN_TOKEN}/assigned.pdf'),
      ('${FIXTURES.docUnassigned}', '${FIXTURES.orgA}', '${FIXTURES.clientUnassigned}', '${FIXTURES.adminA}', 'iehp_fba', 'unassigned-${RUN_TOKEN}.pdf', 'application/pdf', 128, 'client-documents', 'synthetic/${RUN_TOKEN}/unassigned.pdf'),
      ('${FIXTURES.smokeDocAssigned}', '${FIXTURES.orgA}', '${FIXTURES.clientAssigned}', '${FIXTURES.adminA}', 'iehp_fba', 'ledger-edge-smoke-assigned.pdf', 'application/pdf', 128, 'client-documents', 'synthetic/ledger-edge-smoke/assigned.pdf'),
      ('${FIXTURES.smokeCalOptimaDocAssigned}', '${FIXTURES.orgA}', '${FIXTURES.clientAssigned}', '${FIXTURES.adminA}', 'caloptima_fba', 'ledger-edge-smoke-caloptima.pdf', 'application/pdf', 128, 'client-documents', 'synthetic/ledger-edge-smoke/caloptima.pdf')
    on conflict (id) do nothing;
  `);
};

const assertTablesAndRls = async (client) => {
  const { rows } = await client.query(
    `
      select
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any($1::text[])
      order by c.relname
    `,
    [REQUIRED_TABLES],
  );

  const seenTables = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((tableName) => !seenTables.has(tableName));
  assert(missingTables.length === 0, `Missing ledger tables: ${missingTables.join(", ")}`);

  const rlsViolations = rows.filter((row) => row.rls_enabled !== true || row.rls_forced !== true);
  assert(
    rlsViolations.length === 0,
    `RLS must be enabled and forced on every ledger table: ${rlsViolations.map((row) => row.table_name).join(", ")}`,
  );
};

const assertTableGrants = async (client) => {
  const { rows } = await client.query(
    `
      select
        table_name,
        grantee,
        array_agg(privilege_type order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = any($1::text[])
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      group by table_name, grantee
      order by table_name, grantee
    `,
    [INTERNAL_MUTATION_TABLES],
  );

  const unsafeGrants = rows.filter((row) =>
    toPrivilegeList(row.privileges).some((privilege) =>
      ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].includes(privilege),
    ),
  );

  assert(
    unsafeGrants.length === 0,
    `Broad ledger table grants detected: ${unsafeGrants
      .map((row) => `${row.grantee}:${row.table_name}:${toPrivilegeList(row.privileges).join(",")}`)
      .join("; ")}`,
  );

  const authenticatedGrants = rows.filter((row) => row.grantee === "authenticated");
  assert(
    authenticatedGrants.length === 0,
    `Ledger base tables must remain behind sanitized Edge DTOs: ${authenticatedGrants
      .map((row) => `${row.table_name}:${toPrivilegeList(row.privileges).join(",")}`)
      .join("; ")}`,
  );

  const serviceRoleGrants = new Map(
    rows
      .filter((row) => row.grantee === "service_role")
      .map((row) => [row.table_name, toPrivilegeList(row.privileges)]),
  );
  const invalidServiceRoleGrants = INTERNAL_MUTATION_TABLES.filter((tableName) => {
    const privileges = serviceRoleGrants.get(tableName) ?? [];
    return privileges.length !== 1 || privileges[0] !== "SELECT";
  });

  assert(
    invalidServiceRoleGrants.length === 0,
    `service_role must have SELECT only on ledger tables: ${invalidServiceRoleGrants
      .map((tableName) => `${tableName}:${(serviceRoleGrants.get(tableName) ?? []).join(",") || "none"}`)
      .join("; ")}`,
  );
};

const assertFunctionContracts = async (client) => {
  const { rows } = await client.query(
    `
      select
        p.oid::regprocedure::text as signature,
        coalesce(
          (
            select regexp_replace(config, '^search_path=', '')
            from unnest(coalesce(p.proconfig, '{}'::text[])) as config
            where config like 'search_path=%'
            limit 1
          ),
          ''
        ) as search_path,
        has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
      from pg_proc p
      where p.oid = any($1::regprocedure[])
      order by 1
    `,
    [FUNCTION_CONTRACTS.map((entry) => entry.signature)],
  );

  const rowMap = new Map(rows.map((row) => [row.signature, row]));
  for (const contract of FUNCTION_CONTRACTS) {
    const row = rowMap.get(contract.signature);
    assert(row, `Missing ledger RPC/helper: ${contract.signature}`);
    assert(
      row.search_path === contract.searchPath,
      `${contract.signature} must set search_path to "${contract.searchPath}" (found "${row.search_path || "<empty>"}")`,
    );

    for (const [grantee, expected] of Object.entries(contract.execute)) {
      const actual = Boolean(row[`${grantee}_exec`]);
      assert(
        actual === expected,
        `${contract.signature} execute grants mismatch for ${grantee}: expected ${expected}, found ${actual}`,
      );
    }
  }
};

const assertTraceColumns = async (client) => {
  const { rows } = await client.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_execution_traces'
        and column_name = any($1::text[])
      order by column_name
    `,
    [REQUIRED_TRACE_COLUMNS],
  );

  const seenTraceColumns = new Set(rows.map((row) => row.column_name));
  const missingTraceColumns = REQUIRED_TRACE_COLUMNS.filter((columnName) => !seenTraceColumns.has(columnName));
  assert(
    missingTraceColumns.length === 0,
    `Missing agent_execution_traces ledger columns: ${missingTraceColumns.join(", ")}`,
  );
};

const assertQueueAndSweeperContract = async (client) => {
  await withOwnerTransaction(client, async () => {
    const workItemId = randomUUID();
    const stepId = randomUUID();
    const modelStepId = randomUUID();
    const retryWorkItemId = randomUUID();
    const retryStepId = randomUUID();
    const approvalId = randomUUID();
    const projectionWorkItemId = randomUUID();
    const projectionStepId = randomUUID();

    await client.query(
      `
        insert into public.agent_work_items (
          id, organization_id, client_id, workflow_key, workflow_version,
          objective, status, risk, completion_criteria, dedupe_key
        ) values (
          $1::uuid, $2::uuid, $3::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1,
          'Synthetic queue contract work item.', 'queued', 'low',
          '{"terminal_state":"needs_review"}'::jsonb, $4::text
        )
      `,
      [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `queue-contract-${RUN_TOKEN}`],
    );
    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, completion_criteria, input_hash
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'validate_scope', 10,
          'deterministic', 'ready', 'low', '{}'::jsonb, $5::text
        )
      `,
      [stepId, workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
    );

    const { rows: advisoryRows } = await client.query(
      "select * from public.load_agent_work_runtime_policy('advisory')",
    );
    assert(
      advisoryRows[0]?.runtimeMode === "advisory" && advisoryRows[0]?.authoritative === true,
      "Authoritative runtime policy did not preserve advisory mode",
    );
    await client.query(
      "update public.agent_runtime_config set actions_disabled = true where config_key = 'global'",
    );
    const { rows: disabledRows } = await client.query(
      "select * from public.load_agent_work_runtime_policy('advisory')",
    );
    assert(
      disabledRows[0]?.runtimeMode === "disabled" && disabledRows[0]?.killSwitchEnabled === true,
      "Authoritative runtime kill switch did not fail closed",
    );
    await client.query(
      "update public.agent_runtime_config set actions_disabled = false where config_key = 'global'",
    );

    const { rows: queueRows } = await client.query(
      "select * from public.read_agent_work_messages(60, 1)",
    );
    const message = queueRows[0];
    assert(message, "Ready-step trigger did not enqueue a queue message");
    assert(
      message.work_item_id === workItemId &&
        message.step_id === stepId &&
        message.organization_id === FIXTURES.orgA &&
        message.message?.workItemId === workItemId &&
        message.message?.stepId === stepId &&
        message.message?.organizationId === FIXTURES.orgA,
      "Queue message scope did not match the authoritative synthetic row",
    );
    const { rows: archiveRows } = await client.query(
      "select public.archive_agent_work_message($1::text) as archived",
      [message.msg_id],
    );
    assert(archiveRows[0]?.archived === true, "Queue message archive did not succeed");

    const futureCorrelationId = `future.${RUN_TOKEN}`;
    const { rows: futureMessageRows } = await client.query(
      `
        select pgmq.send(
          queue_name => 'agent_work_steps',
          msg => jsonb_build_object(
            'workItemId', $1::uuid::text,
            'stepId', $2::uuid::text,
            'organizationId', $3::uuid::text,
            'availableAt', to_jsonb(timezone('utc', now()) + interval '5 minutes'),
            'correlationId', $4::text,
            'workflowVersion', 1
          )
        )::text as msg_id
      `,
      [workItemId, stepId, FIXTURES.orgA, futureCorrelationId],
    );
    const futureMessageId = futureMessageRows[0]?.msg_id;
    assert(/^\d+$/.test(futureMessageId ?? ""), "Queue message ids must remain exact decimal strings");
    const { rows: futureReadRows } = await client.query(
      "select * from public.read_agent_work_messages(60, 1)",
    );
    assert(futureReadRows.length === 0, "Future-due queue message became runnable early");
    const { rows: preservedFutureRows } = await client.query(
      `
        select read_ct, vt > timezone('utc', now()) + interval '4 minutes' as delayed
        from pgmq.q_agent_work_steps
        where msg_id = $1::text::bigint
      `,
      [futureMessageId],
    );
    assert(
      preservedFutureRows[0]?.read_ct >= 1 && preservedFutureRows[0]?.delayed === true,
      "Future-due queue message was not preserved with authoritative visibility",
    );
    const { rows: futureArchiveRows } = await client.query(
      "select public.archive_agent_work_message($1::text) as archived",
      [futureMessageId],
    );
    assert(futureArchiveRows[0]?.archived === true, "Future queue message cleanup failed");

    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, completion_criteria, input_hash
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'model_boundary', 20,
          'model_suggested', 'ready', 'low', '{}'::jsonb, $5::text
        )
      `,
      [modelStepId, workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
    );
    await expectFailureInTransaction(
      client,
      "model-suggested queued claim",
      () => client.query(
        "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'queue-contract-worker', 60)",
        [workItemId, modelStepId],
      ),
      /not claimable/i,
    );

    await client.query(
      `
        insert into public.agent_work_items (
          id, organization_id, client_id, workflow_key, workflow_version,
          objective, status, risk, completion_criteria, dedupe_key
        ) values (
          $1::uuid, $2::uuid, $3::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1,
          'Synthetic retry boundary work item.', 'queued', 'low',
          '{"terminal_state":"needs_review"}'::jsonb, $4::text
        )
      `,
      [retryWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `retry-contract-${RUN_TOKEN}`],
    );
    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, completion_criteria, input_hash, max_attempts
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'retry_boundary', 10,
          'deterministic', 'ready', 'low', '{}'::jsonb, $5::text, 2
        )
      `,
      [retryStepId, retryWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
    );
    await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'retry-worker', 60)",
      [retryWorkItemId, retryStepId],
    );
    const { rows: scheduledRetryRows } = await client.query(
      "select public.schedule_agent_work_step_retry($1::uuid, 0, 'synthetic_retry', '{}'::jsonb) as result",
      [retryStepId],
    );
    assert(
      scheduledRetryRows[0]?.result?.outcome === "retry_scheduled",
      "Retry RPC did not schedule a non-terminal retry",
    );
    await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'retry-worker', 60)",
      [retryWorkItemId, retryStepId],
    );
    const { rows: exhaustedRetryRows } = await client.query(
      "select public.schedule_agent_work_step_retry($1::uuid, 0, 'synthetic_retry', '{}'::jsonb) as result",
      [retryStepId],
    );
    assert(
      exhaustedRetryRows[0]?.result?.outcome === "retry_limit_exhausted",
      "Retry RPC did not fail closed at the exact attempt ceiling",
    );
    const { rows: exhaustedStepRows } = await client.query(
      `
        select status, lease_owner, lease_expires_at,
          not exists (
            select 1 from public.agent_work_attempts
            where step_id = $1::uuid and status = 'running'
          ) as attempts_settled
        from public.agent_work_steps
        where id = $1::uuid
      `,
      [retryStepId],
    );
    assert(
      exhaustedStepRows[0]?.status === "failed" &&
        exhaustedStepRows[0]?.lease_owner === null &&
        exhaustedStepRows[0]?.lease_expires_at === null &&
        exhaustedStepRows[0]?.attempts_settled === true,
      "Retry ceiling did not atomically fail the step and settle its running attempt",
    );

    const { rows: claimRows } = await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'queue-contract-worker', 60)",
      [workItemId, stepId],
    );
    const claim = claimRows[0];
    assert(
      claim?.id === stepId && claim?.work_item_id === workItemId && claim?.attempt_id,
      "Exact queued-step claim did not return the bound step and attempt",
    );

    await client.query(
      "update public.agent_work_steps set lease_expires_at = now() - interval '1 second' where id = $1::uuid",
      [stepId],
    );
    const { rows: recoveredRows } = await client.query(
      "select * from public.requeue_expired_agent_work_leases(now(), 10)",
    );
    assert(
      recoveredRows.some((row) => row.reasonCode === "lease_expired"),
      "Expired lease was not requeued with a sanitized reason code",
    );

    await client.query(
      `
        update public.agent_work_steps
        set status = 'waiting', wake_at = now() - interval '1 second'
        where id = $1::uuid
      `,
      [stepId],
    );
    const { rows: wakeRows } = await client.query(
      "select * from public.wake_due_agent_work_steps(now(), 10)",
    );
    assert(
      wakeRows.some((row) => row.reasonCode === "due_wait_wakeup"),
      "Due waiting step was not woken with a sanitized reason code",
    );

    await client.query(
      `
        insert into public.agent_work_approvals (
          id, work_item_id, step_id, organization_id, client_id,
          required_role, status, input_hash, evidence_hash, expires_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          'bcba', 'pending', $6::text, $7::text, now() - interval '1 second'
        )
      `,
      [approvalId, workItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A, HASH_B],
    );
    const { rows: approvalRows } = await client.query(
      "select public.expire_agent_work_approvals(now(), 10) as result",
    );
    assert(
      approvalRows[0]?.result?.expired?.some((row) => row.reasonCode === "approval_expired"),
      "Expired approval was not reported by the sweeper contract",
    );

    await client.query(
      `
        update public.agent_work_steps
        set status = 'running', attempt_count = max_attempts,
            lease_owner = 'queue-contract-worker',
            lease_expires_at = now() - interval '1 second'
        where id = $1::uuid
      `,
      [stepId],
    );
    const { rows: poisonRows } = await client.query(
      "select * from public.requeue_expired_agent_work_leases(now(), 10)",
    );
    assert(
      poisonRows.some((row) => row.reasonCode === "poison_retry_ceiling"),
      "Retry ceiling did not move the expired lease to a visible poison state",
    );
    const { rows: poisonArchiveRows } = await client.query(
      "select public.archive_agent_work_poison_messages(clock_timestamp() + interval '1 second', 100) as result",
    );
    assert(
      poisonArchiveRows[0]?.result?.retryCeiling?.some(
        (row) => row.reasonCode === "poison_retry_ceiling",
      ),
      "Poison message was not archived in the retry-ceiling bucket",
    );

    await client.query(
      `
        insert into public.agent_work_items (
          id, organization_id, client_id, workflow_key, workflow_version,
          objective, status, risk, completion_criteria, dedupe_key
        ) values (
          $1::uuid, $2::uuid, $3::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1,
          'Synthetic advisory projection contract work item.', 'queued', 'low',
          '{"terminal_state":"needs_review"}'::jsonb, $4::text
        )
      `,
      [projectionWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `projection-contract-${RUN_TOKEN}`],
    );
    await client.query(
      `
        insert into public.agent_work_assessment_links (
          work_item_id, organization_id, client_id, assessment_document_id,
          workflow_key, workflow_version
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1
        )
      `,
      [projectionWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned],
    );
    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, completion_criteria, input_hash
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'project_advisory_effect', 20,
          'deterministic', 'ready', 'low', '{}'::jsonb, $5::text
        )
      `,
      [projectionStepId, projectionWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
    );

    const { rows: projectionDescriptorRows } = await client.query(
      "select * from public.read_agent_work_advisory_projection_descriptor($1::uuid)",
      [projectionStepId],
    );
    const projectionEffectKey = projectionDescriptorRows[0]?.effect_key;
    const projectionOutputHash = projectionDescriptorRows[0]?.output_hash;
    assert(
      typeof projectionEffectKey === "string" &&
        /^[a-f0-9]{64}$/.test(projectionOutputHash ?? ""),
      "Projection descriptor did not derive a sanitized authoritative hash",
    );

    const { rows: firstProjectionClaimRows } = await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'projection-worker', 60)",
      [projectionWorkItemId, projectionStepId],
    );
    const firstProjectionClaim = firstProjectionClaimRows[0];
    assert(firstProjectionClaim?.attempt_id, "Projection claim did not return an attempt id");

    const { rows: firstProjectionEffectRows } = await client.query(
      `
        select *
        from public.record_agent_work_advisory_projection_effect(
          $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
        )
      `,
      [
        projectionStepId,
        firstProjectionClaim.attempt_id,
        "projection-worker",
        firstProjectionClaim.state_version,
        projectionEffectKey,
        projectionOutputHash,
      ],
    );
    assert(
      firstProjectionEffectRows[0]?.status === "pending" &&
        firstProjectionEffectRows[0]?.effect_kind === "advisory_projection" &&
        firstProjectionEffectRows[0]?.target_kind === "agent_work_step" &&
        firstProjectionEffectRows[0]?.target_id === projectionStepId,
      "Projection effect record RPC did not persist the fixed advisory projection effect contract",
    );

    await client.query(
      `
        update public.agent_work_steps
        set lease_expires_at = now() - interval '1 second'
        where id = $1::uuid
      `,
      [projectionStepId],
    );
    await client.query("select * from public.requeue_expired_agent_work_leases(now(), 10)");

    const { rows: secondProjectionClaimRows } = await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'projection-worker', 60)",
      [projectionWorkItemId, projectionStepId],
    );
    const secondProjectionClaim = secondProjectionClaimRows[0];
    assert(
      secondProjectionClaim?.attempt_id && secondProjectionClaim.attempt_id !== firstProjectionClaim.attempt_id,
      "Projection re-claim did not issue a fresh running attempt",
    );

    const { rows: secondProjectionEffectRows } = await client.query(
      `
        select *
        from public.record_agent_work_advisory_projection_effect(
          $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
        )
      `,
      [
        projectionStepId,
        secondProjectionClaim.attempt_id,
        "projection-worker",
        secondProjectionClaim.state_version,
        projectionEffectKey,
        projectionOutputHash,
      ],
    );
    assert(
      secondProjectionEffectRows[0]?.id === firstProjectionEffectRows[0]?.id,
      "Projection duplicate delivery should reconcile to one effect row",
    );

    const { rows: projectionReadRows } = await client.query(
      "select * from public.read_agent_work_advisory_projection_effect($1::uuid, $2::text)",
      [projectionStepId, projectionEffectKey],
    );
    assert(
      projectionReadRows[0]?.status === "pending" &&
        projectionReadRows[0]?.step_status === "running" &&
        projectionReadRows[0]?.payload_hash === projectionOutputHash,
      "Projection read RPC did not expose the authoritative pending effect postcondition",
    );

    await expectFailureInTransaction(
      client,
      "projection finalization after authoritative domain drift",
      async () => {
        await client.query(
          "update public.assessment_documents set updated_at = updated_at + interval '1 second' where id = $1::uuid",
          [FIXTURES.docAssigned],
        );
        await client.query(
          `
            select *
            from public.finalize_agent_work_advisory_projection_effect(
              $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
            )
          `,
          [
            projectionStepId,
            secondProjectionClaim.attempt_id,
            "projection-worker",
            secondProjectionClaim.state_version,
            projectionEffectKey,
            projectionOutputHash,
          ],
        );
      },
      /authoritative domain hash mismatch/i,
    );

    const { rows: finalizedProjectionRows } = await client.query(
      `
        select *
        from public.finalize_agent_work_advisory_projection_effect(
          $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
        )
      `,
      [
        projectionStepId,
        secondProjectionClaim.attempt_id,
        "projection-worker",
        secondProjectionClaim.state_version,
        projectionEffectKey,
        projectionOutputHash,
      ],
    );
    assert(
      finalizedProjectionRows[0]?.status === "completed",
      "Projection finalize RPC did not atomically complete the running step",
    );

    const { rows: finalizedProjectionEffectRows } = await client.query(
      "select * from public.read_agent_work_advisory_projection_effect($1::uuid, $2::text)",
      [projectionStepId, projectionEffectKey],
    );
    assert(
      finalizedProjectionEffectRows[0]?.status === "verified" &&
        finalizedProjectionEffectRows[0]?.step_status === "completed" &&
        finalizedProjectionEffectRows[0]?.attempt_id === secondProjectionClaim.attempt_id,
      "Projection finalize/read contract did not preserve the verified effect row and authoritative completion state",
    );

    const { rows: projectionEffectCountRows } = await client.query(
      `
        select count(*)::integer as effect_count
        from public.agent_work_effects
        where organization_id = $1::uuid
          and unique_effect_key = $2::text
      `,
      [FIXTURES.orgA, projectionEffectKey],
    );
    assert(
      projectionEffectCountRows[0]?.effect_count === 1,
      "Projection duplicate delivery created more than one effect row",
    );

    const verifiedProjectionWorkItemId = randomUUID();
    const verifiedProjectionStepId = randomUUID();

    await client.query(
      `
        insert into public.agent_work_items (
          id, organization_id, client_id, workflow_key, workflow_version,
          objective, status, risk, completion_criteria, dedupe_key
        ) values (
          $1::uuid, $2::uuid, $3::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1,
          'Synthetic verified projection contract work item.', 'queued', 'low',
          '{"terminal_state":"needs_review"}'::jsonb, $4::text
        )
      `,
      [verifiedProjectionWorkItemId, FIXTURES.orgA, FIXTURES.clientUnassigned, `projection-verified-contract-${RUN_TOKEN}`],
    );
    await client.query(
      `
        insert into public.agent_work_assessment_links (
          work_item_id, organization_id, client_id, assessment_document_id,
          workflow_key, workflow_version
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          'assessment.iehp.prepare_for_clinical_review', 1
        )
      `,
      [verifiedProjectionWorkItemId, FIXTURES.orgA, FIXTURES.clientUnassigned, FIXTURES.docUnassigned],
    );
    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, completion_criteria, input_hash
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'project_verified_advisory_effect', 30,
          'deterministic', 'ready', 'low', '{}'::jsonb, $5::text
        )
      `,
      [verifiedProjectionStepId, verifiedProjectionWorkItemId, FIXTURES.orgA, FIXTURES.clientUnassigned, HASH_B],
    );

    const { rows: verifiedProjectionDescriptorRows } = await client.query(
      "select * from public.read_agent_work_advisory_projection_descriptor($1::uuid)",
      [verifiedProjectionStepId],
    );
    const verifiedProjectionEffectKey = verifiedProjectionDescriptorRows[0]?.effect_key;
    const verifiedProjectionOutputHash = verifiedProjectionDescriptorRows[0]?.output_hash;
    assert(
      typeof verifiedProjectionEffectKey === "string" &&
        /^[a-f0-9]{64}$/.test(verifiedProjectionOutputHash ?? ""),
      "Verified projection descriptor did not derive a sanitized authoritative hash",
    );

    const { rows: verifiedProjectionClaimRows } = await client.query(
      "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, 'projection-worker', 60)",
      [verifiedProjectionWorkItemId, verifiedProjectionStepId],
    );
    const verifiedProjectionClaim = verifiedProjectionClaimRows[0];
    assert(verifiedProjectionClaim?.attempt_id, "Verified projection claim did not return an attempt id");

    const { rows: verifiedProjectionEffectRows } = await client.query(
      `
        select *
        from public.record_agent_work_advisory_projection_effect(
          $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
        )
      `,
      [
        verifiedProjectionStepId,
        verifiedProjectionClaim.attempt_id,
        "projection-worker",
        verifiedProjectionClaim.state_version,
        verifiedProjectionEffectKey,
        verifiedProjectionOutputHash,
      ],
    );
    await client.query(
      `
        update public.agent_work_effects
        set status = 'verified',
            verified_at = now()
        where id = $1::uuid
      `,
      [verifiedProjectionEffectRows[0]?.id],
    );

    const { rows: verifiedFinalizeRows } = await client.query(
      `
        select *
        from public.finalize_agent_work_advisory_projection_effect(
          $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
        )
      `,
      [
        verifiedProjectionStepId,
        verifiedProjectionClaim.attempt_id,
        "projection-worker",
        verifiedProjectionClaim.state_version,
        verifiedProjectionEffectKey,
        verifiedProjectionOutputHash,
      ],
    );
    assert(
      verifiedFinalizeRows[0]?.status === "completed",
      "Projection finalize RPC did not reconcile an already verified matching effect",
    );
  });
};

const assertCalOptimaDraftReviewLifecycle = async (client) => {
  const documentId = FIXTURES.smokeCalOptimaDocAssigned;
  const before = await client.query(
    `
      select
        (select status from public.assessment_documents where id = $1::uuid) as document_status,
        (select count(*)::integer from public.programs where client_id = $2::uuid) as program_count,
        (select count(*)::integer from public.goals where client_id = $2::uuid) as goal_count
    `,
    [documentId, FIXTURES.clientAssigned],
  );

  const createWorkItem = (actorId, organizationId, dedupeKey) =>
    withActor(client, "service_role", "service_role", actorId, async () => {
      const { rows } = await client.query(
        `
          select public.create_agent_caloptima_draft_review_work_item(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5::text
          ) as id
        `,
        [actorId, organizationId, FIXTURES.clientAssigned, documentId, dedupeKey],
      );
      return rows[0]?.id;
    }, { commit: true });

  const workItemId = await createWorkItem(
    FIXTURES.adminA,
    FIXTURES.orgA,
    `caloptima-lifecycle-${RUN_TOKEN}`,
  );
  assert(workItemId, "CalOptima lifecycle work-item creation did not return an id");
  const duplicateWorkItemId = await createWorkItem(
    FIXTURES.adminA,
    FIXTURES.orgA,
    `caloptima-lifecycle-duplicate-${RUN_TOKEN}`,
  );
  assert(duplicateWorkItemId === workItemId, "CalOptima document creation was not idempotent");

  await expectFailure(
    "CalOptima cross-tenant creation",
    () => createWorkItem(FIXTURES.adminB, FIXTURES.orgA, `caloptima-cross-org-${RUN_TOKEN}`),
    /forbidden/i,
  );

  const completeProjection = async (stepKey) =>
    withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const stepResult = await client.query(
        `select id, status from public.agent_work_steps where work_item_id = $1::uuid and step_key = $2::text`,
        [workItemId, stepKey],
      );
      const stepId = stepResult.rows[0]?.id;
      assert(stepResult.rows[0]?.status === "ready", `${stepKey} was not ready for deterministic execution`);

      const descriptorResult = await client.query(
        "select * from public.read_agent_work_advisory_projection_descriptor($1::uuid)",
        [stepId],
      );
      const descriptor = descriptorResult.rows[0];
      assert(
        /^[a-f0-9]{64}$/.test(descriptor?.effect_key ?? "") &&
          /^[a-f0-9]{64}$/.test(descriptor?.output_hash ?? ""),
        `${stepKey} did not return canonical projection hashes`,
      );

      const claimResult = await client.query(
        "select * from public.claim_queued_agent_work_step($1::uuid, $2::uuid, $3::text, 60)",
        [workItemId, stepId, `caloptima-${stepKey}`],
      );
      const claim = claimResult.rows[0];
      assert(claim?.attempt_id, `${stepKey} did not return a deterministic attempt`);

      const effectResult = await client.query(
        `
          select * from public.record_agent_work_advisory_projection_effect(
            $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
          )
        `,
        [
          stepId,
          claim.attempt_id,
          `caloptima-${stepKey}`,
          claim.state_version,
          descriptor.effect_key,
          descriptor.output_hash,
        ],
      );
      assert(effectResult.rows[0]?.status === "pending", `${stepKey} effect was not recorded pending verification`);

      const finalized = await client.query(
        `
          select * from public.finalize_agent_work_advisory_projection_effect(
            $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text
          )
        `,
        [
          stepId,
          claim.attempt_id,
          `caloptima-${stepKey}`,
          claim.state_version,
          descriptor.effect_key,
          descriptor.output_hash,
        ],
      );
      assert(finalized.rows[0]?.status === "completed", `${stepKey} projection did not verify and complete`);
      return { stepId, ...descriptor };
    }, { commit: true });

  await completeProjection("validate_scope");

  let structuredEvidenceId;
  await withOwnerTransaction(client, async () => {
    await client.query(
      `
        insert into public.assessment_checklist_items (
          assessment_document_id, organization_id, client_id, section_key, label,
          placeholder_key, mode, source, required, extraction_method, validation_rule,
          status, last_reviewed_by, last_reviewed_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, 'synthetic_scope', 'Synthetic scope evidence',
          $4::text, 'MANUAL', 'synthetic', true, 'synthetic', 'synthetic',
          'approved', $5::uuid, now()
        )
      `,
      [documentId, FIXTURES.orgA, FIXTURES.clientAssigned, `ledger_${RUN_TOKEN}`, FIXTURES.bcbaA],
    );
    const structuredInsert = await client.query(
      `
        insert into public.assessment_structured_sections (
          assessment_document_id, organization_id, client_id, section_key, field_key,
          payload, status, required, reviewed_by, reviewed_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, 'synthetic_goals', 'CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS',
          '{"synthetic":true}'::jsonb, 'approved', true, $4::uuid, now()
        ) returning id
      `,
      [documentId, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.bcbaA],
    );
    structuredEvidenceId = structuredInsert.rows[0]?.id;
  }, { commit: true });
  assert(structuredEvidenceId, "CalOptima structured evidence fixture was not created");

  await completeProjection("await_approved_evidence");

  const beginModelAttempt = (actorId, organizationId) =>
    withActor(client, "service_role", "service_role", actorId, async () => {
      const { rows } = await client.query(
        `
          select * from public.begin_agent_work_caloptima_model_attempt(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text
          )
        `,
        [
          actorId,
          organizationId,
          FIXTURES.clientAssigned,
          workItemId,
          `caloptima.correlation.${RUN_TOKEN}`,
          `caloptima.request.${RUN_TOKEN}`,
        ],
      );
      return rows[0];
    }, { commit: true });

  const failedPreparationAttempt = await beginModelAttempt(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    failedPreparationAttempt?.attempt_status === "running" &&
      Array.isArray(failedPreparationAttempt.allowed_tools) && failedPreparationAttempt.allowed_tools.length === 0 &&
      Array.isArray(failedPreparationAttempt.guarded_tools) && failedPreparationAttempt.guarded_tools.length === 0,
    "CalOptima model attempt did not fail closed to the fixed no-tools contract",
  );
  const duplicateModelAttempt = await beginModelAttempt(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    duplicateModelAttempt?.attempt_id === failedPreparationAttempt.attempt_id,
    "CalOptima model begin replay did not return the running attempt",
  );
  await expectFailure(
    "CalOptima cross-org model begin",
    () => beginModelAttempt(FIXTURES.adminB, FIXTURES.orgA),
    /forbidden/i,
  );

  const claimedPreparationState = await client.query(
    "select status, execution_mode, organization_id, client_id from public.agent_work_steps where id = $1::uuid",
    [failedPreparationAttempt.step_id],
  );
  const claimedPreparationStep = claimedPreparationState.rows[0];
  assert(
    claimedPreparationStep?.status === "running" &&
      claimedPreparationStep?.execution_mode === "model_suggested" &&
      claimedPreparationStep?.organization_id === FIXTURES.orgA &&
      claimedPreparationStep?.client_id === FIXTURES.clientAssigned,
    `CalOptima preparation claim state mismatch: ${JSON.stringify(claimedPreparationStep ?? null)}`,
  );

  let reopenedModelStep;
  try {
    reopenedModelStep = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const { rows } = await client.query(
        `
          select result.* from public.fail_agent_work_caloptima_model_attempt(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::text
          ) as result
        `,
        [
          FIXTURES.adminA,
          FIXTURES.orgA,
          FIXTURES.clientAssigned,
          workItemId,
          failedPreparationAttempt.step_id,
          failedPreparationAttempt.attempt_id,
          "authoritative_payload_unavailable",
        ],
      );
      return rows[0];
    }, { commit: true });
  } catch (error) {
    const context = error && typeof error === "object" && typeof error.where === "string" ? ` (${error.where})` : "";
    throw new Error(`CalOptima preparation settlement failed: ${error instanceof Error ? error.message : String(error)}${context}`);
  }
  assert(reopenedModelStep?.status === "ready", "CalOptima preparation failure did not reopen the model step for retry");
  const failedAttemptResult = await client.query(
    "select status, error_class, error_code from public.agent_work_attempts where id = $1::uuid",
    [failedPreparationAttempt.attempt_id],
  );
  assert(
    failedAttemptResult.rows[0]?.status === "failed" &&
      failedAttemptResult.rows[0]?.error_class === "input" &&
      failedAttemptResult.rows[0]?.error_code === "authoritative_payload_unavailable",
    "CalOptima preparation failure was not recorded on the claimed attempt",
  );

  const modelAttempt = await beginModelAttempt(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    modelAttempt?.attempt_status === "running" && modelAttempt.attempt_id !== failedPreparationAttempt.attempt_id,
    "CalOptima preparation retry did not claim a fresh attempt",
  );

  await expectFailure(
    "CalOptima snapshot before draft staging",
    () => withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const { rows } = await client.query(
        `select id from public.agent_work_steps where work_item_id = $1::uuid and step_key = 'snapshot_draft_packet'`,
        [workItemId],
      );
      await client.query("select * from public.read_agent_work_advisory_projection_descriptor($1::uuid)", [rows[0]?.id]);
    }),
    /draft packet is unavailable/i,
  );

  const draftPacket = {
    programs: [{
      name: "Synthetic draft program",
      description: "Synthetic draft-only program for local contract verification.",
      rationale: "Synthetic approved evidence supports a human-review-only draft.",
      evidence_refs: [{ section_key: "synthetic_goals", source_span: `assessment_structured_section:${structuredEvidenceId}` }],
      review_flags: [],
    }],
    goals: [{
      program_name: "Synthetic draft program",
      title: "Synthetic draft goal",
      description: "Synthetic advisory goal description for local review.",
      original_text: "Synthetic approved source text for local contract verification.",
      goal_type: "child",
      target_behavior: "Synthetic observable replacement response",
      measurement_type: "Frequency",
      baseline_data: "Synthetic baseline requires clinician confirmation.",
      target_criteria: "Synthetic target requires clinician confirmation.",
      mastery_criteria: "Synthetic mastery requires clinician confirmation.",
      maintenance_criteria: "Synthetic maintenance requires clinician confirmation.",
      generalization_criteria: "Synthetic generalization requires clinician confirmation.",
      objective_data_points: ["Synthetic observation count"],
      rationale: "Synthetic approved evidence supports a draft goal for review.",
      evidence_refs: [{ section_key: "synthetic_goals", source_span: `assessment_structured_section:${structuredEvidenceId}` }],
      review_flags: ["clinician_confirmation_needed"],
    }],
    summary_rationale: "Synthetic local-only draft packet for BCBA review.",
    confidence: "low",
  };

  const completeModelAttempt = (packet = draftPacket) =>
    withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const { rows } = await client.query(
        `
          select (public.complete_agent_work_caloptima_model_attempt(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
            $7::jsonb, 11, 7, 0.001, null, null
          )).*
        `,
        [
          FIXTURES.adminA,
          FIXTURES.orgA,
          FIXTURES.clientAssigned,
          workItemId,
          modelAttempt.step_id,
          modelAttempt.attempt_id,
          JSON.stringify(packet),
        ],
      );
      return rows[0];
    }, { commit: true });

  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.agent_runtime_config set actions_disabled = true where config_key = 'global'",
    );
  }, { commit: true });
  await expectFailure(
    "CalOptima draft snapshot after runtime kill switch",
    () => completeModelAttempt(),
    /runtime policy disabled/i,
  );

  const disabledDraftCount = await client.query(
    `
      select (
        select count(*)::integer from public.assessment_draft_programs where assessment_document_id = $1::uuid
      ) + (
        select count(*)::integer from public.assessment_draft_goals where assessment_document_id = $1::uuid
      ) as count
    `,
    [documentId],
  );
  assert(disabledDraftCount.rows[0]?.count === 0, "Runtime kill switch allowed CalOptima draft persistence");
  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.agent_runtime_config set actions_disabled = false where config_key = 'global'",
    );
  }, { commit: true });

  await expectFailure(
    "CalOptima draft snapshot with unapproved evidence reference",
    () => completeModelAttempt({
      ...draftPacket,
      programs: draftPacket.programs.map((program) => ({
        ...program,
        evidence_refs: [{ section_key: "unapproved_section", source_span: "Synthetic invalid reference." }],
      })),
    }),
    /evidence contract/i,
  );

  const completedModelStep = await completeModelAttempt();
  assert(completedModelStep?.status === "completed", "CalOptima model suggestion was not snapshotted");
  const duplicateCompletedModelStep = await completeModelAttempt();
  assert(
    duplicateCompletedModelStep?.id === completedModelStep.id &&
      duplicateCompletedModelStep?.output_hash === completedModelStep.output_hash,
    "CalOptima model completion replay did not converge to the stored result",
  );
  const modelEffectCount = await client.query(
    `
      select count(*)::integer as count
      from public.agent_work_effects
      where work_item_id = $1::uuid and step_id = $2::uuid and effect_kind = 'model_suggestion_snapshot'
    `,
    [workItemId, modelAttempt.step_id],
  );
  assert(modelEffectCount.rows[0]?.count === 1, "CalOptima model completion replay created duplicate effects");

  const completedReplay = await beginModelAttempt(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    completedReplay?.attempt_id === modelAttempt.attempt_id &&
      completedReplay?.attempt_status === "completed" &&
      completedReplay?.output_hash === completedModelStep.output_hash,
    "CalOptima completed model replay did not converge without another provider attempt",
  );

  const draftProgramResult = await client.query(
    "select id from public.assessment_draft_programs where assessment_document_id = $1::uuid and name = $2::text",
    [documentId, draftPacket.programs[0].name],
  );
  const draftProgramId = draftProgramResult.rows[0]?.id;
  assert(draftProgramId, "CalOptima model completion did not atomically stage the draft packet");

  const readImmutablePacket = (actorId, organizationId) =>
    withActor(client, "service_role", "service_role", actorId, async () => {
      const { rows } = await client.query(
        "select * from public.read_agent_work_caloptima_draft_packet($1::uuid, $2::uuid, $3::uuid, $4::uuid)",
        [actorId, organizationId, FIXTURES.clientAssigned, workItemId],
      );
      return rows[0];
    });
  const immutableBeforeEdit = await readImmutablePacket(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    immutableBeforeEdit?.packet?.programs?.[0]?.name === draftPacket.programs[0].name &&
      immutableBeforeEdit?.packet?.goals?.[0]?.title === draftPacket.goals[0].title &&
      immutableBeforeEdit?.output_hash === completedModelStep.output_hash &&
      immutableBeforeEdit?.packet_hash === immutableBeforeEdit.output_hash,
    "CalOptima immutable replay packet did not match the SQL-owned model result",
  );
  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.assessment_draft_programs set description = 'Synthetic clinician edit after snapshot.' where id = $1::uuid",
      [draftProgramId],
    );
  }, { commit: true });
  const immutableAfterEdit = await readImmutablePacket(FIXTURES.adminA, FIXTURES.orgA);
  assert(
    JSON.stringify(immutableAfterEdit) === JSON.stringify(immutableBeforeEdit),
    "CalOptima immutable replay changed after editable draft-domain mutation",
  );
  await expectFailure(
    "CalOptima cross-tenant immutable replay",
    () => readImmutablePacket(FIXTURES.adminB, FIXTURES.orgA),
    /forbidden/i,
  );

  const snapshottedStep = await client.query(
    "select status from public.agent_work_steps where work_item_id = $1::uuid and step_key = 'snapshot_draft_packet'",
    [workItemId],
  );
  assert(
    snapshottedStep.rows[0]?.status === "completed",
    "CalOptima deterministic snapshot did not atomically persist and verify the draft packet",
  );

  const getStep = async (stepKey) => {
    const { rows } = await client.query(
      "select id, status from public.agent_work_steps where work_item_id = $1::uuid and step_key = $2::text",
      [workItemId, stepKey],
    );
    return rows[0];
  };
  const requestHandoff = (stepId) =>
    withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const { rows } = await client.query(
        `
          select public.request_agent_work_approval_handoff(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'clinical_review_handoff', $5::timestamptz
          ) as result
        `,
        [FIXTURES.adminA, workItemId, stepId, FIXTURES.bcbaA, new Date(Date.now() + 300_000).toISOString()],
      );
      return rows[0]?.result;
    }, { commit: true });
  const decideApproval = (approvalId) =>
    withActor(client, "service_role", "service_role", FIXTURES.bcbaA, async () => {
      const { rows } = await client.query(
        `select public.decide_agent_work_approval($1::uuid, $2::uuid, $3::uuid, 'approve', 'clinical_review_accepted') as result`,
        [FIXTURES.bcbaA, workItemId, approvalId],
      );
      return rows[0]?.result;
    }, { commit: true });

  const assignStep = await getStep("assign_clinical_owner");
  assert(assignStep?.status === "ready", "CalOptima clinical owner step was not promoted to ready");
  const staleHandoff = await requestHandoff(assignStep.id);
  assert(staleHandoff?.outcome === "created", "CalOptima clinical owner handoff was not created");

  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.assessment_structured_sections set payload = '{\"synthetic\":true,\"revision\":2}'::jsonb where id = $1::uuid",
      [structuredEvidenceId],
    );
  }, { commit: true });
  await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select public.refresh_agent_work_caloptima_evidence($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result",
      [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, workItemId],
    );
    assert(rows[0]?.result?.revoked === 1, "CalOptima evidence refresh did not revoke the stale approval");
  }, { commit: true });
  const staleApproval = await client.query(
    "select status, revoked_reason_code from public.agent_work_approvals where id = $1::uuid",
    [staleHandoff.approval_id],
  );
  assert(
    staleApproval.rows[0]?.status === "revoked" && staleApproval.rows[0]?.revoked_reason_code === "evidence_hash_changed",
    "CalOptima stale approval was not revoked for evidence_hash_changed",
  );

  let currentHandoff = await requestHandoff(assignStep.id);
  let assigned = await decideApproval(currentHandoff.approval_id);
  assert(assigned?.outcome === "decided", "CalOptima BCBA owner handoff was not approved");

  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.assessment_draft_programs set rationale = rationale || ' Synthetic clinician revision.' where id = $1::uuid",
      [draftProgramId],
    );
  }, { commit: true });
  await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select public.refresh_agent_work_caloptima_evidence($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result",
      [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, workItemId],
    );
    assert(
      rows[0]?.result?.revoked === 1 && rows[0]?.result?.reopened === 1,
      "CalOptima consumed approval drift did not revoke and reopen the decision step",
    );
  }, { commit: true });
  const reopenedAssignStep = await getStep("assign_clinical_owner");
  assert(
    reopenedAssignStep?.status === "needs_approval",
    "CalOptima evidence drift did not return the completed step to needs_approval",
  );
  currentHandoff = await requestHandoff(assignStep.id);
  assigned = await decideApproval(currentHandoff.approval_id);
  assert(assigned?.outcome === "decided", "CalOptima reopened BCBA owner handoff was not approved");

  const reviewStep = await getStep("request_draft_review");
  assert(reviewStep?.status === "ready", "CalOptima draft review step was not promoted to ready");
  const reviewHandoff = await requestHandoff(reviewStep.id);
  const reviewDecision = await decideApproval(reviewHandoff.approval_id);
  assert(reviewDecision?.outcome === "decided", "CalOptima draft review handoff was not approved");

  const after = await client.query(
    `
      select
        (select status from public.agent_work_items where id = $1::uuid) as work_status,
        (select status from public.assessment_documents where id = $2::uuid) as document_status,
        (select count(*)::integer from public.programs where client_id = $3::uuid) as program_count,
        (select count(*)::integer from public.goals where client_id = $3::uuid) as goal_count,
        (select count(*)::integer from public.assessment_draft_programs where assessment_document_id = $2::uuid and accept_state = 'pending') as draft_program_count,
        (select count(*)::integer from public.assessment_draft_goals where assessment_document_id = $2::uuid and accept_state = 'pending') as draft_goal_count
    `,
    [workItemId, documentId, FIXTURES.clientAssigned],
  );
  assert(after.rows[0]?.work_status === "needs_review", "CalOptima lifecycle did not terminate at human review");
  assert(
    after.rows[0]?.document_status === before.rows[0]?.document_status &&
      after.rows[0]?.program_count === before.rows[0]?.program_count &&
      after.rows[0]?.goal_count === before.rows[0]?.goal_count &&
      after.rows[0]?.draft_program_count === 1 &&
      after.rows[0]?.draft_goal_count === 1,
    "CalOptima advisory workflow did not preserve the no promotion contract",
  );
};

const createWorkItems = async (client) => {
  const assignedWorkItemId = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      `
        select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text) as id
      `,
      [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 1, `ledger-contract-assigned-${RUN_TOKEN}`],
    );
    return rows[0]?.id;
  }, { commit: true });

  const unassignedWorkItemId = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      `
        select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text) as id
      `,
      [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientUnassigned, FIXTURES.docUnassigned, 1, `ledger-contract-unassigned-${RUN_TOKEN}`],
    );
    return rows[0]?.id;
  }, { commit: true });

  assert(assignedWorkItemId, "Assigned work item creation did not return an id");
  assert(unassignedWorkItemId, "Unassigned work item creation did not return an id");

  return { assignedWorkItemId, unassignedWorkItemId };
};

const assertManagePredicateParity = async (client) => {
  const cases = [
    [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, true],
    [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientUnassigned, true],
    [FIXTURES.bcbaA, FIXTURES.orgA, FIXTURES.clientAssigned, true],
    [FIXTURES.bcbaA, FIXTURES.orgA, FIXTURES.clientUnassigned, true],
    [FIXTURES.btA, FIXTURES.orgA, FIXTURES.clientAssigned, false],
    [FIXTURES.adminB, FIXTURES.orgA, FIXTURES.clientAssigned, false],
  ];

  for (const [actorId, organizationId, clientId, expected] of cases) {
    const { rows } = await withActor(
      client,
      "service_role",
      "authenticated",
      actorId,
      async () =>
        client.query(
          `
            select
              app.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as legacy_allowed,
              app.actor_can_manage_agent_work_row($3::uuid, $1::uuid, $2::uuid) as actor_allowed,
              public.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as api_allowed
          `,
          [organizationId, clientId, actorId],
        ),
    );
    assert(
      rows[0]?.legacy_allowed === expected &&
        rows[0]?.actor_allowed === expected &&
        rows[0]?.api_allowed === expected,
      `Manage predicate parity failed for actor ${actorId}`,
    );
  }

  for (const roleName of ["org_admin", "org_super_admin"]) {
    const { rows } = await withOwnerSetupAndActor(
      client,
      async () => {
        await client.query(
          `insert into public.roles (name, description)
           values ($1::text, 'Synthetic legacy storage-role alias')
           on conflict (name) do nothing`,
          [roleName],
        );
        await client.query(
          "alter table public.user_roles disable trigger sync_profile_role_update_trigger",
        );
        await client.query(
          `update public.user_roles
           set role_id = (select id from public.roles where name = $2::text)
           where user_id = $1::uuid
             and role_id = (select id from public.roles where name = 'admin')`,
          [FIXTURES.adminA, roleName],
        );
        await client.query(
          "alter table public.user_roles enable trigger sync_profile_role_update_trigger",
        );
      },
      "service_role",
      "authenticated",
      FIXTURES.adminA,
      () => client.query(
        `select
           app.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as legacy_allowed,
           app.actor_can_manage_agent_work_row($3::uuid, $1::uuid, $2::uuid) as actor_allowed,
           public.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as api_allowed`,
        [FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.adminA],
      ),
    );
    assert(
      rows[0]?.legacy_allowed === true &&
        rows[0]?.actor_allowed === true &&
        rows[0]?.api_allowed === true,
      `Alias manage predicate parity failed for ${roleName}`,
    );
  }
};

const assertCreateContainmentAndConcurrency = async (connectionString) => {
  const authenticatedClient = new Client({ connectionString });
  await authenticatedClient.connect();
  try {
    await expectFailure(
      "authenticated work-item RPC execution",
      () =>
        withActor(authenticatedClient, "authenticated", "authenticated", FIXTURES.adminA, async () => {
          await authenticatedClient.query(
            "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text)",
            [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `authenticated-denied-${RUN_TOKEN}`],
          );
        }),
      /permission denied/i,
    );
  } finally {
    await authenticatedClient.end();
  }

  const serviceClient = new Client({ connectionString });
  await serviceClient.connect();
  try {
    await expectFailure(
      "cross-tenant supplied actor",
      () =>
        withActor(serviceClient, "service_role", "service_role", FIXTURES.adminA, async () => {
          await serviceClient.query(
            "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text)",
            [FIXTURES.adminB, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `spoofed-actor-${RUN_TOKEN}`],
          );
        }),
      /forbidden/i,
    );

    await expectFailure(
      "null supplied actor",
      () =>
        withActor(serviceClient, "service_role", "service_role", FIXTURES.adminA, async () => {
          await serviceClient.query(
            "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text)",
            [null, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `null-actor-${RUN_TOKEN}`],
          );
        }),
      /invalid work-item input/i,
    );

    const { rows: profilelessRows } = await withOwnerSetupAndActor(
      serviceClient,
      async () => {
        await serviceClient.query("select set_config('app.bypass_profile_role_guard', 'on', true)");
        await serviceClient.query(
          "update public.profiles set organization_id = null where id = $1::uuid",
          [FIXTURES.adminA],
        );
      },
      "service_role",
      "authenticated",
      FIXTURES.adminA,
      async () =>
        serviceClient.query(
          `
            select
              app.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as rls_allowed,
              public.current_user_can_manage_agent_work_row($1::uuid, $2::uuid) as api_allowed
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned],
        ),
    );
    assert(
      profilelessRows[0]?.rls_allowed === false &&
        profilelessRows[0]?.api_allowed === false,
      "Profileless actor metadata must not authorize RLS or API manage predicates",
    );

    await expectFailure(
      "profileless supplied actor",
      () =>
        withOwnerSetupAndActor(
          serviceClient,
          async () => {
            await serviceClient.query("select set_config('app.bypass_profile_role_guard', 'on', true)");
            await serviceClient.query(
              "update public.profiles set organization_id = null where id = $1::uuid",
              [FIXTURES.adminA],
            );
          },
          "service_role",
          "service_role",
          FIXTURES.adminA,
          async () => {
            await serviceClient.query(
              "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text)",
              [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `profileless-actor-${RUN_TOKEN}`],
            );
          },
        ),
      /forbidden/i,
    );
  } finally {
    await serviceClient.end();
  }

  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  await Promise.all(clients.map((client) => client.connect()));
  try {
    const ids = await Promise.all(
      clients.map((client) =>
        withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
          const { rows } = await client.query(
            "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text) as id",
            [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `concurrent-create-${RUN_TOKEN}`],
          );
          return rows[0]?.id;
        }, { commit: true })
      ),
    );
    assert(ids[0] && ids[1] && ids[0] === ids[1], "Concurrent duplicate creates must return one work-item id");

    await expectFailure(
      "cross-document dedupe collision",
      () =>
        withActor(clients[0], "service_role", "service_role", FIXTURES.adminA, async () => {
          await clients[0].query(
            "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, $5::text)",
            [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientUnassigned, FIXTURES.docUnassigned, `concurrent-create-${RUN_TOKEN}`],
          );
        }),
      /dedupe key scope mismatch/i,
    );
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
};

const assertRecomputedTerminalStatuses = async (client) => {
  const workItemId = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, 3, $5::text) as id",
      [FIXTURES.adminA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, `status-recompute-${RUN_TOKEN}`],
    );
    return rows[0]?.id;
  }, { commit: true });
  assert(workItemId, "Status recompute fixture creation did not return an id");

  await withOwnerTransaction(client, async () => {
    await client.query(
      "update public.agent_work_steps set status = 'cancelled', attempt_count = 0 where work_item_id = $1::uuid",
      [workItemId],
    );
    const { rows } = await client.query(
      "select public.agent_work_recompute_item_status($1::uuid) as status",
      [workItemId],
    );
    assert(rows[0]?.status === "cancelled", `Cancelled terminal graph recomputed as ${rows[0]?.status}`);

    await client.query(
      `
        update public.agent_work_steps
        set status = case when ordinal = 10 then 'failed'::public.agent_work_step_status else 'cancelled'::public.agent_work_step_status end,
            attempt_count = case when ordinal = 10 then 1 else 0 end,
            max_attempts = 3
        where work_item_id = $1::uuid
      `,
      [workItemId],
    );
    const { rows: blockedRows } = await client.query(
      "select public.agent_work_recompute_item_status($1::uuid) as status",
      [workItemId],
    );
    assert(blockedRows[0]?.status === "blocked", `Recoverable failed graph recomputed as ${blockedRows[0]?.status}`);

    await client.query(
      "update public.agent_work_steps set attempt_count = max_attempts where work_item_id = $1::uuid and status = 'failed'",
      [workItemId],
    );
    const { rows: failedRows } = await client.query(
      "select public.agent_work_recompute_item_status($1::uuid) as status",
      [workItemId],
    );
    assert(failedRows[0]?.status === "failed", `Retry-exhausted graph recomputed as ${failedRows[0]?.status}`);
  });
};

const assertDirectMutationDenials = async (client, assignedWorkItemId) => {
  await expectFailure(
    "authenticated direct insert into agent_work_items",
    () =>
      withActor(client, "authenticated", "authenticated", FIXTURES.adminA, async () => {
        await client.query(
          `
            insert into public.agent_work_items (
              id,
              organization_id,
              client_id,
              workflow_key,
              workflow_version,
              objective,
              dedupe_key
            ) values (
              gen_random_uuid(),
              $1::uuid,
              $2::uuid,
              'illegal.direct.insert',
              1,
              'should fail',
              'illegal-direct-insert'
            )
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned],
        );
      }),
    /(permission denied|new row violates row-level security policy)/i,
  );

  await expectFailure(
    "anon direct insert into agent_work_items",
    () =>
      withActor(client, "anon", "anon", null, async () => {
        await client.query(
          `
            insert into public.agent_work_items (
              id,
              organization_id,
              client_id,
              workflow_key,
              workflow_version,
              objective,
              dedupe_key
            ) values (
              gen_random_uuid(),
              $1::uuid,
              $2::uuid,
              'illegal.anon.insert',
              1,
              'should fail',
              'illegal-anon-insert'
            )
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned],
        );
      }),
    /(permission denied|new row violates row-level security policy)/i,
  );

  const { rows: stepRows } = await client.query(
    "select id from public.agent_work_steps where work_item_id = $1::uuid order by ordinal limit 1",
    [assignedWorkItemId],
  );
  const stepId = stepRows[0]?.id;
  assert(stepId, "Expected a seeded step for service-role mutation denials");

  await expectFailure(
    "service_role approval synthesis",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          `
            insert into public.agent_work_approvals (
              work_item_id,
              step_id,
              organization_id,
              client_id,
              required_role,
              status,
              input_hash,
              evidence_hash
            ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'bcba', 'approved', $5::text, $6::text)
          `,
          [assignedWorkItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A, HASH_B],
        );
      }),
    /permission denied/i,
  );

  await expectFailure(
    "service_role evidence synthesis",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          `
            insert into public.agent_work_evidence (
              work_item_id,
              step_id,
              organization_id,
              client_id,
              source_kind,
              source_id,
              sha256
            ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'work_step', $2::uuid, $5::text)
          `,
          [assignedWorkItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
        );
      }),
    /permission denied/i,
  );

  await expectFailure(
    "service_role direct work-item update",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query("update public.agent_work_items set objective = 'illegal update' where id = $1::uuid", [
          assignedWorkItemId,
        ]);
      }),
    /permission denied/i,
  );

  const evidenceId = randomUUID();
  await client.query(
    `
      insert into public.agent_work_evidence (
        id,
        work_item_id,
        step_id,
        organization_id,
        client_id,
        source_kind,
        source_id,
        sha256
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'work_step', $3::uuid, $6::text)
    `,
    [evidenceId, assignedWorkItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
  );

  await expectFailure(
    "service_role direct evidence delete",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query("delete from public.agent_work_evidence where id = $1::uuid", [evidenceId]);
      }),
    /permission denied/i,
  );

  await expectFailure(
    "service_role direct effects truncate",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query("truncate table public.agent_work_effects");
      }),
    /permission denied/i,
  );

  const { rows: eventRows } = await client.query(
    `
      select id
      from public.agent_work_events
      where work_item_id = $1::uuid
      order by created_at asc
      limit 1
    `,
    [assignedWorkItemId],
  );
  const eventId = eventRows[0]?.id;
  assert(eventId, "Expected a seeded agent_work_events row");

  await expectFailure(
    "service_role update of agent_work_events",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          `
            update public.agent_work_events
            set sanitized_metadata = sanitized_metadata || '{"illegal":true}'::jsonb
            where id = $1::uuid
          `,
          [eventId],
        );
      }),
    /(permission denied|append-only)/i,
  );

  await expectFailure(
    "service_role delete of agent_work_events",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query("delete from public.agent_work_events where id = $1::uuid", [eventId]);
      }),
    /(permission denied|append-only)/i,
  );

  await expectFailure(
    "owner update of append-only agent_work_events",
    () =>
      withOwnerTransaction(client, async () => {
        await client.query(
          `
            update public.agent_work_events
            set sanitized_metadata = sanitized_metadata || '{"illegal":true}'::jsonb
            where id = $1::uuid
          `,
          [eventId],
        );
      }),
    /append-only/i,
  );

  await expectFailure(
    "owner delete of append-only agent_work_events",
    () =>
      withOwnerTransaction(client, async () => {
        await client.query("delete from public.agent_work_events where id = $1::uuid", [eventId]);
      }),
    /append-only/i,
  );
};

const assertOrganizationAndClientIsolation = async (client, assignedWorkItemId, unassignedWorkItemId) => {
  await expectFailure(
    "cross-org admin work-item creation",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminB, async () => {
        await client.query(
          `
            select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text)
          `,
          [FIXTURES.adminB, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 2, "cross-org-denied"],
        );
      }),
    /forbidden|scope mismatch/i,
  );

  await expectFailure(
    "bt work-item creation",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.btA, async () => {
        await client.query(
          `
            select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text)
          `,
          [FIXTURES.btA, FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 2, "bt-denied"],
        );
      }),
    /forbidden/i,
  );

  for (const [label, actorId] of [["assigned BT", FIXTURES.btA], ["cross-org admin", FIXTURES.adminB]]) {
    await expectFailure(
      `${label} direct ledger base-table read`,
      () => withActor(client, "authenticated", "authenticated", actorId, async () => {
        await client.query(
          "select count(*) from public.agent_work_items where id in ($1::uuid, $2::uuid)",
          [assignedWorkItemId, unassignedWorkItemId],
        );
      }),
      /permission denied/i,
    );
  }
};

const assertDependencyTenantScope = async (client, assignedWorkItemId, unassignedWorkItemId) => {
  await expectFailure(
    "cross-client work-item dependency",
    () =>
      withOwnerTransaction(client, async () => {
        await client.query(
          `
            insert into public.agent_work_item_dependencies (
              organization_id,
              predecessor_work_item_id,
              successor_work_item_id
            ) values ($1::uuid, $2::uuid, $3::uuid)
          `,
          [FIXTURES.orgA, assignedWorkItemId, unassignedWorkItemId],
        );
      }),
    /dependency.*scope mismatch/i,
  );

  await expectFailure(
    "null-client work-item dependency mismatch",
    () =>
      withOwnerTransaction(client, async () => {
        const { rows } = await client.query(
          `
            insert into public.agent_work_items (
              organization_id,
              client_id,
              workflow_key,
              workflow_version,
              objective,
              status,
              dedupe_key
            ) values ($1::uuid, null, 'contract.dependency.org', 1, 'Synthetic organization-level dependency fixture.', 'queued', $2::text)
            returning id
          `,
          [FIXTURES.orgA, `dependency-null-${RUN_TOKEN}`],
        );

        await client.query(
          `
            insert into public.agent_work_item_dependencies (
              organization_id,
              predecessor_work_item_id,
              successor_work_item_id
            ) values ($1::uuid, $2::uuid, $3::uuid)
          `,
          [FIXTURES.orgA, rows[0].id, assignedWorkItemId],
        );
      }),
    /dependency.*scope mismatch/i,
  );

  await expectFailure(
    "cross-client parent work item",
    () =>
      withOwnerTransaction(client, async () => {
        await client.query(
          "update public.agent_work_items set parent_work_item_id = $1::uuid where id = $2::uuid",
          [assignedWorkItemId, unassignedWorkItemId],
        );
      }),
    /parent.*scope mismatch/i,
  );

  await expectFailure(
    "cross-org parent work item",
    () =>
      withOwnerTransaction(client, async () => {
        const { rows } = await client.query(
          `
            insert into public.agent_work_items (
              organization_id,
              client_id,
              workflow_key,
              workflow_version,
              objective,
              status,
              dedupe_key
            ) values ($1::uuid, $2::uuid, 'contract.parent.cross-org', 1, 'Synthetic cross-organization parent fixture.', 'queued', $3::text)
            returning id
          `,
          [FIXTURES.orgB, FIXTURES.clientCrossOrg, `parent-cross-org-${RUN_TOKEN}`],
        );

        await client.query(
          "update public.agent_work_items set parent_work_item_id = $1::uuid where id = $2::uuid",
          [assignedWorkItemId, rows[0].id],
        );
      }),
    /parent.*scope mismatch/i,
  );

  await expectFailure(
    "dependency endpoint client mutation",
    () =>
      withOwnerTransaction(client, async () => {
        const { rows } = await client.query(
          `
            insert into public.agent_work_items (
              organization_id,
              client_id,
              workflow_key,
              workflow_version,
              objective,
              status,
              dedupe_key
            ) values ($1::uuid, $2::uuid, 'contract.dependency.scope-mutation', 1, 'Synthetic dependency scope-mutation fixture.', 'queued', $3::text)
            returning id
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned, `dependency-mutation-${RUN_TOKEN}`],
        );
        const successorId = rows[0].id;

        await client.query(
          `
            insert into public.agent_work_item_dependencies (
              organization_id,
              predecessor_work_item_id,
              successor_work_item_id
            ) values ($1::uuid, $2::uuid, $3::uuid)
          `,
          [FIXTURES.orgA, assignedWorkItemId, successorId],
        );

        await client.query(
          "update public.agent_work_items set client_id = $1::uuid where id = $2::uuid",
          [FIXTURES.clientUnassigned, successorId],
        );
      }),
    /graph tenant scope mutation/i,
  );
};

const assertDependencyEndpointReadPolicy = async (client, assignedWorkItemId, unassignedWorkItemId) => {
  await client.query("begin");

  try {
    await client.query("alter table public.agent_work_item_dependencies disable trigger agent_work_item_dependencies_enforce_scope");
    const { rows } = await client.query(
      `
        insert into public.agent_work_item_dependencies (
          organization_id,
          predecessor_work_item_id,
          successor_work_item_id
        ) values ($1::uuid, $2::uuid, $3::uuid)
        returning id
      `,
      [FIXTURES.orgA, assignedWorkItemId, unassignedWorkItemId],
    );
    const dependencyId = rows[0].id;
    await client.query("alter table public.agent_work_item_dependencies enable trigger agent_work_item_dependencies_enforce_scope");

    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: FIXTURES.btA }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [FIXTURES.btA]);

    await expectFailure(
      "authenticated dependency base-table read",
      () => client.query(
        "select count(*) from public.agent_work_item_dependencies where id = $1::uuid",
        [dependencyId],
      ),
      /permission denied/i,
    );
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const assertParentEndpointReadPolicy = async (client, assignedWorkItemId, unassignedWorkItemId) => {
  await client.query("begin");

  try {
    await client.query("alter table public.agent_work_items disable trigger agent_work_items_enforce_parent_scope");
    const { rows: parentRows } = await client.query(
      `
        insert into public.agent_work_items (
          organization_id,
          client_id,
          workflow_key,
          workflow_version,
          objective,
          status,
          dedupe_key
        ) values (
          $1::uuid,
          $2::uuid,
          'contract.parent.endpoint',
          1,
          'Synthetic nested parent visibility fixture.',
          'queued',
          $3::text
        )
        returning id
      `,
      [FIXTURES.orgA, FIXTURES.clientAssigned, `parent-endpoint-${RUN_TOKEN}`],
    );
    const parentWorkItemId = parentRows[0]?.id;
    assert(parentWorkItemId, "Nested parent visibility fixture was not created");
    await client.query(
      "update public.agent_work_items set parent_work_item_id = $1::uuid where id = $2::uuid",
      [unassignedWorkItemId, parentWorkItemId],
    );
    await client.query(
      "update public.agent_work_items set parent_work_item_id = $1::uuid where id = $2::uuid",
      [parentWorkItemId, assignedWorkItemId],
    );
    await client.query("alter table public.agent_work_items enable trigger agent_work_items_enforce_parent_scope");
    await client.query("grant usage on schema app to authenticated");

    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: FIXTURES.btA }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [FIXTURES.btA]);

    const { rows: parentEndpointRows } = await client.query(
      "select public.current_user_can_read_agent_work_item_endpoint($1::uuid) as allowed",
      [parentWorkItemId],
    );
    assert(
      parentEndpointRows[0]?.allowed === false,
      "Parent with a hidden ancestor remained visible through the Edge authority RPC",
    );
    const { rows: rlsHelperRows } = await client.query(
      "select app.current_user_can_read_agent_work_item_endpoint($1::uuid) as allowed",
      [assignedWorkItemId],
    );
    assert(
      rlsHelperRows[0]?.allowed === false,
      "Descendant with a hidden ancestor remained visible through the RLS authority helper",
    );
    const { rows: endpointRows } = await client.query(
      "select public.current_user_can_read_agent_work_item_endpoint($1::uuid) as allowed",
      [assignedWorkItemId],
    );
    assert(
      endpointRows[0]?.allowed === false,
      "Descendant with a hidden ancestor remained visible through the Edge authority RPC",
    );
    await expectFailure(
      "authenticated parent base-table read",
      () => client.query(
        "select count(*) from public.agent_work_items where id = $1::uuid",
        [assignedWorkItemId],
      ),
      /permission denied/i,
    );
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const assertApprovalRoleEnforcement = async (client, assignedWorkItemId) => {
  const { rows: stepRows } = await client.query(
    `
      select id
      from public.agent_work_steps
      where work_item_id = $1::uuid
        and step_key = 'assign_clinical_owner'
      limit 1
    `,
    [assignedWorkItemId],
  );
  const stepId = stepRows[0]?.id;
  assert(stepId, "Expected assign_clinical_owner step for approval test");

  await client.query(
    `
      insert into public.agent_work_approvals (
        id,
        work_item_id,
        step_id,
        organization_id,
        client_id,
        required_role,
        status,
        input_hash,
        evidence_hash,
        requested_by
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::uuid,
        'bcba',
        'pending',
        $6::text,
        $7::text,
        $8::uuid
      )
      on conflict (id) do nothing
    `,
    [
      FIXTURES.approvalAssigned,
      assignedWorkItemId,
      stepId,
      FIXTURES.orgA,
      FIXTURES.clientAssigned,
      HASH_A,
      HASH_B,
      FIXTURES.adminA,
    ],
  );

  for (const [label, actorId] of [
    ["BT", FIXTURES.btA],
    ["admin", FIXTURES.adminA],
    ["BCBA", FIXTURES.bcbaA],
  ]) {
    await expectFailure(
      `${label} direct approval base-table read`,
      () => withActor(client, "authenticated", "authenticated", actorId, async () => {
        await client.query(
          "select count(*) from public.agent_work_approvals where id = $1::uuid",
          [FIXTURES.approvalAssigned],
        );
      }),
      /permission denied/i,
    );
  }
};

const assertClaimEligibility = async (client) => {
  for (const terminalStatus of ["completed", "failed", "cancelled"]) {
    const { rows } = await client.query(
      `
        insert into public.agent_work_items (
          organization_id,
          client_id,
          workflow_key,
          workflow_version,
          objective,
          status,
          dedupe_key
        ) values ($1::uuid, $2::uuid, 'contract.claim.terminal', 1, 'Synthetic terminal claim fixture.', $3::public.agent_work_item_status, $4::text)
        returning id
      `,
      [FIXTURES.orgA, FIXTURES.clientAssigned, terminalStatus, `terminal-${terminalStatus}-${RUN_TOKEN}`],
    );
    const workItemId = rows[0].id;

    await client.query(
      `
        insert into public.agent_work_steps (
          work_item_id,
          organization_id,
          client_id,
          step_key,
          ordinal,
          execution_mode,
          status
        ) values ($1::uuid, $2::uuid, $3::uuid, 'terminal_ready', 10, 'deterministic', 'ready')
      `,
      [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned],
    );

    await expectFailure(
      `${terminalStatus} work-item claim`,
      () =>
        withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
          await client.query("select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)", [
            workItemId,
            "worker-terminal",
            120,
          ]);
        }),
      /terminal work item/i,
    );
  }

  const { rows: humanItemRows } = await client.query(
    `
      insert into public.agent_work_items (
        organization_id,
        client_id,
        workflow_key,
        workflow_version,
        objective,
        status,
        dedupe_key
      ) values ($1::uuid, $2::uuid, 'contract.claim.human', 1, 'Synthetic human-step claim fixture.', 'queued', $3::text)
      returning id
    `,
    [FIXTURES.orgA, FIXTURES.clientAssigned, `human-${RUN_TOKEN}`],
  );
  const humanWorkItemId = humanItemRows[0].id;

  await client.query(
    `
      insert into public.agent_work_steps (
        work_item_id,
        organization_id,
        client_id,
        step_key,
        ordinal,
        execution_mode,
        status,
        required_role
      ) values ($1::uuid, $2::uuid, $3::uuid, 'human_ready', 10, 'human', 'ready', 'bcba')
    `,
    [humanWorkItemId, FIXTURES.orgA, FIXTURES.clientAssigned],
  );

  const humanClaimCount = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows: claimRows } = await client.query(
      "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
      [humanWorkItemId, "worker-human", 120],
    );
    return claimRows.length;
  });

  assert(humanClaimCount === 0, `Human execution steps must be unclaimable, found ${humanClaimCount} claimed row(s)`);
};

const assertModelAttemptSnapshot = async (client) => {
  const workItemId = randomUUID();
  const stepId = randomUUID();
  const attemptId = randomUUID();
  const evidenceSourceId = randomUUID();
  const outOfScopeEvidenceSourceId = randomUUID();

  await withOwnerSetupAndActor(
    client,
    async () => {
      await client.query(
        `
          insert into public.agent_work_items (
            id, organization_id, client_id, workflow_key, workflow_version,
            objective, status, dedupe_key
          ) values (
            $1::uuid, $2::uuid, $3::uuid,
            'assessment.iehp.prepare_for_clinical_review', 1,
            'Synthetic model-attempt contract fixture.', 'running', $4::text
          )
        `,
        [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `model-attempt-${RUN_TOKEN}`],
      );
      await client.query(
        `
          insert into public.agent_work_steps (
            id, work_item_id, organization_id, client_id, step_key, ordinal,
            execution_mode, status, attempt_count, lease_owner
          ) values (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            'validate_review_evidence', 10, 'model_suggested', 'running', 1,
            'model-contract-worker'
          )
        `,
        [stepId, workItemId, FIXTURES.orgA, FIXTURES.clientAssigned],
      );
      await client.query(
        `
          insert into public.agent_work_attempts (
            id, work_item_id, step_id, organization_id, client_id,
            attempt_number, worker_id, status
          ) values (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
            1, 'model-contract-worker', 'running'
          )
        `,
        [attemptId, workItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned],
      );
      await client.query(
        `
          insert into public.agent_work_evidence (
            work_item_id, step_id, organization_id, client_id,
            source_kind, source_id, sha256, metadata
          ) values (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            'assessment_checklist_item', $5::uuid, $6::text, '{}'::jsonb
          )
        `,
        [
          workItemId,
          stepId,
          FIXTURES.orgA,
          FIXTURES.clientAssigned,
          evidenceSourceId,
          HASH_A,
        ],
      );
      await client.query(
        `
          insert into public.agent_work_evidence (
            work_item_id, step_id, organization_id, client_id,
            source_kind, source_id, sha256, metadata
          ) values (
            $1::uuid, null, $2::uuid, $3::uuid,
            'assessment_checklist_item', $4::uuid, $5::text, '{}'::jsonb
          )
        `,
        [
          workItemId,
          FIXTURES.orgA,
          FIXTURES.clientAssigned,
          outOfScopeEvidenceSourceId,
          HASH_B,
        ],
      );
    },
    "service_role",
    "service_role",
    FIXTURES.adminA,
    async () => {
      const snapshotArgs = [
        FIXTURES.adminA,
        FIXTURES.orgA,
        FIXTURES.clientAssigned,
        workItemId,
        stepId,
        attemptId,
        1,
        `corr-${RUN_TOKEN}`,
        `req-${RUN_TOKEN}`,
        "openai",
        "gpt-4o",
        "v1",
        "v1",
        0.2,
        "assessment-remediation-code-only-v1",
        "gpt-4o-estimate-v1",
      ];
      const { rows: snapshotRows } = await client.query(
        "select * from public.snapshot_agent_work_model_attempt($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::text,$9::text,$10::text,$11::text,$12::text,$13::text,$14::numeric,$15::text,$16::text)",
        snapshotArgs,
      );
      assert(snapshotRows.length === 1, "Expected one authoritative model-attempt snapshot row");
      assert(
        snapshotRows[0].evidence_source_ids?.includes(evidenceSourceId),
        "Snapshot must return the authoritative evidence source",
      );
      assert(
        !snapshotRows[0].evidence_source_ids?.includes(outOfScopeEvidenceSourceId),
        "Snapshot must exclude evidence outside the bound model-attempt step",
      );

      await expectFailureInTransaction(
        client,
        "duplicate model-attempt snapshot",
        () =>
          client.query(
            "select * from public.snapshot_agent_work_model_attempt($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::text,$9::text,$10::text,$11::text,$12::text,$13::text,$14::numeric,$15::text,$16::text)",
            snapshotArgs,
          ),
        /already snapshotted/i,
      );

      await client.query(
        "select public.record_agent_work_model_attempt_result($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::integer,$9::numeric,$10::text,$11::text)",
        [
          FIXTURES.adminA,
          FIXTURES.orgA,
          FIXTURES.clientAssigned,
          workItemId,
          stepId,
          attemptId,
          12,
          5,
          0.00008,
          null,
          null,
        ],
      );

      const { rows } = await client.query(
        `
          select attempt.provider, attempt.model, attempt.input_token_count,
                 attempt.output_token_count, step.status as step_status
          from public.agent_work_attempts attempt
          join public.agent_work_steps step on step.id = attempt.step_id
          where attempt.id = $1::uuid
        `,
        [attemptId],
      );
      assert(rows[0]?.provider === "openai", "Snapshot provider was not persisted");
      assert(rows[0]?.model === "gpt-4o", "Snapshot model was not persisted");
      assert(rows[0]?.input_token_count === 12, "Input token count was not recorded");
      assert(rows[0]?.output_token_count === 5, "Output token count was not recorded");
      assert(rows[0]?.step_status === "running", "Model result must not transition the workflow step");
    },
  );
};

const assertHumanTransitionDenials = async (client) => {
  const transitions = [
    ["pending", "ready"],
    ["pending", "cancelled"],
    ["pending", "skipped"],
    ["ready", "running"],
    ["ready", "cancelled"],
    ["ready", "skipped"],
    ["running", "waiting"],
    ["running", "needs_approval"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "ready"],
    ["running", "cancelled"],
    ["waiting", "ready"],
    ["waiting", "failed"],
    ["waiting", "cancelled"],
    ["needs_approval", "ready"],
    ["needs_approval", "completed"],
    ["needs_approval", "failed"],
    ["failed", "ready"],
    ["failed", "cancelled"],
  ];

  for (const [fromStatus, toStatus] of transitions) {
    const workItemId = randomUUID();
    const stepId = randomUUID();

    await client.query(
      `
        insert into public.agent_work_items (
          id,
          organization_id,
          client_id,
          workflow_key,
          workflow_version,
          objective,
          status,
          dedupe_key
        ) values ($1::uuid, $2::uuid, $3::uuid, 'contract.human.transition', 1, 'Synthetic human transition fixture.', 'waiting', $4::text)
      `,
      [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `human-${fromStatus}-${toStatus}-${RUN_TOKEN}`],
    );

    await client.query(
      `
        insert into public.agent_work_steps (
          id,
          work_item_id,
          organization_id,
          client_id,
          step_key,
          ordinal,
          execution_mode,
          status,
          required_role
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, 10, 'human', $6::public.agent_work_step_status, 'bcba')
      `,
      [stepId, workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `human_${fromStatus}_${toStatus}`, fromStatus],
    );

    await expectFailure(
      `human ${fromStatus} -> ${toStatus} generic transition`,
      () =>
        withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
          await client.query(
            "select public.transition_agent_work_step($1::uuid, 0::bigint, $2::public.agent_work_step_status, $3::text, $4::text, $5::jsonb)",
            [stepId, toStatus, `human-${fromStatus}-${toStatus}`, null, "{}"],
          );
        }),
      /generic human step transitions are not allowed/i,
    );
  }
};

const assertAttemptSettlement = async (client) => {
  const settlementCases = [
    { toStatus: "completed", expectedAttemptStatus: "completed" },
    { toStatus: "failed", expectedAttemptStatus: "failed" },
    { toStatus: "cancelled", expectedAttemptStatus: "cancelled" },
    { toStatus: "ready", expectedAttemptStatus: "cancelled" },
    { toStatus: "waiting", expectedAttemptStatus: "completed" },
    { toStatus: "needs_approval", expectedAttemptStatus: "completed" },
  ];

  for (const { toStatus, expectedAttemptStatus } of settlementCases) {
    const { rows: itemRows } = await client.query(
      `
        insert into public.agent_work_items (
          organization_id,
          client_id,
          workflow_key,
          workflow_version,
          objective,
          status,
          dedupe_key
        ) values ($1::uuid, $2::uuid, 'contract.attempt.settlement', 1, 'Synthetic attempt settlement fixture.', 'queued', $3::text)
        returning id
      `,
      [FIXTURES.orgA, FIXTURES.clientAssigned, `settlement-${toStatus}-${RUN_TOKEN}`],
    );
    const workItemId = itemRows[0].id;

    await client.query(
      `
        insert into public.agent_work_steps (
          work_item_id,
          organization_id,
          client_id,
          step_key,
          ordinal,
          execution_mode,
          status
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, 10, 'deterministic', 'ready')
      `,
      [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `settle_${toStatus}`],
    );

    await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const workerId = `worker-${toStatus.replace("_", "-")}`;
      const { rows: claimRows } = await client.query(
        "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
        [workItemId, workerId, 120],
      );
      const claimedStep = claimRows[0];
      assert(claimedStep, `Expected ${toStatus} settlement fixture to be claimed`);

      const { rows: attemptRows } = await client.query(
        `
          select id
          from public.agent_work_attempts
          where step_id = $1::uuid
            and attempt_number = $2::integer
          limit 1
        `,
        [claimedStep.id, claimedStep.attempt_count],
      );
      const attemptId = attemptRows[0]?.id;
      assert(attemptId, `Expected ${toStatus} settlement fixture to create an attempt`);

      await client.query(
        "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
        [
          claimedStep.id,
          claimedStep.state_version,
          toStatus,
          `settle-${toStatus.replace("_", "-")}`,
          toStatus === "completed" ? HASH_A : null,
          JSON.stringify({ worker_id: workerId, attempt_id: attemptId, result_code: `settle-${toStatus}` }),
        ],
      );

      const { rows: settledRows } = await client.query(
        "select status, finished_at from public.agent_work_attempts where id = $1::uuid",
        [attemptId],
      );
      const settledAttempt = settledRows[0];
      assert(
        settledAttempt?.status === expectedAttemptStatus,
        `${toStatus} transition must settle attempt as ${expectedAttemptStatus}, found ${settledAttempt?.status}`,
      );
      assert(settledAttempt.finished_at, `${toStatus} transition must set attempt finished_at`);
    });
  }
};

const assertApprovalTransitionGate = async (client) => {
  const workItemId = randomUUID();
  const stepId = randomUUID();

  await client.query(
    `
      insert into public.agent_work_items (
        id,
        organization_id,
        client_id,
        workflow_key,
        workflow_version,
        objective,
        status,
        dedupe_key
      ) values ($1::uuid, $2::uuid, $3::uuid, 'contract.approval.gate', 1, 'Synthetic approval-gate fixture.', 'waiting', $4::text)
    `,
    [workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `approval-gate-${RUN_TOKEN}`],
  );

  await client.query(
    `
      insert into public.agent_work_steps (
        id,
        work_item_id,
        organization_id,
        client_id,
        step_key,
        ordinal,
        execution_mode,
        status,
        required_role,
        input_hash
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'approval_gate', 10, 'model_suggested', 'needs_approval', 'bcba', $5::text)
    `,
    [stepId, workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A],
  );

  await client.query(
    `
      insert into public.agent_work_evidence (
        work_item_id,
        step_id,
        organization_id,
        client_id,
        source_kind,
        source_id,
        sha256
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'work_step', $2::uuid, $5::text)
    `,
    [workItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_B],
  );

  const transitionWithApproval = async (approval) =>
    withOwnerSetupAndActor(
      client,
      async () => {
        if (approval) {
          await client.query(
            `
              insert into public.agent_work_approvals (
                work_item_id,
                step_id,
                organization_id,
                client_id,
                required_role,
                status,
                input_hash,
                evidence_hash,
                decided_by,
                decision_reason_code,
                decided_at,
                expires_at
              ) values (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                $4::uuid,
                $5::text,
                'approved',
                $6::text,
                $7::text,
                $8::uuid,
                'contract-approved',
                timezone('utc', now()),
                $9::timestamptz
              )
            `,
            [
              workItemId,
              stepId,
              FIXTURES.orgA,
              FIXTURES.clientAssigned,
              approval.requiredRole,
              approval.inputHash,
              approval.evidenceHash,
              approval.decidedBy,
              approval.expiresAt,
            ],
          );
        }
      },
      "service_role",
      "service_role",
      FIXTURES.adminA,
      async () => {
        const { rows } = await client.query(
          `
            select *
            from public.transition_agent_work_step($1::uuid, 0::bigint, 'completed'::public.agent_work_step_status, 'approval-complete', $2::text, $3::jsonb)
          `,
          [stepId, HASH_A, JSON.stringify({ result_code: "approval-complete" })],
        );
        return rows[0];
      },
    );

  const validApproval = {
    requiredRole: "bcba",
    inputHash: HASH_A,
    evidenceHash: HASH_B,
    decidedBy: FIXTURES.bcbaA,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };

  await expectFailure("approval bypass without approval", () => transitionWithApproval(null), /matching approved approval/i);
  await expectFailure(
    "approval bypass with wrong required role",
    () => transitionWithApproval({ ...validApproval, requiredRole: "admin" }),
    /matching approved approval/i,
  );
  await expectFailure(
    "approval bypass with wrong input hash",
    () => transitionWithApproval({ ...validApproval, inputHash: HASH_B }),
    /matching approved approval/i,
  );
  await expectFailure(
    "approval bypass with stale evidence hash",
    () => transitionWithApproval({ ...validApproval, evidenceHash: HASH_A }),
    /matching approved approval/i,
  );
  await expectFailure(
    "approval bypass with expired approval",
    () => transitionWithApproval({ ...validApproval, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    /matching approved approval/i,
  );
  await expectFailure(
    "approval bypass with wrong-role decider",
    () => transitionWithApproval({ ...validApproval, decidedBy: FIXTURES.adminA }),
    /matching approved approval/i,
  );

  const approvedStep = await withOwnerSetupAndActor(
    client,
    async () => {
      await client.query(
        `
          insert into public.agent_work_approvals (
            work_item_id,
            step_id,
            organization_id,
            client_id,
            required_role,
            status,
            input_hash,
            evidence_hash,
            decided_by,
            decision_reason_code,
            decided_at,
            expires_at
          ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'bcba', 'approved', $5::text, $6::text, $7::uuid, 'contract-approved', timezone('utc', now()), timezone('utc', now()) + interval '5 minutes')
        `,
        [workItemId, stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_A, HASH_B, FIXTURES.bcbaA],
      );
    },
    "service_role",
    "service_role",
    FIXTURES.adminA,
    async () => {
      const { rows } = await client.query(
        `
          select *
          from public.transition_agent_work_step($1::uuid, 0::bigint, 'completed'::public.agent_work_step_status, 'approval-complete', $2::text, $3::jsonb)
        `,
        [stepId, HASH_A, JSON.stringify({ result_code: "approval-complete" })],
      );
      return rows[0];
    },
    { commit: true },
  );

  assert(approvedStep?.status === "completed", `Matching approval must allow completion, found ${approvedStep?.status}`);
};

const assertClaimAndTransitionContract = async (client, assignedWorkItemId) => {
  const firstClaim = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
      [assignedWorkItemId, "worker-alpha", 120],
    );
    return rows[0];
  }, { commit: true });

  assert(firstClaim, "Expected first claim to return a ready step");
  assert(firstClaim.step_key === "validate_scope", `Expected validate_scope first, found ${firstClaim.step_key}`);
  assert(firstClaim.status === "running", `Claimed step must enter running, found ${firstClaim.status}`);
  assert(firstClaim.attempt_count === 1, `First claim should increment attempt_count to 1, found ${firstClaim.attempt_count}`);

  const { rows: attemptRows } = await client.query(
    `
      select id
      from public.agent_work_attempts
      where step_id = $1::uuid
        and attempt_number = $2::integer
        and status = 'running'
      limit 1
    `,
    [firstClaim.id, firstClaim.attempt_count],
  );
  const firstAttemptId = attemptRows[0]?.id;
  assert(firstAttemptId, "Expected claim to create a running attempt");

  await expectFailure(
    "arbitrary event metadata key",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "metadata-key",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId, notes: "free text" }),
          ],
        );
      }),
    /metadata key.*not allowed/i,
  );

  await expectFailure(
    "nested event metadata value",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "metadata-shape",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId, result_code: { nested: true } }),
          ],
        );
      }),
    /metadata values must be primitive/i,
  );

  await expectFailure(
    "oversized event metadata string",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "metadata-length",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId, result_code: "x".repeat(129) }),
          ],
        );
      }),
    /metadata string.*too long/i,
  );

  await expectFailure(
    "URL event metadata value",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "metadata-url",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId, result_code: "https://example.invalid" }),
          ],
        );
      }),
    /metadata URL.*not allowed/i,
  );

  const invalidTypedMetadata = [
    {
      label: "short narrative result_code",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, result_code: "Jane improved" },
      matcher: /invalid metadata result_code/i,
    },
    {
      label: "short PHI-like evidence_hash",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, evidence_hash: "Jane" },
      matcher: /invalid metadata evidence_hash/i,
    },
    {
      label: "uppercase evidence_hash",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, evidence_hash: "A".repeat(64) },
      matcher: /invalid metadata evidence_hash/i,
    },
    {
      label: "narrative attempt_id",
      metadata: { worker_id: "worker-alpha", attempt_id: "client Jane" },
      matcher: /invalid metadata attempt_id/i,
    },
    {
      label: "string duration_ms",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, duration_ms: "1200" },
      matcher: /invalid metadata duration_ms/i,
    },
    {
      label: "negative duration_ms",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, duration_ms: -1 },
      matcher: /invalid metadata duration_ms/i,
    },
    {
      label: "fractional duration_ms",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, duration_ms: 1.5 },
      matcher: /invalid metadata duration_ms/i,
    },
    {
      label: "out-of-range duration_ms",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, duration_ms: 86_400_001 },
      matcher: /invalid metadata duration_ms/i,
    },
    {
      label: "string retry_count",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, retry_count: "1" },
      matcher: /invalid metadata retry_count/i,
    },
    {
      label: "negative retry_count",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, retry_count: -1 },
      matcher: /invalid metadata retry_count/i,
    },
    {
      label: "fractional retry_count",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, retry_count: 1.5 },
      matcher: /invalid metadata retry_count/i,
    },
    {
      label: "out-of-range retry_count",
      metadata: { worker_id: "worker-alpha", attempt_id: firstAttemptId, retry_count: 101 },
      matcher: /invalid metadata retry_count/i,
    },
  ];

  for (const { label, metadata, matcher } of invalidTypedMetadata) {
    await expectFailure(
      label,
      () =>
        withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
          await client.query(
            "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
            [firstClaim.id, firstClaim.state_version, "completed", "metadata-type", HASH_A, JSON.stringify(metadata)],
          );
        }),
      matcher,
    );
  }

  await expectFailure(
    "free-text transition reason",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "contains patient narrative",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId, result_code: "complete" }),
          ],
        );
      }),
    /invalid reason code/i,
  );

  await expectFailure(
    "cross-worker transition",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "cross-worker",
            HASH_A,
            JSON.stringify({ worker_id: "worker-beta", attempt_id: firstAttemptId }),
          ],
        );
      }),
    /worker.*mismatch/i,
  );

  await expectFailure(
    "stale running attempt transition",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
          [
            firstClaim.id,
            firstClaim.state_version,
            "completed",
            "stale-attempt",
            HASH_A,
            JSON.stringify({ worker_id: "worker-alpha", attempt_id: randomUUID() }),
          ],
        );
      }),
    /attempt.*mismatch/i,
  );

  await expectFailure(
    "expired lease transition",
    () =>
      withOwnerSetupAndActor(
        client,
        async () => {
          await client.query(
            `
              update public.agent_work_steps
              set lease_expires_at = timezone('utc', now()) - interval '1 second'
              where id = $1::uuid
            `,
            [firstClaim.id],
          );
        },
        "service_role",
        "service_role",
        FIXTURES.adminA,
        async () => {
          await client.query(
            "select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)",
            [
              firstClaim.id,
              firstClaim.state_version,
              "completed",
              "expired-lease",
              HASH_A,
              JSON.stringify({ worker_id: "worker-alpha", attempt_id: firstAttemptId }),
            ],
          );
        },
      ),
    /lease.*expired/i,
  );

  const noSecondClaim = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
      [assignedWorkItemId, "worker-beta", 120],
    );
    return rows.length;
  });
  assert(noSecondClaim === 0, `Dependent step claim should be blocked until predecessor completion, found ${noSecondClaim}`);

  await expectFailure(
    "stale transition compare-and-swap",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          `
            select public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)
          `,
          [firstClaim.id, 0, "completed", "stale-state", HASH_A, "{}"],
        );
    }),
    /stale state version/i,
  );

  const completedStep = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows: refreshedStepRows } = await client.query(
      `
        select state_version
        from public.agent_work_steps
        where id = $1::uuid
      `,
      [firstClaim.id],
    );
    const refreshedStateVersion = refreshedStepRows[0]?.state_version;
    assert(
      refreshedStateVersion !== undefined && refreshedStateVersion !== null,
      "Expected claimed step state_version to remain readable",
    );

    const { rows } = await client.query(
      `
        select *
        from public.transition_agent_work_step($1::uuid, $2::bigint, $3::public.agent_work_step_status, $4::text, $5::text, $6::jsonb)
      `,
      [
        firstClaim.id,
        refreshedStateVersion,
        "completed",
        "done",
        HASH_A,
        JSON.stringify({
          worker_id: "worker-alpha",
          attempt_id: firstAttemptId,
          result_code: "complete",
          evidence_hash: HASH_A,
          duration_ms: 1200,
          retry_count: 0,
        }),
      ],
    );
    return rows[0];
  }, { commit: true });

  assert(completedStep.status === "completed", `Transition should complete the claimed step, found ${completedStep.status}`);

  const secondClaim = await withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
      [assignedWorkItemId, "worker-gamma", 120],
    );
    return rows[0];
  }, { commit: true });

  assert(secondClaim, "Expected successor step claim after predecessor completion");
  assert(secondClaim.step_key === "observe_upload", `Expected observe_upload second, found ${secondClaim.step_key}`);
  assert(secondClaim.status === "running", `Second claim should return running status, found ${secondClaim.status}`);

  await expectFailure(
    "out-of-range lease claim",
    () =>
      withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
        await client.query(
          "select * from public.claim_agent_work_step($1::uuid, $2::text, $3::integer)",
          [assignedWorkItemId, "worker-delta", 901],
        );
      }),
    /lease seconds out of range/i,
  );
};

const assertApprovalHandoffAndDecisionContract = async (client, connectionString) => {
  const createFixture = async (
    suffix,
    { requiredRole = "admin", clientId = FIXTURES.clientAssigned } = {},
  ) => {
    const workItemId = randomUUID();
    const stepId = randomUUID();
    await client.query(
      `
        insert into public.agent_work_items (
          id, organization_id, client_id, workflow_key, workflow_version,
          objective, status, risk, owner_user_id, completion_criteria, dedupe_key
        ) values (
          $1::uuid, $2::uuid, $3::uuid, 'contract.approval.handoff', 1,
          'Synthetic advisory handoff fixture.', 'waiting', 'clinical', $4::uuid,
          '{"terminal_state":"needs_review"}'::jsonb, $5::text
        )
      `,
      [workItemId, FIXTURES.orgA, clientId, FIXTURES.adminA, `approval-handoff-${suffix}-${RUN_TOKEN}`],
    );
    await client.query(
      `
        insert into public.agent_work_steps (
          id, work_item_id, organization_id, client_id, step_key, ordinal,
          execution_mode, status, risk, required_role
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, 10, 'human', 'ready', 'clinical', $6::text)
      `,
      [stepId, workItemId, FIXTURES.orgA, clientId, `clinical_review_${suffix}`, requiredRole],
    );
    await client.query(
      "update public.agent_work_items set current_step_id = $2::uuid where id = $1::uuid",
      [workItemId, stepId],
    );
    await client.query(
      `
        insert into public.agent_work_evidence (
          work_item_id, step_id, organization_id, client_id, source_kind, source_id, sha256
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'work_step', $2::uuid, $5::text)
      `,
      [workItemId, stepId, FIXTURES.orgA, clientId, HASH_A],
    );
    return { workItemId, stepId };
  };

  const requestHandoff = async (fixture, assignedOwnerUserId = FIXTURES.adminA) =>
    withActor(client, "service_role", "service_role", FIXTURES.adminA, async () => {
      const { rows } = await client.query(
        `
          select public.request_agent_work_approval_handoff(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::timestamptz
          ) as result
        `,
        [
          FIXTURES.adminA,
          fixture.workItemId,
          fixture.stepId,
          assignedOwnerUserId,
          "clinical_review_handoff",
          new Date(Date.now() + 300_000).toISOString(),
        ],
      );
      return rows[0]?.result;
    }, { commit: true });

  const decide = async (dbClient, fixture, approvalId, actorId, decision, reasonCode) =>
    withActor(dbClient, "service_role", "service_role", actorId, async () => {
      const { rows } = await dbClient.query(
        "select public.decide_agent_work_approval($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text) as result",
        [actorId, fixture.workItemId, approvalId, decision, reasonCode],
      );
      return rows[0]?.result;
    }, { commit: true });

  const unassignedBtFixture = await createFixture(
    "unassigned-bt",
    { requiredRole: "bt", clientId: FIXTURES.clientUnassigned },
  );
  await expectFailure(
    "approval owner without client access",
    () => requestHandoff(unassignedBtFixture, FIXTURES.btA),
    /client access/i,
  );

  const revokedClientAccessFixture = await createFixture(
    "revoked-client-access",
    { requiredRole: "bt" },
  );
  const revokedClientAccessHandoff = await requestHandoff(revokedClientAccessFixture, FIXTURES.btA);
  const assignedBtCanDecide = await withActor(
    client,
    "authenticated",
    "authenticated",
    FIXTURES.btA,
    async () => {
      const { rows } = await client.query(
        "select public.current_user_can_decide_agent_work_approval($1::uuid) as allowed",
        [revokedClientAccessHandoff.approval_id],
      );
      return rows[0]?.allowed;
    },
  );
  assert(assignedBtCanDecide === true, "Current assigned approver lacked decision authority");
  await client.query(
    "delete from public.client_therapist_links where client_id = $1::uuid and therapist_id = $2::uuid",
    [FIXTURES.clientAssigned, FIXTURES.btA],
  );
  await client.query(
    "update public.clients set therapist_id = null where id = $1::uuid",
    [FIXTURES.clientAssigned],
  );
  try {
    const deniedClientAccess = await decide(
      client,
      revokedClientAccessFixture,
      revokedClientAccessHandoff.approval_id,
      FIXTURES.btA,
      "approve",
      "clinical_review_accepted",
    );
    assert(deniedClientAccess?.outcome === "forbidden", "Owner without current client access decided approval");
    const pendingAccessApproval = await client.query(
      "select status from public.agent_work_approvals where id = $1::uuid",
      [revokedClientAccessHandoff.approval_id],
    );
    assert(pendingAccessApproval.rows[0]?.status === "pending", "Forbidden client-access decision mutated approval");
    const revokedBtCanDecide = await withActor(
      client,
      "authenticated",
      "authenticated",
      FIXTURES.btA,
      async () => {
        const { rows } = await client.query(
          "select public.current_user_can_decide_agent_work_approval($1::uuid) as allowed",
          [revokedClientAccessHandoff.approval_id],
        );
        return rows[0]?.allowed;
      },
    );
    assert(revokedBtCanDecide === false, "Approver retained decision authority after client access loss");
    const sweptAccess = await client.query(
      "select public.revoke_stale_agent_work_approvals(now(), 500) as result",
    );
    assert(
      sweptAccess.rows[0]?.result?.revoked?.some((row) => row.reasonCode === "owner_authority_lost"),
      "Sweeper did not revoke lost client access",
    );
  } finally {
    await client.query(
      "update public.clients set therapist_id = $2::uuid where id = $1::uuid",
      [FIXTURES.clientAssigned, FIXTURES.btA],
    );
    await client.query(
      `insert into public.client_therapist_links (client_id, therapist_id, organization_id, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
       on conflict (client_id, therapist_id) do nothing`,
      [FIXTURES.clientAssigned, FIXTURES.btA, FIXTURES.orgA, FIXTURES.adminA],
    );
  }

  const approvedFixture = await createFixture("approved");
  const handoff = await requestHandoff(approvedFixture);
  assert(handoff?.outcome === "created", `Expected created handoff, found ${handoff?.outcome}`);
  const duplicateHandoff = await requestHandoff(approvedFixture);
  assert(duplicateHandoff?.outcome === "duplicate", "Identical handoff request was not idempotent");
  const approvalId = handoff.approval_id;

  const ownerRow = await client.query(
    "select owner_user_id from public.agent_work_items where id = $1::uuid",
    [approvedFixture.workItemId],
  );
  assert(ownerRow.rows[0]?.owner_user_id === FIXTURES.adminA, "Handoff did not persist the assigned ledger owner");

  const adminCanDecide = await withActor(client, "authenticated", "authenticated", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select public.current_user_can_decide_agent_work_approval($1::uuid) as allowed",
      [approvalId],
    );
    return rows[0]?.allowed;
  });
  const crossOrgCanDecide = await withActor(client, "authenticated", "authenticated", FIXTURES.adminB, async () => {
    const { rows } = await client.query(
      "select public.current_user_can_decide_agent_work_approval($1::uuid) as allowed",
      [approvalId],
    );
    return rows[0]?.allowed;
  });
  assert(adminCanDecide === true, "Assigned same-org role could not decide pending approval");
  assert(crossOrgCanDecide === false, "Cross-org role received approval decision authority");

  const crossOrgDecision = await decide(
    client,
    approvedFixture,
    approvalId,
    FIXTURES.adminB,
    "approve",
    "clinical_review_accepted",
  );
  assert(crossOrgDecision?.outcome === "forbidden", "Cross-org approval decision did not fail closed");

  const approved = await decide(
    client,
    approvedFixture,
    approvalId,
    FIXTURES.adminA,
    "approve",
    "clinical_review_accepted",
  );
  assert(approved?.outcome === "decided", "Authorized approval decision did not win");
  const duplicate = await decide(
    client,
    approvedFixture,
    approvalId,
    FIXTURES.adminA,
    "approve",
    "clinical_review_accepted",
  );
  assert(duplicate?.outcome === "duplicate", "Identical approval decision did not return stored result");
  const conflict = await decide(
    client,
    approvedFixture,
    approvalId,
    FIXTURES.adminA,
    "approve",
    "different_reason",
  );
  assert(conflict?.outcome === "conflict", "Conflicting approval replay did not return conflict");

  await client.query(
    "update public.agent_work_approvals set expires_at = now() - interval '1 second' where id = $1::uuid",
    [approvalId],
  );
  await client.query("select public.expire_agent_work_approvals(now(), 500)");
  const consumedApproval = await client.query(
    "select status from public.agent_work_approvals where id = $1::uuid",
    [approvalId],
  );
  assert(consumedApproval.rows[0]?.status === "approved", "Consumed approval was rewritten after completion");
  const approvedState = await client.query(
    "select status from public.agent_work_steps where id = $1::uuid",
    [approvedFixture.stepId],
  );
  assert(approvedState.rows[0]?.status === "completed", "Approved handoff did not complete only the ledger step");

  const rejectedFixture = await createFixture("rejected");
  const rejectedHandoff = await requestHandoff(rejectedFixture);
  const rejected = await decide(
    client,
    rejectedFixture,
    rejectedHandoff.approval_id,
    FIXTURES.adminA,
    "reject",
    "clinical_review_rejected",
  );
  assert(rejected?.outcome === "decided", "Authorized rejection did not persist");
  const rejectedState = await client.query(
    "select status from public.agent_work_steps where id = $1::uuid",
    [rejectedFixture.stepId],
  );
  assert(rejectedState.rows[0]?.status === "failed", "Rejected handoff advanced or left the ledger step actionable");

  const expiredFixture = await createFixture("expired");
  const expiredHandoff = await requestHandoff(expiredFixture);
  await client.query(
    "update public.agent_work_approvals set expires_at = now() - interval '1 second' where id = $1::uuid",
    [expiredHandoff.approval_id],
  );
  const expired = await decide(
    client,
    expiredFixture,
    expiredHandoff.approval_id,
    FIXTURES.adminA,
    "approve",
    "clinical_review_accepted",
  );
  assert(expired?.outcome === "expired", "Late approval decision did not persist expiry");

  for (const [suffix, mutate, expectedReason] of [
    ["input-drift", async (fixture) => client.query(
      "update public.agent_work_steps set completion_criteria = '{\"changed\":true}'::jsonb where id = $1::uuid",
      [fixture.stepId],
    ), "input_hash_changed"],
    ["evidence-drift", async (fixture) => client.query(
      `insert into public.agent_work_evidence (work_item_id, step_id, organization_id, client_id, source_kind, source_id, sha256)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'work_step', gen_random_uuid(), $5::text)`,
      [fixture.workItemId, fixture.stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_B],
    ), "evidence_hash_changed"],
    ["workflow-drift", async (fixture) => client.query(
      "update public.agent_work_items set workflow_version = workflow_version + 1 where id = $1::uuid",
      [fixture.workItemId],
    ), "workflow_version_changed"],
    ["non-current-step", async (fixture) => client.query(
      `with successor as (
         insert into public.agent_work_steps (
           work_item_id, organization_id, client_id, step_key, ordinal,
           execution_mode, status, risk, required_role
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, 20, 'human', 'ready', 'clinical', 'admin')
         returning id
       )
       update public.agent_work_items
       set current_step_id = (select id from successor)
       where id = $1::uuid`,
      [fixture.workItemId, FIXTURES.orgA, FIXTURES.clientAssigned, `successor_${RUN_TOKEN}`],
    ), "step_not_current"],
    ["cancelled", async (fixture) => client.query(
      "update public.agent_work_items set status = 'cancelled', cancelled_at = now() where id = $1::uuid",
      [fixture.workItemId],
    ), "work_cancelled"],
  ]) {
    const fixture = await createFixture(suffix);
    const requested = await requestHandoff(fixture);
    await mutate(fixture);
    const result = await decide(
      client,
      fixture,
      requested.approval_id,
      FIXTURES.adminA,
      "approve",
      "clinical_review_accepted",
    );
    assert(result?.outcome === "revoked", `${suffix} did not revoke the approval binding`);
    const reason = await client.query(
      "select revoked_reason_code from public.agent_work_approvals where id = $1::uuid",
      [requested.approval_id],
    );
    assert(reason.rows[0]?.revoked_reason_code === expectedReason, `${suffix} recorded the wrong revocation reason`);
  }

  const rehandoffFixture = await createFixture("rehandoff");
  const firstHandoff = await requestHandoff(rehandoffFixture);
  await client.query(
    "update public.agent_work_steps set completion_criteria = '{\"changed\":true}'::jsonb where id = $1::uuid",
    [rehandoffFixture.stepId],
  );
  const staleDecision = await decide(
    client,
    rehandoffFixture,
    firstHandoff.approval_id,
    FIXTURES.adminA,
    "approve",
    "clinical_review_accepted",
  );
  assert(staleDecision?.outcome === "revoked", "Re-handoff fixture did not revoke stale approval");
  const secondHandoff = await requestHandoff(rehandoffFixture);
  assert(secondHandoff?.outcome === "created", "Re-handoff after revocation did not create a new approval");
  assert(secondHandoff?.approval_id !== firstHandoff.approval_id, "Re-handoff reused revoked approval history");

  const sweptFixture = await createFixture("swept-evidence-drift");
  const sweptHandoff = await requestHandoff(sweptFixture);
  await client.query(
    `insert into public.agent_work_evidence (work_item_id, step_id, organization_id, client_id, source_kind, source_id, sha256)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'work_step', gen_random_uuid(), $5::text)`,
    [sweptFixture.workItemId, sweptFixture.stepId, FIXTURES.orgA, FIXTURES.clientAssigned, HASH_B],
  );
  const swept = await client.query(
    "select public.revoke_stale_agent_work_approvals(now(), 500) as result",
  );
  assert(
    swept.rows[0]?.result?.revoked?.some((row) => row.reasonCode === "evidence_hash_changed"),
    "Stale-approval sweeper did not report evidence drift",
  );
  const sweptApproval = await client.query(
    "select status, revoked_reason_code, revoked_by from public.agent_work_approvals where id = $1::uuid",
    [sweptHandoff.approval_id],
  );
  assert(sweptApproval.rows[0]?.status === "revoked", "Stale-approval sweeper did not persist revocation");
  assert(
    sweptApproval.rows[0]?.revoked_reason_code === "evidence_hash_changed",
    "Stale-approval sweeper persisted the wrong revocation reason",
  );
  assert(sweptApproval.rows[0]?.revoked_by === null, "System-swept approval unexpectedly recorded a user actor");

  const revokedRoleFixture = await createFixture("revoked-role");
  const revokedRoleHandoff = await requestHandoff(revokedRoleFixture);
  await client.query(
    `update public.user_roles set is_active = false
     where user_id = $1::uuid and role_id = (select id from public.roles where name = 'admin')`,
    [FIXTURES.adminA],
  );
  const revokedRole = await decide(
    client,
    revokedRoleFixture,
    revokedRoleHandoff.approval_id,
    FIXTURES.adminA,
    "approve",
    "clinical_review_accepted",
  );
  assert(revokedRole?.outcome === "forbidden", "Role-revoked owner was allowed to mutate approval state");
  const pendingAfterForbidden = await client.query(
    "select status from public.agent_work_approvals where id = $1::uuid",
    [revokedRoleHandoff.approval_id],
  );
  assert(pendingAfterForbidden.rows[0]?.status === "pending", "Forbidden approval decision mutated stale state");
  const sweptRole = await client.query(
    "select public.revoke_stale_agent_work_approvals(now(), 500) as result",
  );
  assert(
    sweptRole.rows[0]?.result?.revoked?.some((row) => row.reasonCode === "owner_authority_lost"),
    "Stale-approval sweeper did not revoke lost owner authority",
  );
  await client.query(
    `update public.user_roles set is_active = true
     where user_id = $1::uuid and role_id = (select id from public.roles where name = 'admin')`,
    [FIXTURES.adminA],
  );

  const concurrentFixture = await createFixture("concurrent");
  const concurrentHandoff = await requestHandoff(concurrentFixture);
  const firstClient = new Client({ connectionString });
  const secondClient = new Client({ connectionString });
  await Promise.all([firstClient.connect(), secondClient.connect()]);
  try {
    const outcomes = await Promise.all([
      decide(firstClient, concurrentFixture, concurrentHandoff.approval_id, FIXTURES.adminA, "approve", "concurrent_a"),
      decide(secondClient, concurrentFixture, concurrentHandoff.approval_id, FIXTURES.adminA, "reject", "concurrent_b"),
    ]);
    assert(
      outcomes.map((result) => result?.outcome).sort().join(",") === "conflict,decided",
      `Concurrent decisions did not converge to one winner: ${JSON.stringify(outcomes)}`,
    );
  } finally {
    await Promise.all([firstClient.end(), secondClient.end()]);
  }

  const handoffRaceFixture = await createFixture("handoff-decision-race");
  const handoffRaceApproval = await requestHandoff(handoffRaceFixture);
  const handoffClient = new Client({ connectionString });
  const decisionClient = new Client({ connectionString });
  await Promise.all([handoffClient.connect(), decisionClient.connect()]);
  try {
    await Promise.all([
      handoffClient.query("set statement_timeout = '5s'"),
      decisionClient.query("set statement_timeout = '5s'"),
    ]);
    const raceResults = await Promise.allSettled([
      withActor(handoffClient, "service_role", "service_role", FIXTURES.adminA, async () => {
        const { rows } = await handoffClient.query(
          `select public.request_agent_work_approval_handoff(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::timestamptz
           ) as result`,
          [
            FIXTURES.adminA,
            handoffRaceFixture.workItemId,
            handoffRaceFixture.stepId,
            FIXTURES.adminA,
            "clinical_review_reassigned",
            new Date(Date.now() + 300_000).toISOString(),
          ],
        );
        return rows[0]?.result;
      }, { commit: true }),
      decide(
        decisionClient,
        handoffRaceFixture,
        handoffRaceApproval.approval_id,
        FIXTURES.adminA,
        "approve",
        "clinical_review_accepted",
      ),
    ]);
    const raceFailureText = raceResults
      .filter((result) => result.status === "rejected")
      .map((result) => String(result.reason?.message ?? result.reason))
      .join(" ");
    assert(!/deadlock detected|40P01|statement timeout|57014/i.test(raceFailureText), "Handoff/decision race deadlocked");
    assert(raceResults.some((result) => result.status === "fulfilled"), "Handoff/decision race produced no winner");
  } finally {
    await Promise.all([handoffClient.end(), decisionClient.end()]);
  }

  const auditRows = await client.query(
    `select event_type, sanitized_metadata
     from public.agent_work_events
     where event_type in ('approval.requested', 'approval.decided', 'approval.expired', 'approval.revoked', 'approval.conflict')`,
  );
  const eventTypes = new Set(auditRows.rows.map((row) => row.event_type));
  for (const eventType of ["approval.requested", "approval.decided", "approval.expired", "approval.revoked", "approval.conflict"]) {
    assert(eventTypes.has(eventType), `Missing sanitized ${eventType} audit event`);
  }
  const auditText = JSON.stringify(auditRows.rows);
  assert(!auditText.includes(HASH_A) && !auditText.includes(HASH_B), "Approval audit disclosed a full hash");
  assert(!auditText.includes("example.invalid"), "Approval audit disclosed an email-like fixture value");

  await expectFailure(
    "authenticated approval governance event read",
    () => withActor(client, "authenticated", "authenticated", FIXTURES.btA, async () => {
      await client.query("select count(*) from public.agent_work_events where event_type like 'approval.%'");
    }),
    /permission denied/i,
  );
};

const main = async () => {
  const connectionString = getRequiredEnv("SUPABASE_DB_URL");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await assertTablesAndRls(client);
    await assertTableGrants(client);
    await assertFunctionContracts(client);
    await assertTraceColumns(client);
    await seedFixtures(client);
    await assertQueueAndSweeperContract(client);

    await assertManagePredicateParity(client);

    await assertCreateContainmentAndConcurrency(connectionString);
    await assertCalOptimaDraftReviewLifecycle(client);

    const { assignedWorkItemId, unassignedWorkItemId } = await createWorkItems(client);

    await assertApprovalHandoffAndDecisionContract(client, connectionString);

    await assertRecomputedTerminalStatuses(client);

    await assertDirectMutationDenials(client, assignedWorkItemId);
    await assertOrganizationAndClientIsolation(client, assignedWorkItemId, unassignedWorkItemId);
    await assertDependencyTenantScope(client, assignedWorkItemId, unassignedWorkItemId);
    await assertDependencyEndpointReadPolicy(client, assignedWorkItemId, unassignedWorkItemId);
    await assertParentEndpointReadPolicy(client, assignedWorkItemId, unassignedWorkItemId);
    await assertApprovalRoleEnforcement(client, assignedWorkItemId);
    await assertClaimEligibility(client);
    await assertModelAttemptSnapshot(client);
    await assertHumanTransitionDenials(client);
    await assertAttemptSettlement(client);
    await assertApprovalTransitionGate(client);
    await assertClaimAndTransitionContract(client, assignedWorkItemId);

    console.log("Agent work ledger security contract passed.");
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("Agent work ledger security contract failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
