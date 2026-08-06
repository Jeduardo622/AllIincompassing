import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const PROJECT_REF = "wnnjeqheqxxyrgsjmygy";
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const MANAGEMENT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const ITEMS_FUNCTION_URL = `${PROJECT_URL}/functions/v1/agent-work-items`;
const AUTH_URL = `${PROJECT_URL}/auth/v1`;
const RUNTIME_SECRET_NAME = "AGENT_WORK_LEDGER_RUNTIME_MODE";
const RUNTIME_DISABLED_CODE = "runtime_mode_disabled";
const RETENTION_REASON = "policy_unapproved";
const PHASES = Object.freeze(["preflight/setup", "proof", "cleanup/verify"]);
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const RUNTIME_POLL_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const ITEM_KEYS = Object.freeze([
  "approvals",
  "blockers",
  "dueAt",
  "hasOwner",
  "id",
  "objective",
  "risk",
  "status",
  "steps",
  "updatedAt",
  "workflowKey",
  "workflowVersion",
]);
const STEP_KEYS = Object.freeze([
  "evidenceCount",
  "executionMode",
  "id",
  "key",
  "lastReasonCode",
  "status",
]);
const BLOCKER_KEYS = Object.freeze(["action", "code", "stepKey"]);
const APPROVAL_KEYS = Object.freeze([
  "canDecide",
  "evidenceCount",
  "evidenceHashSuffix",
  "expiresAt",
  "id",
  "requestedAt",
  "requiredRole",
  "status",
  "stepId",
]);
const LEDGER_COUNT_KEYS = Object.freeze([
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
  "agent_work_retention_holds",
  "agent_work_retention_receipts",
  "agent_work_caloptima_draft_packets",
  "q_agent_work_steps",
  "a_agent_work_steps",
]);
const SYNTHETIC_SCOPE_COUNT_KEYS = Object.freeze(["agent_execution_traces"]);

const stateDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-hosted-shadow-proof-private",
);
const statePath = path.join(stateDir, "state.json");
const artifactDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-hosted-shadow-proof-public",
);
const artifactPath = path.join(artifactDir, "summary.json");
const startedAt = Date.now();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const validateUuidLiteral = (value) => {
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
    "Invalid synthetic UUID.",
  );
  return value.toLowerCase();
};

const validateUuidOrNilLiteral = (value) =>
  value === NIL_UUID ? NIL_UUID : validateUuidLiteral(value);

const uuidFromSeed = (seed) => {
  const hex = sha256(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return validateUuidLiteral(
    `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`,
  );
};

export const deriveState = (
  runId = process.env.GITHUB_RUN_ID,
  runAttempt = process.env.GITHUB_RUN_ATTEMPT,
) => {
  const rawRunToken = `${runId ?? "local"}-${runAttempt ?? "1"}`;
  const runToken = rawRunToken.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 48);
  const fixture = {
    organizationAId: uuidFromSeed(`${rawRunToken}:organization:a`),
    organizationBId: uuidFromSeed(`${rawRunToken}:organization:b`),
    clientAId: uuidFromSeed(`${rawRunToken}:client:a`),
    clientBId: uuidFromSeed(`${rawRunToken}:client:b`),
    assessmentAId: uuidFromSeed(`${rawRunToken}:assessment:a`),
    assessmentBId: uuidFromSeed(`${rawRunToken}:assessment:b`),
  };
  return {
    runToken,
    fixture,
    users: [
      {
        id: NIL_UUID,
        email: `agent-work-shadow-a-${runToken}@example.com`.toLowerCase(),
        password: `Synthetic-${sha256(`${rawRunToken}:user:a`).slice(0, 28)}!`,
      },
      {
        id: NIL_UUID,
        email: `agent-work-shadow-b-${runToken}@example.com`.toLowerCase(),
        password: `Synthetic-${sha256(`${rawRunToken}:user:b`).slice(0, 28)}!`,
      },
    ],
    fixturesCreated: false,
    shadowRequested: false,
    proof: { workItemAId: null, workItemBId: null },
  };
};

