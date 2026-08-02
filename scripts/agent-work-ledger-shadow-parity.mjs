import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

const WORKFLOW_KEY = "assessment.iehp.prepare_for_clinical_review";
const WORKFLOW_VERSION = 1;
const RUNTIME_MODE = (process.env.AGENT_WORK_LEDGER_RUNTIME_MODE ?? "shadow")
  .trim()
  .toLowerCase();
const OUTPUT_RUNTIME_MODE = "shadow";
const DURATION_MS = 0;
const TEST_FAULT = (process.env.AGENT_WORK_LEDGER_TEST_FAULT ?? "none").trim();

const FIXTURE_SCOPE = {
  organizationId: "00000000-0000-4000-8000-00000000b001",
  clientId: "00000000-0000-4000-8000-00000000b101",
  ownerUserId: "00000000-0000-4000-8000-00000000b011",
  fallbackUserId: "00000000-0000-4000-8000-00000000b012",
  uploadedBy: "00000000-0000-4000-8000-00000000b013",
  templateVersionId: "00000000-0000-4000-8000-00000000b201",
};

const FIXTURES = [
  {
    fixture_id: "success_extraction",
    expectedWorkItemStatus: "needs_review",
    expectedBlockerCodes: [],
    expectedReadinessHash: "88865485a889b4fb26f0c1173df83d38dafa638df5203280bb44ef6315f77633",
    documentId: "00000000-0000-4000-8000-00000000c001",
    objectPath: "synthetic/ledger-shadow/success.pdf",
    documentState: "extracted",
    ownerDirective: { type: "assign", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d001",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e001",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "approved",
        payload: { state: "v1", marker: "success" },
      },
    ],
    extractionRows: [
      {
        id: "00000000-0000-4000-8000-00000000f001",
        sectionKey: "identification_admin",
        fieldKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    extraReviewEvents: [],
    approvalMode: "none",
  },
  {
    fixture_id: "extraction_failure",
    expectedWorkItemStatus: "blocked",
    expectedBlockerCodes: ["extraction_failed"],
    expectedReadinessHash: "61c4f77dc3af19d2458a7a18ac4c6e1bd58f9f4a75fa2d4b419c5e4984654f94",
    documentId: "00000000-0000-4000-8000-00000000c002",
    objectPath: "synthetic/ledger-shadow/extraction-failure.pdf",
    documentState: "extraction_failed",
    ownerDirective: { type: "assign", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d002",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "not_started",
        valueText: null,
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e002",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "not_started",
        payload: { state: "v1", marker: "failure" },
      },
    ],
    extractionRows: [],
    extraReviewEvents: [],
    approvalMode: "none",
  },
  {
    fixture_id: "missing_checklist_evidence",
    expectedWorkItemStatus: "blocked",
    expectedBlockerCodes: ["missing_required_evidence"],
    expectedReadinessHash: "c8fb60f15685049328caf0353a4c0bdb6254f3a6583dd9a88bb50bfdf1adaa1d",
    documentId: "00000000-0000-4000-8000-00000000c003",
    objectPath: "synthetic/ledger-shadow/missing-checklist.pdf",
    documentState: "extracted",
    ownerDirective: { type: "assign", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d003",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "not_started",
        valueText: null,
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e003",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "approved",
        payload: { state: "v1", marker: "missing-checklist" },
      },
    ],
    extractionRows: [
      {
        id: "00000000-0000-4000-8000-00000000f003",
        sectionKey: "identification_admin",
        fieldKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "drafted",
        valueText: null,
      },
    ],
    extraReviewEvents: [],
    approvalMode: "none",
  },
  {
    fixture_id: "stale_approval",
    expectedWorkItemStatus: "needs_review",
    expectedBlockerCodes: [],
    expectedReadinessHash: "5cfd86c649d261082db735ff3a59a4e3b41662bb5f370a412334fbf035b78562",
    documentId: "00000000-0000-4000-8000-00000000c004",
    objectPath: "synthetic/ledger-shadow/stale-approval.pdf",
    documentState: "extracted",
    ownerDirective: { type: "assign", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d004",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e004",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "approved",
        payload: { state: "v1", marker: "stale-approval" },
      },
    ],
    extractionRows: [
      {
        id: "00000000-0000-4000-8000-00000000f004",
        sectionKey: "identification_admin",
        fieldKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    extraReviewEvents: [],
    approvalMode: "expired",
  },
  {
    fixture_id: "changed_structured_section",
    expectedWorkItemStatus: "needs_review",
    expectedBlockerCodes: [],
    expectedReadinessHash: "496e6e1fe6209036ee4bb0aacb9c7b417393b7ddc1be7dcdd1d7677ff57e360e",
    documentId: "00000000-0000-4000-8000-00000000c005",
    objectPath: "synthetic/ledger-shadow/changed-structured-section.pdf",
    documentState: "extracted",
    ownerDirective: { type: "assign", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d005",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e005",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "approved",
        payload: { state: "v2", marker: "changed-structured-section" },
      },
    ],
    extractionRows: [
      {
        id: "00000000-0000-4000-8000-00000000f005",
        sectionKey: "identification_admin",
        fieldKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    extraReviewEvents: [],
    approvalMode: "none",
  },
  {
    fixture_id: "owner_removal",
    expectedWorkItemStatus: "blocked",
    expectedBlockerCodes: ["missing_owner"],
    expectedReadinessHash: "e7f73b80e37a8984ff6bd7fbf457c717b81884e25ed610e1f5ebf0de7b30502d",
    documentId: "00000000-0000-4000-8000-00000000c006",
    objectPath: "synthetic/ledger-shadow/owner-removal.pdf",
    documentState: "extracted",
    ownerDirective: { type: "remove", ownerUserId: FIXTURE_SCOPE.ownerUserId },
    checklistRows: [
      {
        id: "00000000-0000-4000-8000-00000000d006",
        sectionKey: "identification_admin",
        placeholderKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    sectionRows: [
      {
        id: "00000000-0000-4000-8000-00000000e006",
        sectionKey: "treatment_coordination_recommendations",
        fieldKey: "IEHP_FBA_SIGNATURE_BLOCK",
        sectionIndex: 0,
        required: true,
        status: "approved",
        payload: { state: "v1", marker: "owner-removed" },
      },
    ],
    extractionRows: [
      {
        id: "00000000-0000-4000-8000-00000000f006",
        sectionKey: "identification_admin",
        fieldKey: "IEHP_FBA_ASSESSOR_PHONE",
        mode: "ASSISTED",
        required: true,
        status: "approved",
        valueText: "synthetic-approved-phone",
      },
    ],
    extraReviewEvents: [],
    approvalMode: "none",
  },
];

const FIXTURE_RECORD_KEYS = [
  "fixture_id",
  "projection_count",
  "mismatch_reason_code",
  "authoritative_state",
  "projected_state",
  "state_transition",
  "evidence_pointer_coverage_rate",
  "runtime_mode",
  "workflow_version",
  "duration_ms",
];

const SUMMARY_KEYS = [
  "fixture_count",
  "matched_count",
  "mismatch_count",
  "mismatch_rate",
  "coverage_full_count",
  "coverage_full_rate",
  "negative_probe_count",
  "negative_probe_pass_count",
  "negative_probe_pass_rate",
];

const ALLOWED_LEDGER_EVIDENCE_KINDS = new Set([
  "assessment_document",
  "assessment_checklist_item",
  "assessment_structured_section",
  "assessment_review_event",
  "assessment_template_layout",
]);

const REQUIRED_NEGATIVE_CODES = [
  "false_ready",
  "false_complete",
  "tenant_mismatch",
  "missing_evidence_pointer",
  "state_regression",
  "unexplained_projection_mismatch",
  "sanitizer_violation",
];

const STATUS_ORDER = new Map([
  ["queued", 0],
  ["running", 1],
  ["waiting", 2],
  ["blocked", 3],
  ["needs_review", 4],
  ["completed", 5],
]);

const requiredEnv = (name) => {
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

const assertLoopbackHttpUrl = (value, name) => {
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)) {
    throw new Error(`${name} must use a loopback host.`);
  }
};

const assertLoopbackDatabaseUrl = (value, name) => {
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)) {
    throw new Error(`${name} must use a loopback host.`);
  }
};

