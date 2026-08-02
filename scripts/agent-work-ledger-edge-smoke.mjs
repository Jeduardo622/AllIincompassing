import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Client } = pg;

const ADMIN_A = {
  id: "00000000-0000-4000-8000-00000000a011",
  email: "ledger-admin-a@example.invalid",
};
const BT_A = {
  id: "00000000-0000-4000-8000-00000000a012",
  email: "ledger-bt-a@example.invalid",
};
const ADMIN_B = {
  id: "00000000-0000-4000-8000-00000000a014",
  email: "ledger-admin-b@example.invalid",
};
const ORG_A_ID = "00000000-0000-4000-8000-00000000a001";
const CLIENT_ASSIGNED_ID = "00000000-0000-4000-8000-00000000a101";
const DOCUMENT_ASSIGNED_ID = "00000000-0000-4000-8000-00000000a201";
const SYNTHETIC_PASSWORD = "Synthetic-Ledger-Only-2026!";
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

const ITEM_KEYS = [
  "approvals",
  "blockers",
  "dueAt",
  "id",
  "objective",
  "ownerUserId",
  "risk",
  "status",
  "steps",
  "updatedAt",
  "workflowKey",
  "workflowVersion",
];
const STEP_KEYS = [
  "evidenceCount",
  "executionMode",
  "id",
  "key",
  "lastReasonCode",
  "status",
];
const BLOCKER_KEYS = ["action", "code", "stepKey"];
const APPROVAL_KEYS = ["expiresAt", "id", "requiredRole", "status", "stepId"];

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assertLoopback = (value, name) => {
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)) {
    throw new Error(`${name} must use a loopback host.`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertExactKeys = (value, expected, label) => {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  assert(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label} keys drifted.`);
};

const assertSanitizedItem = (item) => {
  assertExactKeys(item, ITEM_KEYS, "work item");
  assert(Array.isArray(item.steps), "work item steps must be an array.");
  assert(Array.isArray(item.blockers), "work item blockers must be an array.");
  assert(Array.isArray(item.approvals), "work item approvals must be an array.");
  item.steps.forEach((step) => assertExactKeys(step, STEP_KEYS, "work item step"));
  item.blockers.forEach((blocker) => assertExactKeys(blocker, BLOCKER_KEYS, "work item blocker"));
  item.approvals.forEach((approval) => assertExactKeys(approval, APPROVAL_KEYS, "work item approval"));
};

const request = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) body = await response.json();
  return { response, body };
};

const waitForFunction = async (url, child) => {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Local Edge Function exited before becoming healthy.");
    try {
      const { response } = await request(url);
      if (response.status === 401) return;
    } catch {
      // The local gateway may reset connections while the worker starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the local Edge Function.");
};

const stopProcessTree = (child) => {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
};

const signIn = async (supabaseUrl, anonKey, email) => {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
  if (error || !data.session?.access_token) {
    throw new Error(`Synthetic local sign-in failed (${error?.status ?? "no-status"}/${error?.code ?? "no-code"}).`);
  }
  return data.session.access_token;
};

const main = async () => {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLoopback(supabaseUrl, "SUPABASE_URL");
  assertLoopback(databaseUrl, "SUPABASE_DB_URL");

  const config = await readFile("supabase/config.toml", "utf8");
  const functionConfig = await readFile("supabase/functions/agent-work-items/function.toml", "utf8");
  assert(/\[functions\.agent-work-items\][\s\S]*?verify_jwt\s*=\s*true/.test(config), "Supabase config must keep JWT verification enabled.");
  assert(/verify_jwt\s*=\s*true/.test(functionConfig), "Function config must keep JWT verification enabled.");

  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  let documentId;
  try {
    await database.query(
      `
        update auth.users
        set encrypted_password = crypt($1, gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            confirmation_token = '',
            recovery_token = '',
            email_change_token_new = '',
            email_change = '',
            phone_change = '',
            phone_change_token = '',
            email_change_token_current = '',
            reauthentication_token = '',
            updated_at = now()
        where id = any($2::uuid[])
      `,
      [SYNTHETIC_PASSWORD, [ADMIN_A.id, BT_A.id, ADMIN_B.id]],
    );
    await database.query(
      `
        insert into auth.identities (
          provider_id,
          user_id,
          identity_data,
          provider,
          last_sign_in_at,
          created_at,
          updated_at
        )
        select
          users.id::text,
          users.id,
          jsonb_build_object(
            'sub', users.id::text,
            'email', users.email,
            'email_verified', true,
            'phone_verified', false
          ),
          'email',
          now(),
          now(),
          now()
        from auth.users as users
        where users.id = any($1::uuid[])
        on conflict (provider_id, provider) do update
        set identity_data = excluded.identity_data,
            updated_at = excluded.updated_at
      `,
      [[ADMIN_A.id, BT_A.id, ADMIN_B.id]],
    );
    const { rows } = await database.query(
      `
        select id
        from public.assessment_documents
        where id = $1::uuid
          and organization_id = $2::uuid
          and client_id = $3::uuid
          and template_type = 'iehp_fba'
          and object_path like 'synthetic/%'
      `,
      [DOCUMENT_ASSIGNED_ID, ORG_A_ID, CLIENT_ASSIGNED_ID],
    );
    documentId = rows[0]?.id;
  } finally {
    await database.end();
  }
  assert(typeof documentId === "string", "Synthetic assessment fixture is missing.");

  const runtimeDir = await mkdtemp(join(tmpdir(), "agent-work-edge-smoke-"));
  const runtimeFile = join(runtimeDir, "runtime.local");
  await writeFile(runtimeFile, "AGENT_WORK_LEDGER_RUNTIME_MODE=shadow\n", { encoding: "ascii", mode: 0o600 });

  let child;
  let output = "";
  try {
    // Pinned local gateways reject Auth's ES256 tokens. The function still verifies
    // the real user token with getUser; repository config remains verify_jwt=true.
    child = spawn(
      process.platform === "win32" ? "supabase.exe" : "supabase",
      ["functions", "serve", "agent-work-items", "--no-verify-jwt", "--env-file", runtimeFile],
      { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const collect = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-4_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const functionUrl = `${supabaseUrl}/functions/v1/agent-work-items`;
    await waitForFunction(functionUrl, child);

    const [adminToken, btToken, crossTenantToken] = await Promise.all([
      signIn(supabaseUrl, anonKey, ADMIN_A.email),
      signIn(supabaseUrl, anonKey, BT_A.email),
      signIn(supabaseUrl, anonKey, ADMIN_B.email),
    ]);
    const headersFor = (token) => ({
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });

    const createBody = JSON.stringify({ assessmentDocumentId: documentId, workflowVersion: 1 });
    const first = await request(`${functionUrl}/assessment-prep`, {
      method: "POST",
      headers: headersFor(adminToken),
      body: createBody,
    });
    const second = await request(`${functionUrl}/assessment-prep`, {
      method: "POST",
      headers: headersFor(adminToken),
      body: createBody,
    });
    assert(first.response.status === 201 && first.body?.success === true, "Create request failed.");
    assert(second.response.status === 201 && second.body?.success === true, "Idempotent create request failed.");
    assert(first.body.data.id === second.body.data.id, "Duplicate create returned a different work item.");
    assert(first.body.meta?.runtimeMode === "shadow", "Create response runtime mode drifted.");
    assertSanitizedItem(first.body.data);

    const list = await request(`${functionUrl}?assessment_document_id=${documentId}`, {
      headers: headersFor(btToken),
    });
    assert(list.response.status === 200 && list.body?.success === true, "Assigned BT list request failed.");
    assert(Array.isArray(list.body.data) && list.body.data.length > 0, "Assigned BT list was empty.");
    assert(list.body.meta?.runtimeMode === "shadow", "List response runtime mode drifted.");
    list.body.data.forEach(assertSanitizedItem);

    const detail = await request(`${functionUrl}/${first.body.data.id}`, {
      headers: headersFor(adminToken),
    });
    assert(detail.response.status === 200 && detail.body?.success === true, "Detail request failed.");
    assert(detail.body.meta?.runtimeMode === "shadow", "Detail response runtime mode drifted.");
    assertSanitizedItem(detail.body.data);

    const crossTenant = await request(`${functionUrl}/${first.body.data.id}`, {
      headers: headersFor(crossTenantToken),
    });
    assert(crossTenant.response.status === 404, "Cross-tenant detail did not fail closed.");

    const deferredPaths = [
      `/${first.body.data.id}/owner`,
      `/${first.body.data.id}/cancel`,
      `/${first.body.data.id}/resume`,
      `/${first.body.data.id}/approvals/00000000-0000-4000-8000-00000000a999/decision`,
      `/${first.body.data.id}/reconcile`,
    ];
    for (const path of deferredPaths) {
      const deferred = await request(`${functionUrl}${path}`, {
        method: "POST",
        headers: headersFor(adminToken),
        body: "{}",
      });
      assert(deferred.response.status === 501 && deferred.body?.code === "deferred_route", `Deferred route executed: ${path}`);
    }

    console.log("Agent work ledger local Edge smoke passed (create/list/detail/idempotency/tenant/deferred routes)." );
  } catch (error) {
    const safeOutput = output.replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-token]");
    if (safeOutput.trim()) console.error(safeOutput.trim());
    throw error;
  } finally {
    stopProcessTree(child);
    await rm(runtimeDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown Edge smoke failure.");
  process.exit(1);
});