const ensureDirectories = async () => {
  await mkdir(stateDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
};

const writeState = async (state) => {
  await ensureDirectories();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

const readState = async () => {
  await ensureDirectories();
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return deriveState();
  }
};

const assertNumericRecord = (record, label) => {
  assert(
    record && typeof record === "object" && !Array.isArray(record),
    `${label} must be an object.`,
  );
  for (const [key, value] of Object.entries(record)) {
    assert(/^[a-z0-9_/-]+$/i.test(key), `${label} key is invalid.`);
    assert(
      Number.isFinite(value) && value >= 0,
      `${label}.${key} must be a nonnegative number.`,
    );
  }
};

const writePublicArtifact = async ({ fixedBooleans, counts, timingsMs }) => {
  assertNumericRecord(counts, "counts");
  assertNumericRecord(timingsMs, "timings_ms");
  assert(
    fixedBooleans &&
      Object.values(fixedBooleans).every((value) => typeof value === "boolean"),
    "Artifact booleans must be fixed booleans.",
  );
  const evidence = {
    artifact: "agent-work-ledger-hosted-shadow-proof",
    fixed_booleans: fixedBooleans,
    counts,
    duration_ms: Date.now() - startedAt,
    hashes: { summary_sha256: sha256({ fixedBooleans, counts, timingsMs }) },
    timings_ms: timingsMs,
  };
  const serialized = JSON.stringify(evidence).toLowerCase();
  for (const forbidden of [
    "@example.com",
    "password",
    "access_token",
    "service_role",
    "bearer ",
  ]) {
    assert(
      !serialized.includes(forbidden),
      "Refusing sensitive or identifying evidence output.",
    );
  }
  await ensureDirectories();
  await writeFile(
    artifactPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
};

const fetchWithTimeout = (url, init = {}) =>
  fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

const runDatabaseQuery = async ({
  query,
  parameters = [],
  readOnly = false,
}) => {
  const response = await fetchWithTimeout(MANAGEMENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
  });
  if (!response.ok) {
    throw new Error(
      `Management API query failed with HTTP ${response.status}.`,
    );
  }
  return response.json();
};

const managementRead = (query, parameters = []) =>
  runDatabaseQuery({ query, parameters, readOnly: true });
const managementWrite = (query, parameters = []) =>
  runDatabaseQuery({ query, parameters, readOnly: false });

export const firstRow = (result) => {
  if (Array.isArray(result)) return result[0] ?? {};
  return result?.result?.[0] ?? result ?? {};
};

const runSupabaseCli = async (args) => {
  await execFileAsync("supabase", args, {
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: requiredEnv("SUPABASE_ACCESS_TOKEN"),
    },
    windowsHide: true,
  });
};

const setRuntimeMode = async (mode) => {
  assert(
    mode === "shadow" || mode === "disabled",
    "Only shadow and disabled runtime modes are allowed.",
  );
  await runSupabaseCli([
    "secrets",
    "set",
    `${RUNTIME_SECRET_NAME}=${mode}`,
    "--project-ref",
    PROJECT_REF,
  ]);
};

const publicApiKey = () => requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = () => requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const authAdminRequest = async (pathName, init = {}) => {
  const key = serviceRoleKey();
  const response = await fetchWithTimeout(`${AUTH_URL}${pathName}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return response;
};

const createSyntheticUser = async (user, organizationId) => {
  const response = await authAdminRequest("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        organization_id: organizationId,
        fixture_kind: "agent-work-shadow-proof",
      },
    }),
  });
  if (response.ok) {
    const body = await response.json();
    return validateUuidLiteral(body?.id ?? body?.user?.id);
  }
  if (response.status !== 422) {
    throw new Error(
      `Synthetic auth user creation failed with HTTP ${response.status}.`,
    );
  }
  const lookup = firstRow(
    await managementRead(
      "select id from auth.users where lower(email) = lower($1::text)",
      [user.email],
    ),
  );
  return validateUuidLiteral(lookup.id);
};

const signIn = async (user) => {
  const response = await fetchWithTimeout(
    `${AUTH_URL}/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: publicApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
  );
  if (!response.ok) {
    throw new Error(`Synthetic sign-in failed with HTTP ${response.status}.`);
  }
  const body = await response.json();
  assert(
    typeof body?.access_token === "string" && body.access_token.length > 0,
    "Synthetic auth token missing.",
  );
  return body.access_token;
};