const parseStatusEnv = (output) => {
  const values = {};
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
};

const assertMatchesRunningLocalStack = (supabaseUrl, databaseUrl) => {
  const childEnv = { ...process.env };
  delete childEnv.SUPABASE_PROJECT_REF;
  delete childEnv.VITE_SUPABASE_PROJECT_REF;
  const supabaseCli = join(
    process.cwd(),
    "node_modules/supabase/bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const result = spawnSync(supabaseCli, ["status", "-o", "env"], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error("local_stack_status_unavailable");
  }
  const statusEnv = parseStatusEnv(result.stdout);
  const expectedApiUrl = statusEnv.API_URL?.replace(/\/$/, "");
  const actualApiUrl = supabaseUrl.replace(/\/$/, "");
  if (
    !expectedApiUrl ||
    !statusEnv.DB_URL ||
    actualApiUrl !== expectedApiUrl ||
    databaseUrl !== statusEnv.DB_URL
  ) {
    throw new Error("local_stack_identity_mismatch");
  }
};

const stableStringify = (value) => JSON.stringify(normalizeValue(value));

const normalizeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = normalizeValue(value[key]);
        return accumulator;
      }, {});
  }
  return value;
};

const hashValue = (value) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

const sanitizeTopLevelKeys = (value, allowedKeys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  assert(
    stableStringify(actual) === stableStringify(expected),
    `${label} keys drifted.`,
  );
};

const sanitizeSerializedOutput = (serialized) => {
  const forbiddenPatterns = [
    /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\bhttps?:\/\//i,
    /[A-Za-z]:\\/i,
    /\/[^"\s]+/i,
    /\.pdf\b/i,
    /\b(?:eyJ|sk-)[A-Za-z0-9._-]+/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw new Error("sanitizer_violation");
    }
  }
};

const createBridgeModule = async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "agent-work-ledger-shadow-"));
  try {
    const bridgePath = join(runtimeDir, "bridge.mts");
    const adapterUrl = pathToFileURL(
      join(process.cwd(), "supabase/functions/_shared/agent-work/assessment-prep.ts"),
    ).href;
    const bridgeSource = `import { deriveAssessmentPrepShadow } from ${JSON.stringify(adapterUrl)};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const snapshot = JSON.parse(Buffer.concat(chunks).toString("utf8"));
process.stdout.write(JSON.stringify(deriveAssessmentPrepShadow(snapshot)));
`;
    await writeFile(bridgePath, bridgeSource, { encoding: "utf8" });
    return { runtimeDir, bridgePath };
  } catch (error) {
    await rm(runtimeDir, { recursive: true, force: true });
    throw error;
  }
};

