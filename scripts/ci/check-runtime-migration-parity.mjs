import {
  collectAddedMigrations,
  fetchAppliedMigrations,
  resolveMissingMigrations,
} from "./runtime-migration-parity.mjs";
import { pathToFileURL } from "node:url";

export const WIN_219_PAYROLL_MIGRATION_CONTRACT = [
  "20260811214856|payroll_timekeeping_capture_read_model",
  "20260812060529|payroll_timesheet_snapshots",
  "20260812103000|payroll_session_lifecycle_context",
  "20260812113000|payroll_session_lifecycle_context_disabled_state",
  "20260812122436|payroll_approval_workflow",
  "20260812141324|payroll_review_read_models",
  "20260812153628|payroll_administration",
  "20260812185531|payroll_approval_workflow_repair",
  "20260812212854|payroll_timesheet_period_contract_repair",
  "20260812230837|payroll_export_ledger",
  "20260813013000|payroll_approval_codex_review_fixes",
  "20260813103000|payroll_security_repair",
  "20260814172117|payroll_manager_assignment_advisor_remediation",
  "20260814183500|payroll_session_context_disabled_precedence",
  "20260814191200|payroll_session_context_enabled_authority_repair",
  "20260814205000|profile_insert_sync_bypass",
  "20260814213754|session_audit_created_by_typo_repair",
  "20260815002241|payroll_mutation_receipts_initplan",
  "20260815191838|payroll_mutation_receipts_actor_user_id_index",
  "20260816014726|payroll_employee_time_events_fk_indexes",
].join(",");

const baseSha = process.env.MIGRATION_PARITY_BASE_SHA ?? process.env.GITHUB_EVENT_BEFORE ?? "";
const headSha = process.env.MIGRATION_PARITY_HEAD_SHA ?? process.env.GITHUB_SHA ?? "HEAD";
const connectionString = process.env.SUPABASE_DB_URL ?? "";
const requiredContractText = process.env.MIGRATION_PARITY_REQUIRED_MIGRATIONS ?? "";
const activatePayrollTimesheets =
  String(process.env.ACTIVATE_PAYROLL_TIMESHEETS ?? "false").trim().toLowerCase() === "true";
const activatePayrollExport =
  String(process.env.ACTIVATE_PAYROLL_EXPORT ?? "false").trim().toLowerCase() === "true";
const activatePayrollApprovals =
  String(process.env.ACTIVATE_PAYROLL_APPROVALS ?? "false").trim().toLowerCase() === "true";
const activatePayrollAdministration =
  String(process.env.ACTIVATE_PAYROLL_ADMINISTRATION ?? "false").trim().toLowerCase() === "true";

const fail = (message) => {
  console.error(`❌ Runtime migration parity check failed: ${message}`);
  process.exit(1);
};

const parseRequiredContract = (text) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error(
      "WIN-219 payroll migration contract is required for manual payroll activation runtime parity.",
    );
  }

  const entries = trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, name, ...extra] = entry.split("|").map((part) => part.trim());
      if (extra.length > 0 || !/^\d+$/.test(version ?? "") || !name) {
        throw new Error(`Invalid WIN-219 payroll migration contract entry: ${entry}`);
      }
      return { version, name };
    });

  if (entries.length === 0) {
    throw new Error(
      "WIN-219 payroll migration contract is required for manual payroll activation runtime parity.",
    );
  }

  return entries;
};

const dedupeMigrations = (entries) => {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.version}::${entry.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const resolveRequiredRuntimeMigrations = ({
  baseSha,
  headSha,
  requiredContractText,
  activatePayrollTimesheets = false,
  activatePayrollExport = false,
  activatePayrollApprovals = false,
  activatePayrollAdministration = false,
}) => {
  const fromDiff = collectAddedMigrations({ baseSha, headSha });
  const requiresPayrollContract =
    activatePayrollTimesheets ||
    activatePayrollExport ||
    activatePayrollApprovals ||
    activatePayrollAdministration;

  if (!requiresPayrollContract) {
    return fromDiff;
  }

  const contractEntries = parseRequiredContract(requiredContractText);
  return dedupeMigrations([...contractEntries, ...fromDiff]);
};

const run = async () => {
  const required = resolveRequiredRuntimeMigrations({
    baseSha,
    headSha,
    requiredContractText,
    activatePayrollTimesheets,
    activatePayrollExport,
    activatePayrollApprovals,
    activatePayrollAdministration,
  });

  if (required.length === 0) {
    console.log("Runtime migration parity check passed (no newly added migrations in merge range).");
    return;
  }

  if (!connectionString.trim()) {
    fail("SUPABASE_DB_URL is required when newly added migrations are detected.");
  }

  const applied = await fetchAppliedMigrations({ connectionString });
  const missing = resolveMissingMigrations(required, applied);

  if (missing.length > 0) {
    const detail = missing.map((m) => `${m.version}/${m.name}`).join(", ");
    fail(
      `missing migration(s) in runtime DB: ${detail}; required from merge range (version or logical name must match schema_migrations).`,
    );
  }

  console.log(
    `Runtime migration parity check passed (${required.length} migration(s) verified in runtime DB by version or name).`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
