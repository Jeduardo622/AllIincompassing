import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const PLACEHOLDERS = new Set([
  "****",
  "<required>",
  "<secret>",
  "<set-me>",
  "changeme",
  "change-me",
  "placeholder",
  "redacted",
  "todo",
]);

const OUTPUT_DIR = path.join(process.cwd(), "artifacts", "latest", "readiness");
const JSON_PATH = path.join(OUTPUT_DIR, "playwright-env-readiness.json");
const MARKDOWN_PATH = path.join(OUTPUT_DIR, "playwright-env-readiness.md");

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

const isPlaceholder = (value) => {
  const normalized = normalize(value).toLowerCase();
  return PLACEHOLDERS.has(normalized) || /^<.+>$/.test(normalized);
};

const inspectEnv = (name) => {
  const value = normalize(process.env[name]);
  if (!value) {
    return { name, status: "missing" };
  }
  if (isPlaceholder(value)) {
    return { name, status: "placeholder" };
  }
  return { name, status: "configured" };
};

const worstStatus = (statuses) => {
  if (statuses.includes("placeholder")) return "placeholder";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("not_validated")) return "not_validated";
  return "configured";
};

const allConfigured = (vars) => vars.every((item) => item.status === "configured");

const anyPlaceholder = (vars) => vars.some((item) => item.status === "placeholder");

const group = ({ id, label, required, variables, note }) => {
  const inspected = variables.map(inspectEnv);
  return {
    id,
    label,
    required,
    status: worstStatus(inspected.map((item) => item.status)),
    variables: inspected,
    note,
  };
};

const anyPairGroup = ({ id, label, required, pairs, note }) => {
  const inspectedPairs = pairs.map((pair) => ({
    label: pair.label,
    variables: pair.variables.map(inspectEnv),
  }));
  const configuredPair = inspectedPairs.find((pair) => allConfigured(pair.variables));
  const hasPlaceholder = inspectedPairs.some((pair) => anyPlaceholder(pair.variables));
  const status = configuredPair ? "configured" : hasPlaceholder ? "placeholder" : "missing";
  return {
    id,
    label,
    required,
    status,
    selectedPair: configuredPair?.label ?? null,
    pairs: inspectedPairs,
    note,
  };
};

const uuidGroup = ({ id, label, required, variables, note }) => {
  const inspected = variables.map(inspectEnv);
  let status = worstStatus(inspected.map((item) => item.status));
  if (status === "configured") {
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const values = variables.map((name) => normalize(process.env[name]));
    if (!values.every((value) => uuidLike.test(value)) || new Set(values).size !== values.length) {
      status = "not_validated";
    }
  }
  return { id, label, required, status, variables: inspected, note };
};

const fileBackedGroup = ({ id, label, required, variables, fileVariable, note }) => {
  const inspected = variables.map(inspectEnv);
  let status = worstStatus(inspected.map((item) => item.status));
  const filePath = normalize(process.env[fileVariable]);
  if (status === "configured" && filePath && !existsSync(path.resolve(process.cwd(), filePath))) {
    status = "not_validated";
  }
  return {
    id,
    label,
    required,
    status,
    variables: inspected,
    note,
  };
};