const deriveShadowProjection = async (bridgePath, snapshot) => {
  const tsxCliPath = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const commandArgs = TEST_FAULT === "bridge"
    ? [
      "-e",
      "console.error('synthetic-secret@example.invalid C:\\\\fixture\\\\artifact.pdf 00000000-0000-4000-8000-00000000ffff'); process.exit(1)",
    ]
    : TEST_FAULT === "malformed_bridge"
    ? ["-e", "process.stdout.write('{')"]
    : [tsxCliPath, bridgePath];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    input: JSON.stringify(snapshot),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error("adapter_bridge_failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("adapter_bridge_failed");
  }
};

const seedGlobalScope = async (client) => {
  await client.query(
    `
      insert into public.organizations (id, name, slug, metadata)
      values ($1::uuid, 'Ledger Shadow Org', 'ledger-shadow-org', '{}'::jsonb)
      on conflict (id) do nothing
    `,
    [FIXTURE_SCOPE.organizationId],
  );

  await client.query(
    `
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
        ('00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated', 'shadow-owner@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb),
        ('00000000-0000-0000-0000-000000000000', $2::uuid, 'authenticated', 'authenticated', 'shadow-fallback@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb),
        ('00000000-0000-0000-0000-000000000000', $3::uuid, 'authenticated', 'authenticated', 'shadow-uploader@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb)
      on conflict (id) do nothing
    `,
    [
      FIXTURE_SCOPE.ownerUserId,
      FIXTURE_SCOPE.fallbackUserId,
      FIXTURE_SCOPE.uploadedBy,
      JSON.stringify({ organization_id: FIXTURE_SCOPE.organizationId }),
    ],
  );

  await client.query(
    "select set_config('app.bypass_profile_role_guard', 'on', true)",
  );
  await client.query(
    `
      update public.profiles
      set role = values_table.role::public.role_type,
          first_name = values_table.first_name,
          last_name = values_table.last_name,
          organization_id = values_table.organization_id::uuid,
          is_active = true,
          updated_at = now()
      from (
        values
          ($1::uuid, 'bcba', 'Shadow', 'Owner', $4::uuid),
          ($2::uuid, 'admin', 'Shadow', 'Fallback', $4::uuid),
          ($3::uuid, 'admin', 'Shadow', 'Uploader', $4::uuid)
      ) as values_table(id, role, first_name, last_name, organization_id)
      where profiles.id = values_table.id;
    `,
    [
      FIXTURE_SCOPE.ownerUserId,
      FIXTURE_SCOPE.fallbackUserId,
      FIXTURE_SCOPE.uploadedBy,
      FIXTURE_SCOPE.organizationId,
    ],
  );
  await client.query(
    "select set_config('app.bypass_profile_role_guard', 'off', true)",
  );

  await client.query(
    `
      insert into public.user_roles (user_id, role_id, is_active)
      select values_table.user_id, roles.id, true
      from (
        values
          ($1::uuid, 'bcba'),
          ($2::uuid, 'admin'),
          ($3::uuid, 'admin')
      ) as values_table(user_id, role_name)
      join public.roles on roles.name = values_table.role_name
      on conflict do nothing
    `,
    [
      FIXTURE_SCOPE.ownerUserId,
      FIXTURE_SCOPE.fallbackUserId,
      FIXTURE_SCOPE.uploadedBy,
    ],
  );

  await client.query(
    `
      insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
      values ($1::uuid, 'shadow-owner@example.invalid', 'Shadow Owner', 'Shadow', 'Owner', 'active', $2::uuid)
      on conflict (id) do nothing
    `,
    [FIXTURE_SCOPE.ownerUserId, FIXTURE_SCOPE.organizationId],
  );

  await client.query(
    `
      insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
      values ($1::uuid, 'Shadow Client', 'active', $2::uuid, $3::uuid, $4::uuid, $4::uuid)
      on conflict (id) do nothing
    `,
    [
      FIXTURE_SCOPE.clientId,
      FIXTURE_SCOPE.organizationId,
      FIXTURE_SCOPE.ownerUserId,
      FIXTURE_SCOPE.uploadedBy,
    ],
  );

  await client.query(
    `
      insert into public.client_therapist_links (client_id, therapist_id, organization_id, created_by)
      values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
      on conflict do nothing
    `,
    [
      FIXTURE_SCOPE.clientId,
      FIXTURE_SCOPE.ownerUserId,
      FIXTURE_SCOPE.organizationId,
      FIXTURE_SCOPE.uploadedBy,
    ],
  );

  await client.query(
    `
      insert into public.assessment_template_versions (
        id,
        template_type,
        version_key,
        source_document_name,
        page_count,
        source_sha256,
        status
      )
      values (
        $1::uuid,
        'iehp_fba',
        'agent-ledger-shadow-fixture-v1',
        'synthetic-layout.docx',
        1,
        $2::text,
        'draft'
      )
      on conflict (id) do nothing
    `,
    [
      FIXTURE_SCOPE.templateVersionId,
      hashValue({ version: "agent-ledger-shadow-fixture-v1" }),
    ],
  );
};

