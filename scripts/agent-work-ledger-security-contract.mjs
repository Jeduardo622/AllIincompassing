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
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "app.current_user_can_read_agent_work_item_endpoint(uuid)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
  },
  {
    signature: "create_agent_assessment_work_item(uuid,uuid,uuid,integer,text)",
    searchPath: "public, pg_temp",
    execute: { public: false, anon: false, authenticated: true, service_role: true },
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
      ('${FIXTURES.docUnassigned}', '${FIXTURES.orgA}', '${FIXTURES.clientUnassigned}', '${FIXTURES.adminA}', 'iehp_fba', 'unassigned-${RUN_TOKEN}.pdf', 'application/pdf', 128, 'client-documents', 'synthetic/${RUN_TOKEN}/unassigned.pdf')
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

const createWorkItems = async (client) => {
  const assignedWorkItemId = await withActor(client, "authenticated", "authenticated", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      `
        select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text) as id
      `,
      [FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 1, `ledger-contract-assigned-${RUN_TOKEN}`],
    );
    return rows[0]?.id;
  }, { commit: true });

  const unassignedWorkItemId = await withActor(client, "authenticated", "authenticated", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      `
        select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text) as id
      `,
      [FIXTURES.orgA, FIXTURES.clientUnassigned, FIXTURES.docUnassigned, 1, `ledger-contract-unassigned-${RUN_TOKEN}`],
    );
    return rows[0]?.id;
  }, { commit: true });

  assert(assignedWorkItemId, "Assigned work item creation did not return an id");
  assert(unassignedWorkItemId, "Unassigned work item creation did not return an id");

  return { assignedWorkItemId, unassignedWorkItemId };
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
      withActor(client, "authenticated", "authenticated", FIXTURES.adminB, async () => {
        await client.query(
          `
            select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text)
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 2, "cross-org-denied"],
        );
      }),
    /forbidden|scope mismatch/i,
  );

  await expectFailure(
    "bt work-item creation",
    () =>
      withActor(client, "authenticated", "authenticated", FIXTURES.btA, async () => {
        await client.query(
          `
            select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text)
          `,
          [FIXTURES.orgA, FIXTURES.clientAssigned, FIXTURES.docAssigned, 2, "bt-denied"],
        );
      }),
    /forbidden/i,
  );

  const btReadableCount = await withActor(client, "authenticated", "authenticated", FIXTURES.btA, async () => {
    const { rows } = await client.query(
      `
        select count(*)::integer as count
        from public.agent_work_items
        where id in ($1::uuid, $2::uuid)
      `,
      [assignedWorkItemId, unassignedWorkItemId],
    );
    return rows[0]?.count ?? 0;
  });
  assert(btReadableCount === 1, `BT should only read the assigned client's work item, found ${btReadableCount}`);

  const foreignReadableCount = await withActor(client, "authenticated", "authenticated", FIXTURES.adminB, async () => {
    const { rows } = await client.query(
      `
        select count(*)::integer as count
        from public.agent_work_items
        where id in ($1::uuid, $2::uuid)
      `,
      [assignedWorkItemId, unassignedWorkItemId],
    );
    return rows[0]?.count ?? 0;
  });
  assert(foreignReadableCount === 0, `Cross-org admin should not read foreign-org work items, found ${foreignReadableCount}`);
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

    const { rows: visibleRows } = await client.query(
      "select count(*)::integer as count from public.agent_work_item_dependencies where id = $1::uuid",
      [dependencyId],
    );
    await client.query("rollback");

    assert(
      visibleRows[0]?.count === 0,
      `Dependency read policy must authorize both endpoints, found ${visibleRows[0]?.count ?? 0} visible edge(s)`,
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const assertParentEndpointReadPolicy = async (client, assignedWorkItemId, unassignedWorkItemId) => {
  await client.query("begin");

  try {
    await client.query("alter table public.agent_work_items disable trigger agent_work_items_enforce_parent_scope");
    await client.query(
      "update public.agent_work_items set parent_work_item_id = $1::uuid where id = $2::uuid",
      [unassignedWorkItemId, assignedWorkItemId],
    );
    await client.query("alter table public.agent_work_items enable trigger agent_work_items_enforce_parent_scope");

    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: FIXTURES.btA }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [FIXTURES.btA]);

    const { rows } = await client.query(
      "select count(*)::integer as count from public.agent_work_items where id = $1::uuid",
      [assignedWorkItemId],
    );
    await client.query("rollback");

    assert(
      rows[0]?.count === 0,
      `Parent read policy must authorize both endpoints, found ${rows[0]?.count ?? 0} visible child row(s)`,
    );
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

  const btVisibleCount = await withActor(client, "authenticated", "authenticated", FIXTURES.btA, async () => {
    const { rows } = await client.query(
      "select count(*)::integer as count from public.agent_work_approvals where id = $1::uuid",
      [FIXTURES.approvalAssigned],
    );
    return rows[0]?.count ?? 0;
  });
  assert(btVisibleCount === 0, `BT should not read BCBA approvals, found ${btVisibleCount}`);

  const adminVisibleCount = await withActor(client, "authenticated", "authenticated", FIXTURES.adminA, async () => {
    const { rows } = await client.query(
      "select count(*)::integer as count from public.agent_work_approvals where id = $1::uuid",
      [FIXTURES.approvalAssigned],
    );
    return rows[0]?.count ?? 0;
  });
  assert(adminVisibleCount === 1, `Admin should read same-org approvals, found ${adminVisibleCount}`);

  const bcbaVisibleCount = await withActor(client, "authenticated", "authenticated", FIXTURES.bcbaA, async () => {
    const { rows } = await client.query(
      "select count(*)::integer as count from public.agent_work_approvals where id = $1::uuid",
      [FIXTURES.approvalAssigned],
    );
    return rows[0]?.count ?? 0;
  });
  assert(bcbaVisibleCount === 1, `BCBA should read required-role approvals, found ${bcbaVisibleCount}`);
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

    const { assignedWorkItemId, unassignedWorkItemId } = await createWorkItems(client);

    await assertDirectMutationDenials(client, assignedWorkItemId);
    await assertOrganizationAndClientIsolation(client, assignedWorkItemId, unassignedWorkItemId);
    await assertDependencyTenantScope(client, assignedWorkItemId, unassignedWorkItemId);
    await assertDependencyEndpointReadPolicy(client, assignedWorkItemId, unassignedWorkItemId);
    await assertParentEndpointReadPolicy(client, assignedWorkItemId, unassignedWorkItemId);
    await assertApprovalRoleEnforcement(client, assignedWorkItemId);
    await assertClaimEligibility(client);
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