const clinicalQaContractGroup = () => {
  const variables = [
    "PW_CLINICAL_QA_TARGET_MARKER",
    "PW_CLINICAL_QA_CLIENT_ID",
    "PW_CLINICAL_QA_ROUTE",
    "PW_CLINICAL_QA_SOURCE_FILE",
    "PW_CLINICAL_QA_EXPECTATIONS_FILE",
    "PW_CLINICAL_QA_VISUAL_RUBRIC_FILE",
    "PW_CLINICAL_QA_OUTPUT_FILE",
    "PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR",
  ];
  const inspected = variables.map(inspectEnv);
  const byName = new Map(inspected.map((item) => [item.name, item]));
  const markerValue = normalize(process.env.PW_CLINICAL_QA_TARGET_MARKER).toLowerCase();
  if (/^(redacted|synthetic|smoke|test)$/.test(markerValue)) {
    byName.set("PW_CLINICAL_QA_TARGET_MARKER", {
      name: "PW_CLINICAL_QA_TARGET_MARKER",
      status: "configured",
    });
  }
  const marker = byName.get("PW_CLINICAL_QA_TARGET_MARKER");
  const sourceOrExpectations = [
    byName.get("PW_CLINICAL_QA_SOURCE_FILE"),
    byName.get("PW_CLINICAL_QA_EXPECTATIONS_FILE"),
  ];
  const routeOrClient = [
    byName.get("PW_CLINICAL_QA_CLIENT_ID"),
    byName.get("PW_CLINICAL_QA_ROUTE"),
  ];
  const outputOrSelector = [
    byName.get("PW_CLINICAL_QA_OUTPUT_FILE"),
    byName.get("PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR"),
  ];
  const statuses = [
    marker?.status,
    sourceOrExpectations.some((item) => item?.status === "configured") ? "configured" : worstStatus(sourceOrExpectations.map((item) => item?.status ?? "missing")),
    routeOrClient.some((item) => item?.status === "configured") ? "configured" : worstStatus(routeOrClient.map((item) => item?.status ?? "missing")),
    outputOrSelector.some((item) => item?.status === "configured") ? "configured" : worstStatus(outputOrSelector.map((item) => item?.status ?? "missing")),
  ];
  let status = worstStatus(statuses);
  for (const fileVariable of ["PW_CLINICAL_QA_SOURCE_FILE", "PW_CLINICAL_QA_EXPECTATIONS_FILE", "PW_CLINICAL_QA_VISUAL_RUBRIC_FILE", "PW_CLINICAL_QA_OUTPUT_FILE"]) {
    const filePath = normalize(process.env[fileVariable]);
    if (status === "configured" && filePath && !existsSync(path.resolve(process.cwd(), filePath))) {
      status = "not_validated";
    }
  }
  return {
    id: "clinical_qa_artifacts",
    label: "Clinical QA smoke target/source/output contract",
    required: false,
    status,
    variables: inspected,
    note: "Requires a smoke target marker, client ID or route, source file or expectations file, and output file or generated-output selector.",
  };
};