const insertFixtureRows = async (client, fixture) => {
  await client.query(
    `
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
        object_path,
        status,
        template_version_id
      )
      values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        'iehp_fba',
        'synthetic-shadow-fixture',
        'application/pdf',
        128,
        'client-documents',
        $5::text,
        $6::text,
        $7::uuid
      )
    `,
    [
      fixture.documentId,
      FIXTURE_SCOPE.organizationId,
      FIXTURE_SCOPE.clientId,
      FIXTURE_SCOPE.uploadedBy,
      fixture.objectPath,
      fixture.documentState,
      FIXTURE_SCOPE.templateVersionId,
    ],
  );

  for (const row of fixture.extractionRows) {
    await client.query(
      `
        insert into public.assessment_extractions (
          id,
          assessment_document_id,
          organization_id,
          client_id,
          section_key,
          field_key,
          label,
          mode,
          required,
          value_text,
          status
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::text,
          $6::text,
          $7::text,
          $8::text,
          $9::boolean,
          $10::text,
          $11::text
        )
      `,
      [
        row.id,
        fixture.documentId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        row.sectionKey,
        row.fieldKey,
        row.fieldKey,
        row.mode,
        row.required,
        row.valueText,
        row.status,
      ],
    );
  }

  for (const row of fixture.checklistRows) {
    await client.query(
      `
        insert into public.assessment_checklist_items (
          id,
          assessment_document_id,
          organization_id,
          client_id,
          section_key,
          label,
          placeholder_key,
          mode,
          source,
          required,
          extraction_method,
          validation_rule,
          status,
          value_text
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::text,
          $6::text,
          $7::text,
          $8::text,
          'synthetic',
          $9::boolean,
          'synthetic',
          'non_empty',
          $10::text,
          $11::text
        )
      `,
      [
        row.id,
        fixture.documentId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        row.sectionKey,
        row.placeholderKey,
        row.placeholderKey,
        row.mode,
        row.required,
        row.status,
        row.valueText,
      ],
    );
  }

  for (const row of fixture.sectionRows) {
    await client.query(
      `
        insert into public.assessment_structured_sections (
          id,
          assessment_document_id,
          organization_id,
          client_id,
          section_key,
          field_key,
          section_index,
          payload,
          status,
          required
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::text,
          $6::text,
          $7::integer,
          $8::jsonb,
          $9::text,
          $10::boolean
        )
      `,
      [
        row.id,
        fixture.documentId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        row.sectionKey,
        row.fieldKey,
        row.sectionIndex,
        JSON.stringify(row.payload),
        row.status,
        row.required,
      ],
    );
  }

  const createdAt = "2026-08-02T00:00:00.000Z";
  const ownerPayload =
    fixture.ownerDirective.type === "assign"
      ? { owner_user_id: fixture.ownerDirective.ownerUserId }
      : { owner_user_id: fixture.ownerDirective.ownerUserId };

  await client.query(
    `
      insert into public.assessment_review_events (
        id,
        assessment_document_id,
        organization_id,
        client_id,
        item_type,
        item_id,
        action,
        from_status,
        to_status,
        notes,
        event_payload,
        actor_id,
        created_at
      )
      values
        (
          $1::uuid,
          $4::uuid,
          $5::uuid,
          $6::uuid,
          'document',
          $4::uuid,
          'extraction_observed',
          'uploaded',
          $7::text,
          'synthetic',
          '{}'::jsonb,
          $8::uuid,
          $9::timestamptz
        ),
        (
          $2::uuid,
          $4::uuid,
          $5::uuid,
          $6::uuid,
          'document',
          $4::uuid,
          'owner_assigned',
          null,
          null,
          'synthetic',
          $3::jsonb,
          $8::uuid,
          $10::timestamptz
        )
    `,
    [
      `00000000-0000-4000-8000-${fixture.documentId.slice(-12)}`,
      `10000000-0000-4000-8000-${fixture.documentId.slice(-12)}`,
      JSON.stringify(ownerPayload),
      fixture.documentId,
      FIXTURE_SCOPE.organizationId,
      FIXTURE_SCOPE.clientId,
      fixture.documentState,
      FIXTURE_SCOPE.uploadedBy,
      createdAt,
      "2026-08-02T00:01:00.000Z",
    ],
  );

  if (fixture.ownerDirective.type === "remove") {
    await client.query(
      `
        insert into public.assessment_review_events (
          id,
          assessment_document_id,
          organization_id,
          client_id,
          item_type,
          item_id,
          action,
          from_status,
          to_status,
          notes,
          event_payload,
          actor_id,
          created_at
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          'document',
          $2::uuid,
          'owner_removed',
          null,
          null,
          'synthetic',
          $5::jsonb,
          $6::uuid,
          $7::timestamptz
        )
      `,
      [
        `20000000-0000-4000-8000-${fixture.documentId.slice(-12)}`,
        fixture.documentId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        JSON.stringify({ owner_user_id: fixture.ownerDirective.ownerUserId }),
        FIXTURE_SCOPE.uploadedBy,
        "2026-08-02T00:02:00.000Z",
      ],
    );
  }

  for (const event of fixture.extraReviewEvents) {
    await client.query(
      `
        insert into public.assessment_review_events (
          id,
          assessment_document_id,
          organization_id,
          client_id,
          item_type,
          item_id,
          action,
          from_status,
          to_status,
          notes,
          event_payload,
          actor_id,
          created_at
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          'document',
          $2::uuid,
          $5::text,
          null,
          null,
          'synthetic',
          $6::jsonb,
          $7::uuid,
          $8::timestamptz
        )
      `,
      [
        event.id,
        fixture.documentId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        event.action,
        JSON.stringify(event.payload),
        FIXTURE_SCOPE.uploadedBy,
        event.createdAt,
      ],
    );
  }
};