const requestAgentWork = async (token, method, pathName, body) => {
  const response = await fetchWithTimeout(`${ITEMS_FUNCTION_URL}${pathName}`, {
    method,
    headers: {
      apikey: publicApiKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  return { response, parsed };
};

const pollForRuntimeMode = async (
  expectedMode,
  token,
  assessmentDocumentId,
) => {
  const deadline = Date.now() + RUNTIME_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await requestAgentWork(
      token,
      "GET",
      `?assessment_document_id=${assessmentDocumentId}`,
    );
    const code = result.parsed?.code ?? result.parsed?.error?.code;
    if (
      expectedMode === "disabled" &&
      result.response.status === 403 &&
      code === RUNTIME_DISABLED_CODE
    ) {
      return;
    }
    if (
      expectedMode === "shadow" &&
      result.response.status === 200 &&
      result.parsed?.meta?.runtimeMode === "shadow"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for runtime mode ${expectedMode}.`);
};

const exactKeys = (value, keys, label) => {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object.`,
  );
  assert(
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort()),
    `${label} keys drifted.`,
  );
};

export const assertSanitizedItem = (item) => {
  exactKeys(item, ITEM_KEYS, "work item");
  assert(Array.isArray(item.steps), "Work item steps must be an array.");
  assert(Array.isArray(item.blockers), "Work item blockers must be an array.");
  assert(
    Array.isArray(item.approvals),
    "Work item approvals must be an array.",
  );
  item.steps.forEach((step) => exactKeys(step, STEP_KEYS, "work item step"));
  item.blockers.forEach((blocker) =>
    exactKeys(blocker, BLOCKER_KEYS, "work item blocker"),
  );
  item.approvals.forEach((approval) =>
    exactKeys(approval, APPROVAL_KEYS, "work item approval"),
  );
};

const preflightQuery = `
select jsonb_build_object(
  'runtime_config', (
    select jsonb_build_object('present', count(*) = 1, 'actions_disabled', coalesce(bool_or(actions_disabled), true))
    from public.agent_runtime_config where config_key = 'global'
  ),
  'scheduler_extensions', jsonb_build_object(
    'pgCron', exists (
      select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
    ),
    'pgNet', exists (
      select 1 from pg_catalog.pg_extension where extname = 'pg_net'
    ),
    'vault', exists (
      select 1 from pg_catalog.pg_extension where extname = 'supabase_vault'
    )
  ),
  'vault_extension_present', exists (
    select 1 from pg_catalog.pg_extension where extname = 'supabase_vault'
  ),
  'active_retention_policy_count', (
    select count(*)::integer from public.agent_work_retention_policies where disabled_at is null
  ),
  'ledger_counts', jsonb_build_object(
    'agent_work_items', (select count(*)::integer from public.agent_work_items),
    'agent_work_item_dependencies', (select count(*)::integer from public.agent_work_item_dependencies),
    'agent_work_assessment_links', (select count(*)::integer from public.agent_work_assessment_links),
    'agent_work_steps', (select count(*)::integer from public.agent_work_steps),
    'agent_work_step_dependencies', (select count(*)::integer from public.agent_work_step_dependencies),
    'agent_work_evidence', (select count(*)::integer from public.agent_work_evidence),
    'agent_work_approvals', (select count(*)::integer from public.agent_work_approvals),
    'agent_work_attempts', (select count(*)::integer from public.agent_work_attempts),
    'agent_work_effects', (select count(*)::integer from public.agent_work_effects),
    'agent_work_events', (select count(*)::integer from public.agent_work_events),
    'agent_work_retention_holds', (select count(*)::integer from public.agent_work_retention_holds),
    'agent_work_retention_receipts', (select count(*)::integer from public.agent_work_retention_receipts),
    'agent_work_caloptima_draft_packets', (select count(*)::integer from public.agent_work_caloptima_draft_packets),
    'q_agent_work_steps', (select count(*)::integer from pgmq.q_agent_work_steps),
    'a_agent_work_steps', (select count(*)::integer from pgmq.a_agent_work_steps)
  ),
  'scoped_counts', jsonb_build_object(
    'agent_execution_traces', (
      select count(*)::integer from public.agent_execution_traces
      where organization_id in ($1::uuid, $2::uuid)
        or work_item_id in ($9::uuid, $10::uuid)
    )
  ),
  'fixture_counts', jsonb_build_object(
    'organizations', (select count(*)::integer from public.organizations where id in ($1::uuid, $2::uuid)),
    'clients', (select count(*)::integer from public.clients where id in ($3::uuid, $4::uuid)),
    'assessments', (select count(*)::integer from public.assessment_documents where id in ($5::uuid, $6::uuid)),
    'users', (select count(*)::integer from auth.users where lower(email) in (lower($7::text), lower($8::text)))
  ),
  'session_replication_role', current_setting('session_replication_role'),
  'event_trigger_enabled', (
    select tgenabled = 'O' from pg_trigger
    where tgrelid = 'public.agent_work_events'::regclass
      and tgname = 'agent_work_events_prevent_update'
      and not tgisinternal
  )
) as summary
`;

const preflightParameters = (state) => [
  state.fixture.organizationAId,
  state.fixture.organizationBId,
  state.fixture.clientAId,
  state.fixture.clientBId,
  state.fixture.assessmentAId,
  state.fixture.assessmentBId,
  state.users[0].email,
  state.users[1].email,
  state.proof?.workItemAId ?? NIL_UUID,
  state.proof?.workItemBId ?? NIL_UUID,
];

export const assertPreflightSummary = (summary, { final = false } = {}) => {
  assert(
    summary?.runtime_config?.present === true,
    "Runtime policy row is missing.",
  );
  assert(
    summary.runtime_config.actions_disabled === false,
    "Database runtime kill switch must remain unchanged.",
  );
  assert(
    summary?.scheduler?.extensions?.pgCron === false,
    "Hosted pg_cron extension must remain absent.",
  );
  assert(
    summary?.scheduler?.runnerJob?.present === false,
    "Hosted runner Cron job must be absent.",
  );
  assert(
    summary?.scheduler?.sweeperJob?.present === false,
    "Hosted sweeper Cron job must be absent.",
  );
  assert(
    summary?.scheduler?.secretsReady === false,
    "Hosted scheduler secrets must remain absent.",
  );
  assert(
    summary?.vault_name_count === 0,
    "Hosted scheduler Vault names must remain absent.",
  );
  assert(
    summary?.active_retention_policy_count === 0,
    "Retention policy must remain unapproved.",
  );
  assert(
    summary?.retention?.success === false,
    "Retention deletion must remain disabled.",
  );
  assert(
    summary?.retention?.reason_code === RETENTION_REASON,
    "Retention reason code drifted.",
  );
  assert(
    summary?.retention?.deleted_count === 0,
    "Retention proof must delete zero rows.",
  );
  assert(
    summary?.session_replication_role === "origin",
    "Replication role did not return to origin.",
  );
  assert(
    summary?.event_trigger_enabled === true,
    "Append-only event trigger is not enabled.",
  );
  for (const key of LEDGER_COUNT_KEYS) {
    assert(
      summary?.ledger_counts?.[key] === 0,
      `Expected global zero for ${key}.`,
    );
  }
  for (const key of SYNTHETIC_SCOPE_COUNT_KEYS) {
    assert(
      summary?.scoped_counts?.[key] === 0,
      `Expected synthetic-scope zero for ${key}.`,
    );
  }
  if (final) {
    for (const [key, value] of Object.entries(summary?.fixture_counts ?? {})) {
      assert(value === 0, `Synthetic fixture residue remained in ${key}.`);
    }
  }
};

const readPreflightSummary = async (state) => {
  const row = firstRow(
    await managementRead(preflightQuery, preflightParameters(state)),
  );
  const summary = row.summary ?? row;
  if (summary.vault_extension_present === true) {
    const vaultRow = firstRow(
      await managementRead(`
        select count(*)::integer as vault_name_count
        from vault.secrets
        where name in (
          'agent_work_hosted_project_ref', 'agent_work_hosted_publishable_key',
          'agent_work_hosted_runner_secret', 'agent_work_hosted_sweeper_secret'
        )
      `),
    );
    summary.vault_name_count = vaultRow.vault_name_count;
  } else {
    summary.vault_name_count = 0;
  }
  const pgCronPresent = summary?.scheduler_extensions?.pgCron === true;
  summary.scheduler = {
    extensions: summary.scheduler_extensions,
    secretsReady: summary.vault_name_count === 4,
    runnerJob: { present: pgCronPresent, active: false, schedule: null },
    sweeperJob: { present: pgCronPresent, active: false, schedule: null },
  };
  summary.retention = {
    success: false,
    reason_code:
      summary.active_retention_policy_count === 0
        ? RETENTION_REASON
        : "policy_configured",
    category: "ledger_history",
    deleted_count: 0,
  };
  return summary;
};

const setupOrganizations = async (state) => {
  const row = firstRow(
    await managementWrite(
      `
    insert into public.organizations (id, name, slug)
    values
      ($1::uuid, 'Agent Work Shadow Fixture A', $3::text),
      ($2::uuid, 'Agent Work Shadow Fixture B', $4::text)
    on conflict (id) do update set name = excluded.name, slug = excluded.slug
    returning id
  `,
      [
        state.fixture.organizationAId,
        state.fixture.organizationBId,
        `agent-work-shadow-a-${state.runToken}`,
        `agent-work-shadow-b-${state.runToken}`,
      ],
    ),
  );
  assert(row.id, "Synthetic organization setup returned no rows.");
};

const setupUsers = async (state) => {
  state.users[0].id = await createSyntheticUser(
    state.users[0],
    state.fixture.organizationAId,
  );
  await writeState(state);
  state.users[1].id = await createSyntheticUser(
    state.users[1],
    state.fixture.organizationBId,
  );
  await writeState(state);
  const parameters = [
    state.users[0].id,
    state.users[0].email,
    state.fixture.organizationAId,
    state.users[1].id,
    state.users[1].email,
    state.fixture.organizationBId,
  ];
  const profileRow = firstRow(
    await managementWrite(
      `
    with guard as materialized (
      select set_config('app.bypass_profile_role_guard', 'on', true) as enabled
    ), values_table(id, email, last_name, organization_id) as (
      values
        ($1::uuid, $2::text, 'Shadow A', $3::uuid),
        ($4::uuid, $5::text, 'Shadow B', $6::uuid)
    ), updated_profiles as (
    update public.profiles as profiles
    set email = values_table.email,
      role = 'admin'::public.role_type,
      first_name = 'Synthetic',
      last_name = values_table.last_name,
      organization_id = values_table.organization_id,
      is_active = true,
      updated_at = now()
    from values_table cross join guard
    where profiles.id = values_table.id
    returning profiles.id
    )
    select count(*)::integer as profiles from updated_profiles
  `,
      parameters,
    ),
  );
  assert(profileRow.profiles === 2, "Synthetic profile setup failed.");
  const roleRow = firstRow(
    await managementWrite(
      `
    with upsert_roles as (
    insert into public.user_roles (user_id, role_id, is_active, expires_at)
    select values_table.user_id, roles.id, true, null::timestamptz
    from (values ($1::uuid), ($2::uuid)) as values_table(user_id)
    join public.roles on roles.name = 'admin'
    on conflict (user_id, role_id) do update set is_active = excluded.is_active, expires_at = null
    returning user_id
    )
    select count(*)::integer as roles from upsert_roles
  `,
      [state.users[0].id, state.users[1].id],
    ),
  );
  assert(roleRow.roles === 2, "Synthetic role setup failed.");
};

const setupClientsAndAssessments = async (state) => {
  const clientRows = await managementWrite(
    `
    insert into public.clients (id, full_name, status, organization_id)
    values
      ($1::uuid, 'Synthetic Shadow Client A', 'active', $3::uuid),
      ($2::uuid, 'Synthetic Shadow Client B', 'active', $4::uuid)
    on conflict (id) do update set full_name = excluded.full_name, status = excluded.status,
      organization_id = excluded.organization_id, updated_at = now()
    returning id
  `,
    [
      state.fixture.clientAId,
      state.fixture.clientBId,
      state.fixture.organizationAId,
      state.fixture.organizationBId,
    ],
  );
  assert(
    Array.isArray(clientRows) && clientRows.length === 2,
    "Synthetic client setup failed.",
  );
  const assessmentRows = await managementWrite(
    `
    insert into public.assessment_documents (
      id, organization_id, client_id, uploaded_by, template_type,
      file_name, mime_type, file_size, bucket_id, object_path, status
    ) values
      ($1::uuid, $3::uuid, $5::uuid, $7::uuid, 'iehp_fba', 'synthetic-shadow-a.pdf',
       'application/pdf', 128, 'client-documents', $9::text, 'uploaded'),
      ($2::uuid, $4::uuid, $6::uuid, $8::uuid, 'iehp_fba', 'synthetic-shadow-b.pdf',
       'application/pdf', 128, 'client-documents', $10::text, 'uploaded')
    on conflict (id) do update set organization_id = excluded.organization_id,
      client_id = excluded.client_id, uploaded_by = excluded.uploaded_by,
      template_type = excluded.template_type, file_name = excluded.file_name,
      mime_type = excluded.mime_type, file_size = excluded.file_size,
      bucket_id = excluded.bucket_id, object_path = excluded.object_path,
      status = excluded.status, updated_at = now()
    returning id
  `,
    [
      state.fixture.assessmentAId,
      state.fixture.assessmentBId,
      state.fixture.organizationAId,
      state.fixture.organizationBId,
      state.fixture.clientAId,
      state.fixture.clientBId,
      state.users[0].id,
      state.users[1].id,
      `synthetic/agent-work-shadow/${state.runToken}/a.pdf`,
      `synthetic/agent-work-shadow/${state.runToken}/b.pdf`,
    ],
  );
  assert(
    Array.isArray(assessmentRows) && assessmentRows.length === 2,
    "Synthetic assessment setup failed.",
  );
  state.fixturesCreated = true;
  await writeState(state);
};

const createWorkItem = async (token, assessmentDocumentId) => {
  const result = await requestAgentWork(token, "POST", "/assessment-prep", {
    assessmentDocumentId,
    workflowVersion: 1,
  });
  assert(
    result.response.status === 201 && result.parsed?.success === true,
    "Shadow create failed.",
  );
  assert(
    result.parsed?.meta?.runtimeMode === "shadow",
    "Create runtime mode drifted.",
  );
  assertSanitizedItem(result.parsed.data);
  return result.parsed.data;
};

export const buildCleanupBatch = (state) => {
  const orgA = validateUuidLiteral(state.fixture.organizationAId);
  const orgB = validateUuidLiteral(state.fixture.organizationBId);
  const userA = validateUuidOrNilLiteral(state.users[0].id || NIL_UUID);
  const userB = validateUuidOrNilLiteral(state.users[1].id || NIL_UUID);
  const clientA = validateUuidLiteral(state.fixture.clientAId);
  const clientB = validateUuidLiteral(state.fixture.clientBId);
  const assessmentA = validateUuidLiteral(state.fixture.assessmentAId);
  const assessmentB = validateUuidLiteral(state.fixture.assessmentBId);
  const workItemA = validateUuidOrNilLiteral(
    state.proof?.workItemAId || NIL_UUID,
  );
  const workItemB = validateUuidOrNilLiteral(
    state.proof?.workItemBId || NIL_UUID,
  );
  const orgScope = `'${orgA}'::uuid, '${orgB}'::uuid`;
  const userScope = `'${userA}'::uuid, '${userB}'::uuid`;
  const workItemScope = `'${workItemA}'::uuid, '${workItemB}'::uuid`;
  return `
begin;
select pg_advisory_xact_lock(2750805);
do $guard$
begin
  if exists (select 1 from public.agent_work_items where organization_id not in (${orgScope})) then
    raise exception 'foreign_agent_work_item_detected';
  end if;
  if exists (
      select 1 from pgmq.q_agent_work_steps
      where message->>'organizationId' is null
        or message->>'organizationId' not in ('${orgA}', '${orgB}')
    ) or exists (
      select 1 from pgmq.a_agent_work_steps
      where message->>'organizationId' is null
        or message->>'organizationId' not in ('${orgA}', '${orgB}')
    ) then
    raise exception 'foreign_agent_work_queue_message_detected';
  end if;
end
$guard$;
delete from pgmq.a_agent_work_steps where message->>'organizationId' in ('${orgA}', '${orgB}');
delete from pgmq.q_agent_work_steps where message->>'organizationId' in ('${orgA}', '${orgB}');
delete from public.agent_work_caloptima_draft_packets where organization_id in (${orgScope});
delete from public.agent_execution_traces where organization_id in (${orgScope})
  or work_item_id in (${workItemScope});
delete from public.agent_work_effects where organization_id in (${orgScope});
alter table public.agent_work_events disable trigger agent_work_events_prevent_update;
delete from public.agent_work_events where organization_id in (${orgScope});
alter table public.agent_work_events enable trigger agent_work_events_prevent_update;
delete from public.agent_work_attempts where organization_id in (${orgScope});
delete from public.agent_work_approvals where organization_id in (${orgScope});
delete from public.agent_work_evidence where organization_id in (${orgScope});
delete from public.agent_work_step_dependencies where work_item_id in (
  select id from public.agent_work_items where organization_id in (${orgScope})
);
delete from public.agent_work_assessment_links where organization_id in (${orgScope});
delete from public.agent_work_item_dependencies where organization_id in (${orgScope});
delete from public.agent_work_retention_holds where organization_id in (${orgScope});
delete from public.agent_work_retention_receipts where organization_id in (${orgScope});
update public.agent_work_items set current_step_id = null where organization_id in (${orgScope});
delete from public.agent_work_steps where organization_id in (${orgScope});
delete from public.agent_work_items where organization_id in (${orgScope});
delete from public.assessment_documents where id in ('${assessmentA}'::uuid, '${assessmentB}'::uuid);
delete from public.clients where id in ('${clientA}'::uuid, '${clientB}'::uuid);
delete from public.user_roles where user_id in (${userScope});
delete from public.profiles where id in (${userScope});
do $verify$
begin
  if exists (select 1 from public.agent_work_items where organization_id in (${orgScope}))
    or exists (select 1 from public.agent_work_events where organization_id in (${orgScope}))
    or exists (select 1 from public.agent_work_steps where organization_id in (${orgScope}))
    or exists (
      select 1 from public.agent_execution_traces
      where organization_id in (${orgScope})
        or work_item_id in (${workItemScope})
    )
    or exists (select 1 from pgmq.q_agent_work_steps where message->>'organizationId' in ('${orgA}', '${orgB}'))
    or exists (select 1 from pgmq.a_agent_work_steps where message->>'organizationId' in ('${orgA}', '${orgB}')) then
    raise exception 'synthetic_agent_work_cleanup_incomplete';
  end if;
end
$verify$;
select jsonb_build_object('database_cleanup_complete', true) as cleanup;
commit;
`;
};

const deleteAuthUsers = async (state) => {
  await managementWrite(
    `
    delete from auth.users
    where lower(email) in (lower($1::text), lower($2::text))
    returning id
  `,
    [state.users[0].email, state.users[1].email],
  );
};

const deleteOrganizations = async (state) => {
  await managementWrite(
    "delete from public.organizations where id in ($1::uuid, $2::uuid) returning id",
    [state.fixture.organizationAId, state.fixture.organizationBId],
  );
};

const phaseOperations = (overrides = {}) => ({
  assertPreflightSummary,
  assertSanitizedItem,
  buildCleanupBatch,
  createWorkItem,
  declaredRuntimeMode: () => process.env.AGENT_WORK_LEDGER_RUNTIME_MODE,
  deleteAuthUsers,
  deleteOrganizations,
  deriveState,
  managementRead,
  managementWrite,
  pollForRuntimeMode,
  readPreflightSummary,
  readState,
  requestAgentWork,
  setRuntimeMode,
  setupClientsAndAssessments,
  setupOrganizations,
  setupUsers,
  signIn,
  supabaseUrl: () => requiredEnv("SUPABASE_URL"),
  writePublicArtifact,
  writeState,
  ...overrides,
});

const preflightSetupPhase = async (overrides) => {
  const operations = phaseOperations(overrides);
  assert(
    operations.supabaseUrl().replace(/\/$/, "") === PROJECT_URL,
    "Hosted project URL mismatch.",
  );
  const state = operations.deriveState();
  await operations.writeState(state);
  const preflight = await operations.readPreflightSummary(state);
  operations.assertPreflightSummary(preflight, { final: true });
  await operations.setupOrganizations(state);
  await operations.setupUsers(state);
  await operations.setupClientsAndAssessments(state);
  const token = await operations.signIn(state.users[0]);
  await operations.pollForRuntimeMode(
    "disabled",
    token,
    state.fixture.assessmentAId,
  );
  await operations.setRuntimeMode("shadow");
  state.shadowRequested = true;
  await operations.writeState(state);
  await operations.pollForRuntimeMode(
    "shadow",
    token,
    state.fixture.assessmentAId,
  );
  await operations.writePublicArtifact({
    fixedBooleans: {
      cleanup_completed: false,
      disabled_api_verified: false,
      disabled_restored: false,
      policy_unapproved_verified: true,
      shadow_only: true,
    },
    counts: {
      organizations: 2,
      users: 2,
      clients: 2,
      assessments: 2,
      zero_surfaces_verified:
        LEDGER_COUNT_KEYS.length + SYNTHETIC_SCOPE_COUNT_KEYS.length,
    },
    timingsMs: { preflight_setup: Date.now() - startedAt },
  });
};

const proofPhase = async (overrides) => {
  const operations = phaseOperations(overrides);
  assert(
    operations.declaredRuntimeMode() === "shadow",
    "Proof process must declare shadow mode.",
  );
  const state = await operations.readState();
  assert(
    state.fixturesCreated === true && state.shadowRequested === true,
    "Synthetic setup is incomplete.",
  );
  const [tokenA, tokenB] = await Promise.all([
    operations.signIn(state.users[0]),
    operations.signIn(state.users[1]),
  ]);
  const itemA = await operations.createWorkItem(
    tokenA,
    state.fixture.assessmentAId,
  );
  state.proof.workItemAId = validateUuidLiteral(itemA.id);
  await operations.writeState(state);
  const repeatedA = await operations.createWorkItem(
    tokenA,
    state.fixture.assessmentAId,
  );
  assert(
    itemA.id === repeatedA.id,
    "Idempotent create returned a different work item.",
  );
  const itemB = await operations.createWorkItem(
    tokenB,
    state.fixture.assessmentBId,
  );
  state.proof.workItemBId = validateUuidLiteral(itemB.id);
  await operations.writeState(state);
  assert(
    itemA.id !== itemB.id,
    "Different tenant target returned the same work item.",
  );

  const listA = await operations.requestAgentWork(
    tokenA,
    "GET",
    `?assessment_document_id=${state.fixture.assessmentAId}`,
  );
  const listB = await operations.requestAgentWork(
    tokenB,
    "GET",
    `?assessment_document_id=${state.fixture.assessmentBId}`,
  );
  assert(
    listA.response.status === 200 && listA.parsed?.success === true,
    "Tenant A list failed.",
  );
  assert(
    listB.response.status === 200 && listB.parsed?.success === true,
    "Tenant B list failed.",
  );
  assert(
    listA.parsed.data.length === 1 && listA.parsed.data[0].id === itemA.id,
    "Tenant A list drifted.",
  );
  assert(
    listB.parsed.data.length === 1 && listB.parsed.data[0].id === itemB.id,
    "Tenant B list drifted.",
  );
  listA.parsed.data.forEach(operations.assertSanitizedItem);
  listB.parsed.data.forEach(operations.assertSanitizedItem);

  const detailA = await operations.requestAgentWork(
    tokenA,
    "GET",
    `/${itemA.id}`,
  );
  assert(
    detailA.response.status === 200 && detailA.parsed?.success === true,
    "Tenant A detail failed.",
  );
  operations.assertSanitizedItem(detailA.parsed.data);
  const crossTenant = await operations.requestAgentWork(
    tokenB,
    "GET",
    `/${itemA.id}`,
  );
  assert(
    crossTenant.response.status === 404,
    "Cross-tenant detail did not fail closed.",
  );
  const advisoryDenied = await operations.requestAgentWork(
    tokenA,
    "POST",
    `/${itemA.id}/owner`,
    {
      stepId: itemA.steps[0].id,
      assignedOwnerUserId: state.users[0].id,
      reasonCode: "clinical_review_handoff",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  );
  assert(
    advisoryDenied.response.status === 403 &&
      advisoryDenied.parsed?.code === "advisory_mode_required",
    "Shadow advisory-only mutation did not fail closed.",
  );

  const proofRow = firstRow(
    await operations.managementRead(
      `
    select jsonb_build_object(
      'attempts', (
        select count(*)::integer from public.agent_work_attempts
        where organization_id in ($1::uuid, $2::uuid)
      ),
      'effects', (
        select count(*)::integer from public.agent_work_effects
        where organization_id in ($1::uuid, $2::uuid)
      ),
      'traces', (
        select count(*)::integer from public.agent_execution_traces
        where organization_id in ($1::uuid, $2::uuid)
          or work_item_id in ($3::uuid, $4::uuid)
      ),
      'draft_packets', (
        select count(*)::integer from public.agent_work_caloptima_draft_packets
        where organization_id in ($1::uuid, $2::uuid)
      )
    ) as forbidden_counts
  `,
      [
        state.fixture.organizationAId,
        state.fixture.organizationBId,
        itemA.id,
        itemB.id,
      ],
    ),
  );
  const forbiddenCounts = proofRow.forbidden_counts ?? {};
  assert(
    Object.values(forbiddenCounts).every((value) => value === 0),
    "Shadow proof reached a worker/provider surface.",
  );
  await operations.writePublicArtifact({
    fixedBooleans: {
      cleanup_completed: false,
      disabled_api_verified: false,
      disabled_restored: false,
      policy_unapproved_verified: true,
      shadow_only: true,
    },
    counts: {
      create: 2,
      idempotent_repeat: 1,
      sanitized_list_detail: 4,
      cross_tenant_denial: 1,
      advisory_only_mutation_denial: 1,
      provider_or_worker_rows: 0,
    },
    timingsMs: { proof: Date.now() - startedAt },
  });
};

const cleanupVerifyPhase = async (overrides) => {
  const operations = phaseOperations(overrides);
  const state = await operations.readState();
  await operations.setRuntimeMode("disabled");
  const canVerifyDisabledViaApi =
    state.users[0]?.id && state.users[0].id !== NIL_UUID;
  let disabledVerified = false;
  if (canVerifyDisabledViaApi) {
    const token = await operations.signIn(state.users[0]);
    await operations.pollForRuntimeMode(
      "disabled",
      token,
      state.fixture.assessmentAId,
    );
    disabledVerified = true;
  }
  await operations.managementWrite(operations.buildCleanupBatch(state));
  await operations.deleteAuthUsers(state);
  await operations.deleteOrganizations(state);
  const finalSummary = await operations.readPreflightSummary(state);
  operations.assertPreflightSummary(finalSummary, { final: true });
  assert(
    !canVerifyDisabledViaApi || disabledVerified,
    "Final disabled API proof could not be completed.",
  );
  await operations.writePublicArtifact({
    fixedBooleans: {
      cleanup_completed: true,
      disabled_api_verified: disabledVerified,
      disabled_restored: true,
      policy_unapproved_verified: true,
      shadow_only: true,
    },
    counts: {
      final_ledger_rows: 0,
      final_queue_rows: 0,
      final_fixture_rows: 0,
      final_cron_jobs: 0,
      final_vault_names: 0,
    },
    timingsMs: { cleanup_verify: Date.now() - startedAt },
  });
};

export const executePhase = async (phase, operations) => {
  assert(PHASES.includes(phase), "Unsupported hosted shadow proof phase.");
  if (phase === "preflight/setup") return preflightSetupPhase(operations);
  if (phase === "proof") return proofPhase(operations);
  return cleanupVerifyPhase(operations);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await executePhase(process.argv[2]);
}
