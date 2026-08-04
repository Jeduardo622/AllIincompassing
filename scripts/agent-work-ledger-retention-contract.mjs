import { Client } from "pg";

import { assertLocalPostgresUrl } from "./agent-work-ledger-harness/localRuntime.mjs";

const ORG_A_ID = "00000000-0000-4000-8000-00000000b001";
const ORG_B_ID = "00000000-0000-4000-8000-00000000b002";
const ADMIN_A_ID = "00000000-0000-0000-0000-000000000000";
const CLIENT_ID = "00000000-0000-4000-8000-00000000b101";
const DOCUMENT_ID = "00000000-0000-4000-8000-00000000b201";
const WORK_ITEM_ID = "00000000-0000-4000-8000-00000000b301";
const STEP_ID = "00000000-0000-4000-8000-00000000b401";
const EVIDENCE_ID = "00000000-0000-4000-8000-00000000b501";
const APPROVAL_ID = "00000000-0000-4000-8000-00000000b601";
const ATTEMPT_ID = "00000000-0000-4000-8000-00000000b701";
const EFFECT_ID = "00000000-0000-4000-8000-00000000b801";
const EVENT_ID = "00000000-0000-4000-8000-00000000b901";
const TRACE_ID = "00000000-0000-4000-8000-00000000ba01";
const DEDUPE_KEY = "retention-contract-v1";

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required.");
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const main = async () => {
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLocalPostgresUrl(databaseUrl, "SUPABASE_DB_URL");

  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query("begin");
    await database.query(
      "insert into public.organizations (id, name, slug) values ($1::uuid, 'Synthetic Retention A', 'synthetic-retention-a'), ($2::uuid, 'Synthetic Retention B', 'synthetic-retention-b')",
      [ORG_A_ID, ORG_B_ID],
    );
    await database.query(
      "insert into public.clients (id, full_name, organization_id) values ($1::uuid, 'Synthetic Retention Client', $2::uuid)",
      [CLIENT_ID, ORG_A_ID],
    );
    await database.query(
      "insert into public.assessment_documents (id, organization_id, client_id, template_type, file_name, mime_type, file_size, bucket_id, object_path, status) values ($1::uuid, $2::uuid, $3::uuid, 'iehp_fba', 'synthetic-retention.pdf', 'application/pdf', 1, 'client-documents', 'synthetic/retention.pdf', 'uploaded')",
      [DOCUMENT_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_work_items (id, organization_id, client_id, workflow_key, workflow_version, objective, status, risk, completion_criteria, dedupe_key) values ($1::uuid, $2::uuid, $3::uuid, 'assessment.iehp.prepare_for_clinical_review', 1, 'Synthetic retention contract work item.', 'queued', 'low', '{}'::jsonb, $4::text)",
      [WORK_ITEM_ID, ORG_A_ID, CLIENT_ID, DEDUPE_KEY],
    );
    await database.query(
      "insert into public.agent_work_steps (id, work_item_id, organization_id, client_id, step_key, ordinal, execution_mode, status, risk, completion_criteria) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'validate_scope', 10, 'deterministic', 'ready', 'low', '{}'::jsonb)",
      [STEP_ID, WORK_ITEM_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_work_evidence (id, work_item_id, step_id, organization_id, client_id, source_kind, source_id, locator, sha256, metadata) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'work_step', $3::uuid, 'secret-locator-marker', repeat('a', 64), '{\"secret\":\"evidence-marker\"}'::jsonb)",
      [EVIDENCE_ID, WORK_ITEM_ID, STEP_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_work_approvals (id, work_item_id, step_id, organization_id, client_id, workflow_version, required_role, status, request_reason_code, input_hash, evidence_hash, approval_hash) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'admin', 'approved', 'retention_contract', repeat('b', 64), repeat('c', 64), repeat('d', 64))",
      [APPROVAL_ID, WORK_ITEM_ID, STEP_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_work_attempts (id, work_item_id, step_id, organization_id, client_id, attempt_number, worker_id, status, lease_expires_at, provider, model, prompt_version, tool_version, workflow_version, model_request_schema_version, finished_at) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'worker-secret-marker', 'completed', now(), 'provider-secret-marker', 'model-secret-marker', 'prompt-secret-marker', 'tool-secret-marker', 1, 'request-v1', now())",
      [ATTEMPT_ID, WORK_ITEM_ID, STEP_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_work_effects (id, work_item_id, step_id, attempt_id, organization_id, client_id, effect_kind, target_kind, target_id, payload_hash, unique_effect_key, status, verified_at) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'advisory_projection', 'assessment_document', $7::uuid, repeat('e', 64), repeat('f', 64), 'verified', now())",
      [EFFECT_ID, WORK_ITEM_ID, STEP_ID, ATTEMPT_ID, ORG_A_ID, CLIENT_ID, DOCUMENT_ID],
    );
    await database.query(
      "insert into public.agent_work_events (id, work_item_id, step_id, attempt_id, organization_id, client_id, event_type, actor_kind, sanitized_metadata) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'retention.contract', 'system', '{\"secret\":\"event-marker\"}'::jsonb)",
      [EVENT_ID, WORK_ITEM_ID, STEP_ID, ATTEMPT_ID, ORG_A_ID, CLIENT_ID],
    );
    await database.query(
      "insert into public.agent_execution_traces (id, request_id, correlation_id, organization_id, work_item_id, step_id, attempt_id, step_name, step_index, status, payload, replay_payload) values ($1::uuid, 'retention-request', 'retention-correlation', $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'trace-secret-marker', 10, 'ok', '{\"secret\":\"trace-payload-marker\"}'::jsonb, '{\"secret\":\"trace-replay-marker\"}'::jsonb)",
      [TRACE_ID, ORG_A_ID, WORK_ITEM_ID, STEP_ID, ATTEMPT_ID],
    );

    let authenticatedRpcDenied = false;
    await database.query("savepoint authenticated_rpc_probe");
    try {
      await database.query("set local role authenticated");
      await database.query(
        "select public.export_agent_work_retention_manifest($1::uuid, $2::uuid)",
        [ORG_A_ID, WORK_ITEM_ID],
      );
    } catch (error) {
      authenticatedRpcDenied = error?.code === "42501";
      await database.query("rollback to savepoint authenticated_rpc_probe");
    }
    assert(authenticatedRpcDenied, "Authenticated export execution did not fail closed.");

    let authenticatedTableDenied = false;
    await database.query("savepoint authenticated_table_probe");
    try {
      await database.query("set local role authenticated");
      await database.query("select count(*) from public.agent_work_retention_holds");
    } catch (error) {
      authenticatedTableDenied = error?.code === "42501";
      await database.query("rollback to savepoint authenticated_table_probe");
    }
    assert(authenticatedTableDenied, "Authenticated retention table access did not fail closed.");

    await database.query("set local role service_role");
    await database.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await database.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role", sub: ADMIN_A_ID }),
    ]);
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN_A_ID]);

    const { rows: policyRows } = await database.query(
      "select count(*)::integer as count from public.agent_work_retention_policies",
    );
    assert(policyRows[0]?.count === 0, "Retention policy registry must start unconfigured.");

    const workItemId = WORK_ITEM_ID;

    let crossTenantHoldDenied = false;
    await database.query("savepoint cross_tenant_hold_probe");
    try {
      await database.query(
        "insert into public.agent_work_retention_holds (organization_id, work_item_id, category, reason_code, provenance_code, approved_by, approved_at) values ($1::uuid, $2::uuid, 'ledger_history', 'legal_hold', 'WIN-271', $3::uuid, now())",
        [ORG_B_ID, workItemId, ADMIN_A_ID],
      );
    } catch (error) {
      crossTenantHoldDenied = error?.code === "23503";
      await database.query("rollback to savepoint cross_tenant_hold_probe");
    }
    assert(crossTenantHoldDenied, "Cross-tenant hold metadata did not fail closed.");

    let crossTenantReceiptDenied = false;
    await database.query("savepoint cross_tenant_receipt_probe");
    try {
      await database.query(
        "insert into public.agent_work_retention_receipts (organization_id, work_item_id, category, export_schema_version, manifest_hash, exported_row_count) values ($1::uuid, $2::uuid, 'ledger_history', 'agent-work-retention.v1', repeat('0', 64), 0)",
        [ORG_B_ID, workItemId],
      );
    } catch (error) {
      crossTenantReceiptDenied = error?.code === "23503";
      await database.query("rollback to savepoint cross_tenant_receipt_probe");
    }
    assert(crossTenantReceiptDenied, "Cross-tenant receipt metadata did not fail closed.");

    await database.query(
      "insert into public.agent_work_retention_holds (organization_id, work_item_id, category, reason_code, provenance_code, approved_by, approved_at) values ($1::uuid, $2::uuid, 'ledger_history', 'legal_hold', 'WIN-271', $3::uuid, now())",
      [ORG_A_ID, workItemId, ADMIN_A_ID],
    );

    const exportQuery =
      "select public.export_agent_work_retention_manifest($1::uuid, $2::uuid) as result";
    const first = (await database.query(exportQuery, [ORG_A_ID, workItemId])).rows[0]?.result;
    const second = (await database.query(exportQuery, [ORG_A_ID, workItemId])).rows[0]?.result;

    assert(first?.export_schema_version === "agent-work-retention.v1", "Export schema version drifted.");
    assert(/^[0-9a-f]{64}$/.test(first?.manifest_hash ?? ""), "Export hash was not canonical SHA-256.");
    assert(first.manifest_hash === second?.manifest_hash, "Repeated export hash was not deterministic.");
    assert(JSON.stringify(first.manifest) === JSON.stringify(second?.manifest), "Repeated export manifest drifted.");
    assert(first.manifest?.work_item?.id === workItemId, "Export escaped the exact work item.");
    assert(Array.isArray(first.manifest?.steps) && first.manifest.steps.length > 0, "Export omitted steps.");
    const seededRelationIds = {
      evidence: EVIDENCE_ID,
      approvals: APPROVAL_ID,
      attempts: ATTEMPT_ID,
      effects: EFFECT_ID,
      events: EVENT_ID,
      traces: TRACE_ID,
    };
    for (const [relation, seededId] of Object.entries(seededRelationIds)) {
      assert(
        first.manifest?.[relation]?.some((row) => row.id === seededId),
        `Export omitted the seeded ${relation} row.`,
      );
    }
    assert(first.manifest?.holds?.length === 1, "Export omitted the active hold.");
    assert(/^[0-9a-f]{64}$/.test(first.manifest.attempts[0]?.worker_id_hash ?? ""), "Worker identifier was not hashed.");
    assert(/^[0-9a-f]{64}$/.test(first.manifest.attempts[0]?.provider_hash ?? ""), "Provider identifier was not hashed.");
    assert(/^[0-9a-f]{64}$/.test(first.manifest.traces[0]?.step_name_hash ?? ""), "Trace step name was not hashed.");
    assert(/^[0-9a-f]{64}$/.test(first.manifest.traces[0]?.payload_hash ?? ""), "Trace payload was not hashed.");
    assert(/^[0-9a-f]{64}$/.test(first.manifest.traces[0]?.replay_hash ?? ""), "Trace replay payload was not hashed.");
    assert(first.manifest.holds[0]?.reason_code === "legal_hold", "Active hold was omitted from export.");
    const serializedExport = JSON.stringify(first);
    assert(!serializedExport.includes("Synthetic"), "Export included source-like free-form content.");
    assert(!serializedExport.includes("secret"), "Export included unhashed sentinel content.");

    let crossTenantDenied = false;
    await database.query("savepoint cross_tenant_export_probe");
    try {
      await database.query(exportQuery, [ORG_B_ID, workItemId]);
    } catch (error) {
      crossTenantDenied = error?.code === "P0002";
      await database.query("rollback to savepoint cross_tenant_export_probe");
    }
    assert(crossTenantDenied, "Cross-tenant export did not fail closed.");

    const { rows: holdRows } = await database.query(
      "select category, reason_code, provenance_code from public.agent_work_retention_holds where organization_id = $1::uuid and work_item_id = $2::uuid and released_at is null",
      [ORG_A_ID, workItemId],
    );
    assert(
      holdRows.length === 1 &&
        holdRows[0].category === "ledger_history" &&
        holdRows[0].reason_code === "legal_hold" &&
        holdRows[0].provenance_code === "WIN-271",
      "Machine-coded hold scope drifted.",
    );

    const { rows: pruneRows } = await database.query(
      "select public.prune_agent_work_retention_category($1::uuid, 'ledger_history', $2::text) as result",
      [ORG_A_ID, first.manifest_hash],
    );
    const prune = pruneRows[0]?.result;
    assert(
      prune?.success === false &&
        prune?.reason_code === "policy_unapproved" &&
        prune?.deleted_count === 0,
      "Unapproved prune did not return a fixed zero-delete denial.",
    );

    await database.query("reset role");
    const { rows: preservedRows } = await database.query(
      "select (select count(*)::integer from public.agent_work_items where id = $1::uuid) as work_item_count, (select count(*)::integer from public.assessment_documents where id = $2::uuid) as document_count",
      [workItemId, DOCUMENT_ID],
    );
    assert(
      preservedRows[0]?.work_item_count === 1 && preservedRows[0]?.document_count === 1,
      "Prune denial changed ledger or assessment-domain authority.",
    );

    console.log(
      JSON.stringify({
        success: true,
        exportSchemaVersion: first.export_schema_version,
        manifestHash: first.manifest_hash,
        stepCount: first.manifest.steps.length,
        relationCount: 7,
        crossTenantDenied: true,
        crossTenantMetadataDenied: true,
        nonServiceRoleDenied: true,
        holdPreserved: true,
        pruneReasonCode: prune.reason_code,
        deletedCount: prune.deleted_count,
        assessmentDomainPreserved: true,
      }),
    );
  } finally {
    try {
      await database.query("rollback");
    } finally {
      await database.end();
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown retention contract failure.");
  process.exit(1);
});