const loadAuthoritativeSnapshot = async (client, fixture) => {
  const { rows: documentRows } = await client.query(
    `
      select id, organization_id, client_id, template_type, status, template_version_id
      from public.assessment_documents
      where id = $1::uuid
    `,
    [fixture.documentId],
  );
  const documentRow = documentRows[0];
  assert(documentRow, `Missing synthetic assessment document for ${fixture.fixture_id}.`);

  const checklistResult = await client.query(
      `
        select id, placeholder_key, status, required, value_text
        from public.assessment_checklist_items
        where assessment_document_id = $1::uuid
        order by placeholder_key
      `,
      [fixture.documentId],
    );
  const sectionResult = await client.query(
      `
        select id, field_key, status, required, payload
        from public.assessment_structured_sections
        where assessment_document_id = $1::uuid
        order by field_key, section_index
      `,
      [fixture.documentId],
    );
  const reviewEventResult = await client.query(
      `
        select id, action, event_payload, created_at
        from public.assessment_review_events
        where assessment_document_id = $1::uuid
        order by created_at asc, id asc
      `,
      [fixture.documentId],
    );
  const templateResult = await client.query(
      `
        select id, version_key, source_sha256
        from public.assessment_template_versions
        where id = $1::uuid
      `,
      [documentRow.template_version_id],
    );

  const templateRow = templateResult.rows[0];
  assert(templateRow, `Missing synthetic assessment template version for ${fixture.fixture_id}.`);

  const ownerEvent = [...reviewEventResult.rows].reverse().find((row) =>
    row.action === "owner_removed" || row.action === "owner_assigned"
  );
  const ownerId =
    ownerEvent?.action === "owner_removed"
      ? null
      : ownerEvent?.event_payload?.owner_user_id ?? null;

  let ownerAuthorized = false;
  if (ownerId) {
    const { rows } = await client.query(
      `
        select role.name
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id
        join public.profiles profile on profile.id = user_role.user_id
        where user_role.user_id = $1::uuid
          and profile.organization_id = $2::uuid
          and coalesce(user_role.is_active, true) = true
          and role.name in ('admin', 'bcba', 'super_admin')
      `,
      [ownerId, FIXTURE_SCOPE.organizationId],
    );
    ownerAuthorized = rows.length > 0;
  }

  const missingChecklist = checklistResult.rows
    .filter((row) => row.required === true && row.status !== "approved")
    .map((row) => ({
      sourceKind: "assessment_checklist_item",
      sourceId: row.id,
      locator: row.placeholder_key,
      sha256: hashValue({
        fixture: fixture.fixture_id,
        kind: "checklist",
        id: row.id,
        placeholderKey: row.placeholder_key,
        status: row.status,
        valueText: row.value_text,
      }),
    }));

  const missingSections = sectionResult.rows
    .filter((row) => row.required === true && row.status !== "approved")
    .map((row) => ({
      sourceKind: "assessment_structured_section",
      sourceId: row.id,
      locator: row.field_key,
      sha256: hashValue({
        fixture: fixture.fixture_id,
        kind: "section",
        id: row.id,
        fieldKey: row.field_key,
        status: row.status,
        payload: row.payload,
      }),
    }));

  const evidence = [
    {
      sourceKind: "assessment_document",
      sourceId: documentRow.id,
      sha256: hashValue({
        fixture: fixture.fixture_id,
        kind: "document",
        id: documentRow.id,
        status: documentRow.status,
        templateType: documentRow.template_type,
      }),
    },
    {
      sourceKind: "assessment_template_layout",
      sourceId: templateRow.id,
      sha256: hashValue({
        fixture: fixture.fixture_id,
        kind: "template-layout",
        id: templateRow.id,
        versionKey: templateRow.version_key,
        sourceSha256: templateRow.source_sha256,
      }),
    },
    ...sectionResult.rows
      .filter((row) => row.status === "approved")
      .map((row) => ({
        sourceKind: "assessment_structured_section",
        sourceId: row.id,
        locator: row.field_key,
        sha256: hashValue({
          fixture: fixture.fixture_id,
          kind: "approved-section",
          id: row.id,
          fieldKey: row.field_key,
          payload: row.payload,
        }),
      })),
    ...reviewEventResult.rows.map((row) => ({
      sourceKind: "assessment_review_event",
      sourceId: row.id,
      locator: row.action,
      sha256: hashValue({
        fixture: fixture.fixture_id,
        kind: "review-event",
        id: row.id,
        action: row.action,
      }),
    })),
  ];

  return {
    organizationId: documentRow.organization_id,
    clientId: documentRow.client_id,
    assessmentDocumentId: documentRow.id,
    templateType: documentRow.template_type,
    documentState: documentRow.status,
    scopeVerdict: "in_scope",
    reviewReadModel: {
      loaded: true,
      unresolvedRequiredCount: missingChecklist.length + missingSections.length,
      missingRequiredEvidence: [...missingChecklist, ...missingSections],
      evidence,
    },
    ownerAuthorization: {
      ownerId,
      authorized: ownerAuthorized,
      reasonCode: ownerId
        ? ownerAuthorized
          ? null
          : "owner_not_authorized"
        : "missing_owner",
    },
  };
};