const groups = [
  group({
    id: "browser_target",
    label: "Browser target",
    required: true,
    variables: ["PW_BASE_URL"],
    note: "Target URL only; the value is never written to the report.",
  }),
  anyPairGroup({
    id: "admin_or_superadmin_lifecycle",
    label: "Admin or dynamic super-admin lifecycle",
    required: false,
    pairs: [
      { label: "preconfigured admin", variables: ["PW_ADMIN_EMAIL", "PW_ADMIN_PASSWORD"] },
      { label: "legacy admin aliases", variables: ["PLAYWRIGHT_ADMIN_EMAIL", "PLAYWRIGHT_ADMIN_PASSWORD"] },
      { label: "dynamic super-admin", variables: ["PW_SUPERADMIN_EMAIL", "PW_SUPERADMIN_PASSWORD"] },
    ],
    note: "CI can provision PW_SUPERADMIN_* later; this report only classifies whether a pair is already present.",
  }),
  group({
    id: "synthetic_therapist_provisioning",
    label: "Run-owned therapist provisioning",
    required: true,
    variables: ["CI_SMOKE_THERAPIST_SCOPE_EMAIL", "SUPABASE_PUBLISHABLE_KEY"],
    note: "The scope identity is read-only; CI provisions and authenticates a dedicated therapist before browser tests.",
  }),
  anyPairGroup({
    id: "schedule_persona_or_admin_fallback",
    label: "Schedule persona or admin fallback",
    required: true,
    pairs: [
      { label: "schedule persona", variables: ["PW_SCHEDULE_EMAIL", "PW_SCHEDULE_PASSWORD"] },
      { label: "admin fallback", variables: ["PW_ADMIN_EMAIL", "PW_ADMIN_PASSWORD"] },
      { label: "legacy admin fallback", variables: ["PLAYWRIGHT_ADMIN_EMAIL", "PLAYWRIGHT_ADMIN_PASSWORD"] },
    ],
    note: "A schedule-specific persona is preferred; an admin fallback is explicit and acceptable.",
  }),
  uuidGroup({
    id: "foreign_access_ids",
    label: "Foreign client and therapist IDs",
    required: true,
    variables: ["PW_FOREIGN_CLIENT_ID", "PW_FOREIGN_THERAPIST_ID"],
    note: "IDs must be distinct UUIDs. This does not validate hosted row accessibility.",
  }),
  anyPairGroup({
    id: "supabase_runtime",
    label: "Supabase runtime keys",
    required: true,
    pairs: [
      { label: "Vite anon key", variables: ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] },
      { label: "legacy anon key", variables: ["VITE_SUPABASE_URL", "SUPABASE_ANON_KEY"] },
    ],
    note: "Publishable/anon key presence only; no key material is emitted.",
  }),
  group({
    id: "supabase_service_role",
    label: "Supabase service-role access",
    required: true,
    variables: ["SUPABASE_SERVICE_ROLE_KEY"],
    note: "Needed by session and fixture-backed smoke flows. This report does not exercise it.",
  }),
  fileBackedGroup({
    id: "assessment_smoke_client",
    label: "Assessment smoke client and fixture",
    required: true,
    variables: ["PW_ASSESSMENT_CLIENT_ID", "PW_ASSESSMENT_SAMPLE_FILE"],
    fileVariable: "PW_ASSESSMENT_SAMPLE_FILE",
    note: "The fixture path should point to a checked-in redacted/synthetic/smoke/test sample.",
  }),
  anyPairGroup({
    id: "clinical_qa_persona",
    label: "Dedicated clinical QA persona",
    required: false,
    pairs: [
      { label: "dedicated clinical QA", variables: ["PW_CLINICAL_QA_EMAIL", "PW_CLINICAL_QA_PASSWORD"] },
      { label: "admin fallback", variables: ["PW_ADMIN_EMAIL", "PW_ADMIN_PASSWORD"] },
      { label: "legacy admin fallback", variables: ["PLAYWRIGHT_ADMIN_EMAIL", "PLAYWRIGHT_ADMIN_PASSWORD"] },
    ],
    note: "Dedicated PW_CLINICAL_QA_* is preferred for staff upload/output parity reruns.",
  }),
  clinicalQaContractGroup(),
];

const requiredGroups = groups.filter((item) => item.required);
const blockingGroups = requiredGroups.filter((item) => item.status !== "configured");
const result = blockingGroups.length === 0 ? "pass" : "fail";

const report = {
  report: "playwright-env-readiness",
  generatedAt: new Date().toISOString(),
  result,
  statuses: ["configured", "missing", "placeholder", "not_validated"],
  groups,
  blockingGroups: blockingGroups.map((item) => ({
    id: item.id,
    status: item.status,
  })),
};

const markdownLines = [
  "# Playwright Environment Readiness",
  "",
  `- result: \`${result}\``,
  `- generatedAt: \`${report.generatedAt}\``,
  "",
  "| Group | Required | Status | Notes |",
  "|---|---:|---|---|",
  ...groups.map((item) => (
    `| ${item.label} | ${item.required ? "yes" : "no"} | \`${item.status}\` | ${item.note ?? ""} |`
  )),
  "",
  "No secret values are written to this artifact.",
  "",
];

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(MARKDOWN_PATH, `${markdownLines.join("\n")}`, "utf8");

console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${MARKDOWN_PATH}`);
console.log(`Playwright environment readiness result: ${result}`);

if (process.argv.includes("--fail-on-blocking") && result !== "pass") {
  process.exitCode = 1;
}
