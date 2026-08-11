import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260811190901_payroll_timekeeping_foundation.sql",
);
const smokePath = path.join(
  process.cwd(),
  "tests",
  "sql",
  "payroll_timekeeping_foundation_smoke.sql",
);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

assert(existsSync(migrationPath), "Missing payroll foundation migration file.");
assert(existsSync(smokePath), "Missing payroll smoke SQL file.");

const sql = readFileSync(migrationPath, "utf8");
const smoke = readFileSync(smokePath, "utf8");

assert(
  /pg_advisory_xact_lock[\s\S]*record_employee_time_event/i.test(sql) &&
    /pg_advisory_xact_lock[\s\S]*record_session_attendance_event/i.test(sql),
  "Payroll mutation RPCs must use advisory locking.",
);
assert(
  /IDEMPOTENCY_CONFLICT/.test(sql) &&
    /payload_hash/.test(sql) &&
    /unique \(organization_id, actor_user_id, operation, idempotency_key\)/i.test(sql),
  "Payroll receipts must enforce scoped idempotency and conflict detection.",
);
assert(
  /enable row level security[\s\S]*force row level security/i.test(sql),
  "Payroll tables must enable and force RLS.",
);
assert(
  /revoke all on public\.employee_time_events from public, anon, authenticated/i.test(sql) &&
    /revoke all on public\.employee_time_events from service_role/i.test(sql),
  "Employee time events must revoke direct mutation paths.",
);
assert(
  /before update or delete on public\.employee_time_events/i.test(sql) &&
    /before update or delete on public\.session_attendance_events/i.test(sql) &&
    /before update or delete on public\.payroll_audit_events/i.test(sql),
  "Append-only triggers must protect event and audit tables.",
);
assert(
  /Monthly pay groups are inactive for payroll v1 nonexempt employees/i.test(sql) &&
    /supports_monthly_nonexempt/i.test(sql),
  "Monthly pay-group assignment must fail closed by policy.",
);
assert(
  /same-key-replay/.test(smoke),
  "Smoke SQL must include same-key replay coverage.",
);

if (!process.env.PAYROLL_LOCAL_DATABASE_URL) {
  console.error(
    "BLOCKED: local payroll smoke execution requires PAYROLL_LOCAL_DATABASE_URL for synthetic-only SQL replay checks.",
  );
  process.exit(1);
}

console.log("Static payroll security contract checks passed.");