const normalizeEvidencePointers = (evidence) => {
  return evidence
    .map((pointer) => ({
      sourceKind: pointer.sourceKind,
      sourceId: pointer.sourceId,
      locator: pointer.locator ?? null,
      sha256: pointer.sha256,
    }))
    .sort((left, right) =>
      stableStringify(left).localeCompare(stableStringify(right))
    );
};

const expectedStateFromFixture = (fixture, snapshot) => {
  const evidencePointers = normalizeEvidencePointers([
    ...snapshot.reviewReadModel.evidence,
    ...snapshot.reviewReadModel.missingRequiredEvidence,
  ]);
  return {
    scopeSignature: hashValue({
      organizationId: snapshot.organizationId,
      clientId: snapshot.clientId,
      assessmentDocumentId: snapshot.assessmentDocumentId,
    }),
    workItemStatus: fixture.expectedWorkItemStatus,
    blockerCodes: [...fixture.expectedBlockerCodes].sort(),
    evidencePointers,
    evidencePointerCount: evidencePointers.length,
    readinessHash: fixture.expectedReadinessHash,
  };
};

const projectedStateFromShadow = (shadow) => {
  const evidencePointers = normalizeEvidencePointers(shadow.projection.evidence);
  assert(
    evidencePointers.every((pointer) =>
      ALLOWED_LEDGER_EVIDENCE_KINDS.has(pointer.sourceKind)
    ),
    "Projection emitted an unsupported evidence source kind.",
  );
  return {
    scopeSignature: hashValue({
      organizationId: shadow.projection.organizationId,
      clientId: shadow.projection.clientId,
      assessmentDocumentId: shadow.projection.assessmentDocumentId,
    }),
    workItemStatus: shadow.workItemStatus,
    blockerCodes: [...shadow.projection.blockerCodes].sort(),
    stepStatuses: shadow.stepTransitions.map((step) => ({
      key: step.stepKey,
      status: step.targetStatus,
      reasonCode: step.reasonCode,
    })),
    evidencePointers,
    evidencePointerCount: evidencePointers.length,
    readinessHash: shadow.projection.readinessHash,
  };
};

const verifySupportedLedgerSkeleton = async (client, fixture) => {
  const { rows: workItemRows } = await client.query(
    `
      select public.create_agent_assessment_work_item($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text) as id
    `,
    [
      FIXTURE_SCOPE.fallbackUserId,
      FIXTURE_SCOPE.organizationId,
      FIXTURE_SCOPE.clientId,
      fixture.documentId,
      WORKFLOW_VERSION,
      `shadow-parity:${fixture.fixture_id}`,
    ],
  );
  const workItemId = workItemRows[0]?.id;
  assert(workItemId, `Work item creation failed for ${fixture.fixture_id}.`);

  const { rows: scopeRows } = await client.query(
    `
      select item.organization_id, item.client_id, item.status, link.assessment_document_id
      from public.agent_work_items item
      join public.agent_work_assessment_links link on link.work_item_id = item.id
      where item.id = $1::uuid
    `,
    [workItemId],
  );
  const scope = scopeRows[0];
  assert(scope, `Work item scope missing for ${fixture.fixture_id}.`);
  assert(
    scope.organization_id === FIXTURE_SCOPE.organizationId &&
      scope.client_id === FIXTURE_SCOPE.clientId &&
      scope.assessment_document_id === fixture.documentId &&
      scope.status === "queued",
    `Work item scope drifted for ${fixture.fixture_id}.`,
  );

  if (fixture.approvalMode === "expired") {
    const { rows: stepRows } = await client.query(
      `
        select id
        from public.agent_work_steps
        where work_item_id = $1::uuid
          and step_key = 'request_clinical_review'
      `,
      [workItemId],
    );
    const stepId = stepRows[0]?.id;
    assert(stepId, "Stale approval fixture is missing its review step.");

    const { rows: approvalRows } = await client.query(
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
        )
        values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          'bcba',
          'expired',
          $5::text,
          $6::text,
          $7::uuid,
          'shadow-parity-expired',
          timezone('utc', now()) - interval '2 minutes',
          timezone('utc', now()) - interval '1 minute'
        )
        returning id
      `,
      [
        workItemId,
        stepId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
        hashValue({ fixture: fixture.fixture_id, kind: "input" }),
        hashValue({ fixture: fixture.fixture_id, kind: "evidence" }),
        FIXTURE_SCOPE.ownerUserId,
      ],
    );
    const approvalId = approvalRows[0]?.id;
    assert(approvalId, "Stale approval fixture was not stored.");
    const { rows: rereadRows } = await client.query(
      `
        select status, expires_at < timezone('utc', now()) as is_stale
        from public.agent_work_approvals
        where id = $1::uuid
          and work_item_id = $2::uuid
          and organization_id = $3::uuid
          and client_id = $4::uuid
      `,
      [
        approvalId,
        workItemId,
        FIXTURE_SCOPE.organizationId,
        FIXTURE_SCOPE.clientId,
      ],
    );
    assert(
      rereadRows[0]?.status === "expired" && rereadRows[0]?.is_stale === true,
      "Stale approval fixture did not remain expired after reread.",
    );
  }
};

const verifyStructuredSectionHashDrift = async (
  client,
  bridgePath,
  fixture,
  initialShadow,
) => {
  if (fixture.fixture_id !== "changed_structured_section") return;

  await client.query(
    `
      update public.assessment_structured_sections
      set payload = payload || '{"shadow_parity_revision":"isolated-change"}'::jsonb
      where assessment_document_id = $1::uuid
    `,
    [fixture.documentId],
  );
  const changedSnapshot = await loadAuthoritativeSnapshot(client, fixture);
  const changedShadow = await deriveShadowProjection(bridgePath, changedSnapshot);
  assert(
    changedShadow.workItemStatus === initialShadow.workItemStatus &&
      stableStringify(changedShadow.projection.blockerCodes) ===
        stableStringify(initialShadow.projection.blockerCodes) &&
      changedShadow.projection.readinessHash !==
        initialShadow.projection.readinessHash,
    "An isolated structured-section change did not change only readiness evidence.",
  );
};

const calculateEvidenceCoverage = (expectedPointers, projectedPointers) => {
  if (expectedPointers.length === 0) {
    return projectedPointers.length === 0 ? 1 : 0;
  }
  const projectedKeys = new Set(projectedPointers.map(stableStringify));
  const matched = expectedPointers.filter((pointer) =>
    projectedKeys.has(stableStringify(pointer))
  ).length;
  return Number((matched / expectedPointers.length).toFixed(4));
};

const compareStates = (authoritativeState, projectedState) => {
  if (projectedState.scopeSignature !== authoritativeState.scopeSignature) {
    return "tenant_mismatch";
  }

  if (projectedState.workItemStatus === "completed") {
    return "false_complete";
  }

  if (
    authoritativeState.workItemStatus === "blocked" &&
    projectedState.workItemStatus === "needs_review"
  ) {
    return "false_ready";
  }

  if (
    stableStringify(projectedState.evidencePointers) !==
      stableStringify(authoritativeState.evidencePointers)
  ) {
    return "missing_evidence_pointer";
  }

  const authoritativeOrder = STATUS_ORDER.get(authoritativeState.workItemStatus) ?? -1;
  const projectedOrder = STATUS_ORDER.get(projectedState.workItemStatus) ?? -1;
  if (projectedOrder < authoritativeOrder) {
    return "state_regression";
  }

  if (
    authoritativeState.workItemStatus !== projectedState.workItemStatus ||
    stableStringify(authoritativeState.blockerCodes) !==
      stableStringify(projectedState.blockerCodes) ||
    projectedState.readinessHash !== authoritativeState.readinessHash
  ) {
    return "unexplained_projection_mismatch";
  }

  return null;
};

const toOutputState = (state) => ({
  work_item_status: state.workItemStatus,
  blocker_codes: state.blockerCodes,
  evidence_pointer_count: state.evidencePointerCount,
});

const runFixture = async (client, bridgePath, fixture) => {
  await client.query("begin");
  try {
    await seedGlobalScope(client);
    await insertFixtureRows(client, fixture);
    await verifySupportedLedgerSkeleton(client, fixture);
    const snapshot = await loadAuthoritativeSnapshot(client, fixture);
    const shadow = await deriveShadowProjection(bridgePath, snapshot);
    await verifyStructuredSectionHashDrift(client, bridgePath, fixture, shadow);
    const authoritativeState = expectedStateFromFixture(fixture, snapshot);
    const projectedState = projectedStateFromShadow(shadow);
    const evidenceCoverage = calculateEvidenceCoverage(
      authoritativeState.evidencePointers,
      projectedState.evidencePointers,
    );
    const mismatchReason = compareStates(authoritativeState, projectedState);

    const record = {
      fixture_id: fixture.fixture_id,
      projection_count: 1,
      mismatch_reason_code: mismatchReason,
      authoritative_state: toOutputState(authoritativeState),
      projected_state: toOutputState(projectedState),
      state_transition: `${snapshot.documentState}->${projectedState.workItemStatus}`,
      evidence_pointer_coverage_rate: evidenceCoverage,
      runtime_mode: OUTPUT_RUNTIME_MODE,
      workflow_version: WORKFLOW_VERSION,
      duration_ms: DURATION_MS,
    };

    sanitizeTopLevelKeys(record, FIXTURE_RECORD_KEYS, "fixture record");
    sanitizeSerializedOutput(JSON.stringify(record));
    if (mismatchReason) {
      throw new Error(`${fixture.fixture_id}:${mismatchReason}`);
    }

    await client.query("rollback");
    return { record, readinessHash: projectedState.readinessHash };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const assertNegativeProbe = (label, expectedCode, authoritativeState, projectedState) => {
  const actual = compareStates(authoritativeState, projectedState);
  if (actual !== expectedCode) {
    throw new Error(`${label} expected ${expectedCode}, found ${actual ?? "match"}`);
  }
};

const runNegativeProbes = () => {
  const evidencePointer = {
    sourceKind: "assessment_document",
    sourceId: FIXTURES[0].documentId,
    locator: null,
    sha256: hashValue({ fixture: "negative-probe" }),
  };
  const baseline = {
    scopeSignature: hashValue({
      organizationId: FIXTURE_SCOPE.organizationId,
      clientId: FIXTURE_SCOPE.clientId,
      assessmentDocumentId: FIXTURES[0].documentId,
    }),
    workItemStatus: "needs_review",
    blockerCodes: [],
    evidencePointers: [evidencePointer],
    evidencePointerCount: 1,
    readinessHash: hashValue({ fixture: "negative-probe-readiness" }),
  };

  assertNegativeProbe(
    "false ready probe",
    "false_ready",
    { ...baseline, workItemStatus: "blocked", blockerCodes: ["missing_owner"] },
    baseline,
  );
  assertNegativeProbe(
    "false complete probe",
    "false_complete",
    baseline,
    { ...baseline, workItemStatus: "completed" },
  );
  assertNegativeProbe(
    "tenant mismatch probe",
    "tenant_mismatch",
    baseline,
    {
      ...baseline,
      scopeSignature: hashValue({
        organizationId: FIXTURE_SCOPE.organizationId,
        clientId: FIXTURE_SCOPE.clientId,
        assessmentDocumentId: FIXTURES[1].documentId,
      }),
    },
  );
  assertNegativeProbe(
    "missing evidence probe",
    "missing_evidence_pointer",
    baseline,
    {
      ...baseline,
      evidencePointers: [{ ...evidencePointer, sha256: hashValue({ drift: true }) }],
    },
  );
  assertNegativeProbe(
    "duplicate evidence probe",
    "missing_evidence_pointer",
    baseline,
    { ...baseline, evidencePointers: [evidencePointer, evidencePointer] },
  );
  assertNegativeProbe(
    "state regression probe",
    "state_regression",
    baseline,
    { ...baseline, workItemStatus: "waiting" },
  );
  assertNegativeProbe(
    "unexplained mismatch probe",
    "unexplained_projection_mismatch",
    baseline,
    { ...baseline, blockerCodes: ["owner_not_authorized"], workItemStatus: "needs_review" },
  );

  const sanitizerProbe = {
    fixture_id: "sanitizer_probe",
    projection_count: 1,
    mismatch_reason_code: null,
    authoritative_state: { work_item_status: "blocked", blocker_codes: [], step_statuses: [] },
    projected_state: {
      work_item_status: "blocked",
      blocker_codes: [],
      step_statuses: [{ key: "x", status: "blocked", reasonCode: "shadow-owner@example.invalid" }],
    },
    state_transition: "queued->blocked",
    evidence_pointer_coverage_rate: 1,
    runtime_mode: OUTPUT_RUNTIME_MODE,
    workflow_version: WORKFLOW_VERSION,
    duration_ms: DURATION_MS,
  };
  try {
    sanitizeSerializedOutput(JSON.stringify(sanitizerProbe));
  } catch (error) {
    if (error instanceof Error && error.message === "sanitizer_violation") {
      return REQUIRED_NEGATIVE_CODES.length;
    }
    throw error;
  }
  throw new Error("sanitizer probe expected sanitizer_violation");
};

const main = async () => {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLoopbackHttpUrl(supabaseUrl, "SUPABASE_URL");
  assertLoopbackDatabaseUrl(databaseUrl, "SUPABASE_DB_URL");
  assertMatchesRunningLocalStack(supabaseUrl, databaseUrl);
  if (RUNTIME_MODE !== OUTPUT_RUNTIME_MODE) {
    throw new Error("AGENT_WORK_LEDGER_RUNTIME_MODE must be shadow for shadow parity.");
  }
  if (!new Set(["none", "bridge", "malformed_bridge", "database"]).has(TEST_FAULT)) {
    throw new Error("invalid_test_fault");
  }

  let bridge;
  let client;
  let connected = false;

  try {
    bridge = await createBridgeModule();
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    connected = true;
    if (TEST_FAULT === "database") {
      await client.query("select * from public.synthetic_missing_shadow_parity_table");
    }

    const outcomes = [];
    for (const fixture of FIXTURES) {
      outcomes.push(await runFixture(client, bridge.bridgePath, fixture));
    }
    const records = outcomes.map((outcome) => outcome.record);

    const negativeProbeCount = runNegativeProbes();

    for (const record of records) {
      console.log(JSON.stringify(record));
    }

    const summary = {
      fixture_count: records.length,
      matched_count: records.filter((record) => record.mismatch_reason_code === null).length,
      mismatch_count: records.filter((record) => record.mismatch_reason_code !== null).length,
      mismatch_rate: 0,
      coverage_full_count: records.filter((record) => record.evidence_pointer_coverage_rate === 1).length,
      coverage_full_rate: Number(
        (
          records.filter((record) => record.evidence_pointer_coverage_rate === 1).length /
          records.length
        ).toFixed(4),
      ),
      negative_probe_count: negativeProbeCount,
      negative_probe_pass_count: negativeProbeCount,
      negative_probe_pass_rate: 1,
    };
    summary.mismatch_rate = Number((summary.mismatch_count / summary.fixture_count).toFixed(4));

    sanitizeTopLevelKeys(summary, SUMMARY_KEYS, "summary");
    sanitizeSerializedOutput(JSON.stringify(summary));
    console.log(JSON.stringify(summary));
  } finally {
    if (connected && client) {
      await client.end().catch(() => undefined);
    }
    if (bridge) {
      await rm(bridge.runtimeDir, { recursive: true, force: true });
    }
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "internal_error";
  const reasonCode = new Set([
    "local_stack_status_unavailable",
    "local_stack_identity_mismatch",
    "adapter_bridge_failed",
    "sanitizer_violation",
  ]).has(message)
    ? message
    : message.includes("AGENT_WORK_LEDGER_RUNTIME_MODE")
    ? "runtime_mode_forbidden"
    : message.includes("loopback host")
    ? "non_local_url_forbidden"
    : "internal_error";
  console.error(JSON.stringify({ error: "shadow_parity_failed", reason_code: reasonCode }));
  process.exit(1);
});
