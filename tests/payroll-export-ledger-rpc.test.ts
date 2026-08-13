import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  employeeA: "10000000-0000-4000-8000-000000000011",
  employeeB: "10000000-0000-4000-8000-000000000012",
  schedulerA: "10000000-0000-4000-8000-000000000013",
  managerA: "10000000-0000-4000-8000-000000000014",
  adminA: "10000000-0000-4000-8000-000000000015",
  priorEmployeeA: "10000000-0000-4000-8000-000000000016",
  linkOnlyA: "10000000-0000-4000-8000-000000000017",
  employmentA: "10000000-0000-4000-8000-000000000041",
  employmentMissing: "10000000-0000-4000-8000-000000000045",
  payGroupA: "90000000-0000-4000-8000-000000000002",
  payPeriodA: "90000000-0000-4000-8000-000000000003",
  payPeriodB: "90000000-0000-4000-8000-000000000004",
} as const;

const databaseUrl = process.env.PAYROLL_LOCAL_DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const hasSafeLocalDatabase =
  (parsedDatabaseUrl?.protocol === "postgresql:" || parsedDatabaseUrl?.protocol === "postgres:") &&
  ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedDatabaseUrl.hostname) &&
  parsedDatabaseUrl.port === "54322" &&
  parsedDatabaseUrl.pathname === "/postgres" &&
  parsedDatabaseUrl.username === "postgres";
if (databaseUrl && !hasSafeLocalDatabase) {
  throw new Error("PAYROLL_LOCAL_DATABASE_URL must target the local loopback Supabase database.");
}

const smokePath = path.join(
  process.cwd(),
  "tests",
  "sql",
  "payroll_timekeeping_foundation_smoke.sql",
);
const providerNeutralFixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "payroll",
  "provider-neutral-v1.csv",
);
const providerNeutralHeader = readFileSync(providerNeutralFixturePath, "utf8")
  .split(/\r?\n/u)[0] ?? "";

const fixtureUserIds = [
  IDS.employeeA,
  IDS.employeeB,
  IDS.schedulerA,
  IDS.managerA,
  IDS.adminA,
  IDS.priorEmployeeA,
  IDS.linkOnlyA,
];
const fixtureOrgIds = [IDS.orgA, IDS.orgB];

const connect = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
};

const setRoleContext = async (
  client: Client,
  role: "authenticated" | "service_role",
  userId: string | null,
) => {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role, sub: userId }),
  ]);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
};

const withRole = async <T>(
  client: Client,
  role: "authenticated" | "service_role",
  userId: string | null,
  callback: () => Promise<T>,
  commit = false,
) => {
  await client.query("begin");
  try {
    await setRoleContext(client, role, userId);
    const result = await callback();
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const cleanup = async (client: Client) => {
  await client.query("rollback");
  await client.query("begin");
  try {
    await client.query("set local session_replication_role = replica");
    for (const table of [
      "payroll_export_rows",
      "payroll_export_runs",
      "payroll_blocker_resolutions",
      "timesheet_approvals",
      "timesheet_snapshot_lines",
      "timesheet_snapshot_current_heads",
      "timesheet_snapshots",
      "timesheet_meal_resolutions",
      "timekeeping_exceptions",
      "session_attendance_correction_requests",
      "time_correction_requests",
      "session_attendance_events",
      "employee_time_events",
      "payroll_capability_grants",
      "pay_periods",
      "pay_group_assignments",
      "pay_groups",
      "employee_rate_versions",
      "payroll_mutation_receipts",
      "payroll_audit_events",
      "payroll_organization_settings",
      "payroll_policy_versions",
      "organization_feature_flags",
      "employment_profiles",
      "sessions",
      "clients",
      "therapists",
    ]) {
      const relationExists = (
        await client.query("select to_regclass($1) is not null as present", [`public.${table}`])
      ).rows[0].present as boolean;
      if (!relationExists) continue;
      await client.query(`delete from public.${table} where organization_id = any($1::uuid[])`, [fixtureOrgIds]);
    }
    await client.query("delete from public.user_therapist_links where user_id = any($1::uuid[])", [fixtureUserIds]);
    await client.query("delete from public.employee_manager_assignments where organization_id = any($1::uuid[])", [fixtureOrgIds]);
    await client.query("delete from public.user_roles where user_id = any($1::uuid[])", [fixtureUserIds]);
    await client.query("delete from public.profiles where id = any($1::uuid[])", [fixtureUserIds]);
    await client.query("delete from auth.users where id = any($1::uuid[])", [fixtureUserIds]);
    await client.query("delete from public.organizations where id = any($1::uuid[])", [fixtureOrgIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const seedBase = async (client: Client) => {
  await cleanup(client);
  await client.query(readFileSync(smokePath, "utf8"));
  await client.query("begin");
  try {
    await client.query(
      `update public.organization_feature_flags
       set is_enabled = true
       where organization_id = $1::uuid
         and feature_flag_id = (
           select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
         )`,
      [IDS.orgA],
    );
    await client.query(
       `insert into public.payroll_capability_grants (
         organization_id, user_id, capability, effective_from, granted_by
       ) values
         ($1::uuid, $4::uuid, 'time.view_self', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $2::uuid, 'time.approve_assigned', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.lock_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.reopen_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.export_period', '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.managerA, IDS.adminA, IDS.employeeA],
    );
    await client.query(
      `insert into public.pay_groups (id, organization_id, name, cadence, timezone, effective_from)
       values ($1::uuid, $2::uuid, 'Weekly Payroll', 'weekly', 'America/Los_Angeles', '2026-08-01'::date)`,
      [IDS.payGroupA, IDS.orgA],
    );
    await client.query(
      `insert into public.pay_group_assignments (
         organization_id, employment_profile_id, pay_group_id, effective_from
       ) values ($1::uuid, $2::uuid, $3::uuid, '2026-08-11'::date)`,
      [IDS.orgA, IDS.employmentA, IDS.payGroupA],
    );
    await client.query(
      `insert into public.pay_periods (
         id, organization_id, pay_group_id, starts_on, ends_on
       ) values ($1::uuid, $2::uuid, $3::uuid, '2026-08-11'::date, '2026-08-17'::date)`,
      [IDS.payPeriodA, IDS.orgA, IDS.payGroupA],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const insertTimeEvent = async (
  client: Client,
  eventType: "shift_started" | "shift_ended",
  eventAt: string,
) => {
  return (
    await client.query(
    `insert into public.employee_time_events (
       organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location
     ) values ($1::uuid, $2::uuid, $3::public.payroll_event_type, $4::timestamptz, $5::uuid, 'America/Los_Angeles', 'office')
     returning id`,
    [IDS.orgA, IDS.employmentA, eventType, eventAt, IDS.employeeA],
    )
  ).rows[0].id as string;
};

const insertWorkedShift = async (client: Client, shiftStartedAt: string, shiftEndedAt: string) => {
  await insertTimeEvent(client, "shift_started", shiftStartedAt);
  await insertTimeEvent(client, "shift_ended", shiftEndedAt);
};

const deriveSnapshot = async (client: Client, idempotencyKey: string, userId = IDS.employeeA) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.derive_timesheet_snapshot($1::date, $2::text) as result",
          ["2026-08-13", idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const readSnapshotHash = async (client: Client, snapshotId: string) =>
  (
    await client.query(
      `select canonical_snapshot_hash
       from public.timesheet_snapshots
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, snapshotId],
    )
  ).rows[0].canonical_snapshot_hash as string;

const transitionApproval = async (
  client: Client,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  userId: string,
) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.transition_timesheet_approval($1::jsonb, $2::text) as result",
          [JSON.stringify(payload), idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const createPayrollExport = async (
  client: Client,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  userId: string,
) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.create_payroll_export($1::jsonb, $2::text) as result",
          [JSON.stringify(payload), idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const getPayrollExport = async (client: Client, exportRunId: string, userId: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query("select public.get_payroll_export($1::uuid) as result", [exportRunId])
      ).rows[0].result,
  );

const getAdministration = async (client: Client, userId: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query("select public.get_payroll_administration($1::date) as result", ["2026-08-13"])
      ).rows[0].result,
  );

const getTimesheetPeriod = async (client: Client, userId: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query("select public.get_payroll_timesheet_period($1::date) as result", ["2026-08-13"])
      ).rows[0].result,
  );

const readPersistedCsv = async (client: Client, exportRunId: string) =>
  (
    await client.query(
      `with run_row as (
         select *
         from public.payroll_export_runs
         where organization_id = $1::uuid
           and id = $2::uuid
       )
       select
         $3::text
         || E'\r\n'
         || coalesce(
              string_agg(
                app.payroll_csv_escape(row_row.schema_version)
                || ',' || app.payroll_csv_escape(run_row.id::text)
                || ',' || app.payroll_csv_escape(coalesce(row_row.adjusts_export_run_id::text, ''))
                || ',' || app.payroll_csv_escape(row_row.organization_payroll_id)
                || ',' || app.payroll_csv_escape(row_row.employee_payroll_id)
                || ',' || app.payroll_csv_escape(row_row.pay_group_id::text)
                || ',' || app.payroll_csv_escape(row_row.period_start::text)
                || ',' || app.payroll_csv_escape(row_row.period_end::text)
                || ',' || app.payroll_csv_escape(row_row.work_date::text)
                || ',' || app.payroll_csv_escape(row_row.earning_code)
                || ',' || app.payroll_csv_escape(app.payroll_export_hours_text(row_row.seconds))
                || ',' || app.payroll_csv_escape(app.payroll_export_money_text(row_row.base_rate_cents))
                || ',' || app.payroll_csv_escape(
                  case
                    when row_row.applied_rate_denominator = 0 then '0.00'
                    else to_char(
                      (row_row.applied_rate_numerator::numeric / row_row.applied_rate_denominator::numeric),
                      'FM999999990.00'
                    )
                  end
                )
                || ',' || app.payroll_csv_escape(app.payroll_export_money_text(row_row.gross_cents))
                || ',' || app.payroll_csv_escape(row_row.correction_indicator)
                || ',' || app.payroll_csv_escape(row_row.snapshot_version::text)
                || ',' || app.payroll_csv_escape(row_row.snapshot_hash),
                E'\r\n'
                order by row_row.export_position
              ),
              ''
            )
         || E'\r\n' as csv_text
       from run_row
       left join public.payroll_export_rows row_row
         on row_row.organization_id = run_row.organization_id
        and row_row.export_run_id = run_row.id
       group by run_row.id`,
      [IDS.orgA, exportRunId, providerNeutralHeader],
    )
  ).rows[0].csv_text as string;

const readExportRows = async (client: Client, exportRunId: string) =>
  (
    await client.query(
      `select
         export_position,
         work_date::text as work_date,
         earning_code,
         seconds,
         base_rate_cents,
         applied_rate_numerator,
         applied_rate_denominator,
         gross_cents,
         correction_indicator,
         adjusts_export_run_id::text as adjusts_export_run_id
       from public.payroll_export_rows
       where organization_id = $1::uuid
         and export_run_id = $2::uuid
       order by export_position`,
      [IDS.orgA, exportRunId],
    )
  ).rows;

const insertMidPeriodRateChange = async (client: Client) => {
  await client.query(
    `update public.employee_rate_versions
     set effective_through = $3::timestamptz
     where organization_id = $1::uuid
       and employment_profile_id = $2::uuid
       and effective_through is null`,
    [IDS.orgA, IDS.employmentA, "2026-08-12T00:00:00Z"],
  );
  await client.query(
    `insert into public.employee_rate_versions (
       organization_id,
       employment_profile_id,
       hourly_rate_cents,
       effective_from,
       created_by
     ) values ($1::uuid, $2::uuid, 3000, $3::timestamptz, $4::uuid)`,
    [IDS.orgA, IDS.employmentA, "2026-08-12T00:00:00Z", IDS.adminA],
  );
};

const addAssignedActiveEmploymentWithoutSnapshot = async (client: Client) => {
  await client.query(
    `insert into public.employment_profiles (
       id, organization_id, user_id, employee_number, payroll_employee_id,
       classification, home_jurisdiction, timezone, active_from, active_through, therapist_id
     ) values (
       $1::uuid, $2::uuid, $3::uuid, 'SYN-A-MISSING', 'PAY-A-MISSING',
       'nonexempt', 'CA', 'America/Los_Angeles', '2026-08-01'::date, null, null
     )`,
    [IDS.employmentMissing, IDS.orgA, IDS.linkOnlyA],
  );
  await client.query(
    `insert into public.pay_group_assignments (
       organization_id, employment_profile_id, pay_group_id, effective_from
     ) values ($1::uuid, $2::uuid, $3::uuid, '2026-08-11'::date)`,
    [IDS.orgA, IDS.employmentMissing, IDS.payGroupA],
  );
  await client.query(
    `insert into public.employee_rate_versions (
       organization_id, employment_profile_id, hourly_rate_cents, effective_from, created_by
     ) values ($1::uuid, $2::uuid, 1800, '2026-08-01T00:00:00Z', $3::uuid)`,
    [IDS.orgA, IDS.employmentMissing, IDS.adminA],
  );
};

const addUnresolvedBlocker = async (client: Client) => {
  const originalEventId = await insertTimeEvent(client, "shift_started", "2026-08-11T15:59:00Z");
  await client.query(
    `insert into public.time_correction_requests (
       organization_id,
       employment_profile_id,
       original_event_id,
       requested_by,
       reason_code,
       replacement_payload
     ) values (
       $1::uuid,
       $2::uuid,
       $3::uuid,
       $4::uuid,
       'missed_clock',
       '{}'::jsonb
     )`,
    [IDS.orgA, IDS.employmentA, originalEventId, IDS.employeeA],
  );
};

const seedExportReadySnapshotWithTwoDatesAndRateChange = async (client: Client, idempotencyKeyPrefix: string) => {
  await insertWorkedShift(client, "2026-08-11T16:00:00Z", "2026-08-11T20:00:00Z");
  await insertMidPeriodRateChange(client);
  await insertWorkedShift(client, "2026-08-12T16:00:00Z", "2026-08-12T21:00:00Z");
  return seedLockedSnapshot(client, idempotencyKeyPrefix);
};

const seedLockedSnapshot = async (client: Client, idempotencyKeyPrefix: string) => {
  const snapshot = await deriveSnapshot(client, `${idempotencyKeyPrefix}-derive`);
  if (!snapshot?.snapshotId) {
    throw new Error(`Expected a derived snapshot, received ${JSON.stringify(snapshot)}`);
  }
  const snapshotHash = await readSnapshotHash(client, snapshot.snapshotId);
  await transitionApproval(
    client,
    {
      action: "submit",
      snapshotId: snapshot.snapshotId,
      snapshotHash,
      attestation: true,
    },
    `${idempotencyKeyPrefix}-submit`,
    IDS.employeeA,
  );
  await transitionApproval(
    client,
    {
      action: "manager_approve",
      snapshotId: snapshot.snapshotId,
      snapshotHash,
    },
    `${idempotencyKeyPrefix}-approve`,
    IDS.managerA,
  );
  await transitionApproval(
    client,
    {
      action: "lock",
      snapshotId: snapshot.snapshotId,
      snapshotHash,
    },
    `${idempotencyKeyPrefix}-lock`,
    IDS.adminA,
  );
  return { snapshotId: snapshot.snapshotId, snapshotHash };
};

describe.skipIf(!hasSafeLocalDatabase).sequential("payroll export ledger rpc runtime contract", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      await cleanup(admin);
    } finally {
      await admin.end();
    }
  });

  beforeEach(async () => {
    await seedBase(admin);
  });

  it("creates an immutable export run for a locked current snapshot set, returns the strict transport contract, persists exact emitted rows, and reuses the first exported_at timestamp on replay", async () => {
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "initial-export");

    const created = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-initial",
      IDS.adminA,
    );
    expect(created).toMatchObject({
      runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      replayed: false,
      payPeriodId: IDS.payPeriodA,
      adapterVersion: "provider-neutral-v1",
      checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      rowCount: expect.any(Number),
      totalRegularSeconds: 32400,
      totalOvertimeSeconds: 0,
      totalDoubleTimeSeconds: 0,
      totalMealPremiumCents: 0,
      totalGrossEarningsCents: 25000,
      sourceSnapshotCount: 1,
      adjustsRunId: null,
      createdAt: expect.any(String),
      exportedAt: expect.any(String),
      reconciliationStatus: "reconciled",
    });

    const payPeriodAfterFirst = (
      await admin.query(
        `select exported_at
         from public.pay_periods
         where organization_id = $1::uuid
           and id = $2::uuid`,
        [IDS.orgA, IDS.payPeriodA],
      )
    ).rows[0].exported_at;
    expect(payPeriodAfterFirst).toBeTruthy();

    const persistedRows = await readExportRows(admin, created.runId);
    expect(persistedRows.map((row) => row.work_date)).toEqual(["2026-08-11", "2026-08-12"]);
    expect(persistedRows.map((row) => row.base_rate_cents)).toEqual([2500, 3000]);
    expect(persistedRows.every((row) => row.applied_rate_numerator === 1 && row.applied_rate_denominator === 1)).toBe(true);
    expect(persistedRows.every((row) => row.correction_indicator === "N")).toBe(true);

    const exportPayload = await getPayrollExport(admin, created.runId, IDS.adminA);
    expect(exportPayload).toMatchObject({
      runId: created.runId,
      payPeriodId: IDS.payPeriodA,
      adapterVersion: "provider-neutral-v1",
      periodStart: "2026-08-11",
      periodEnd: "2026-08-17",
      csv: expect.any(String),
    });
    expect(exportPayload.csv.split("\r\n")[0]).toBe(providerNeutralHeader);
    expect(exportPayload.csv).toContain(",2026-08-11,REG,4.000000,25.00,1.00,100.00,N,");
    expect(exportPayload.csv).toContain(",2026-08-12,REG,5.000000,30.00,1.00,150.00,N,");
    expect(exportPayload.csv.endsWith("\r\n")).toBe(true);
    expect(await readPersistedCsv(admin, created.runId)).toBe(exportPayload.csv);

    const replayed = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-replay",
      IDS.adminA,
    );
    expect(replayed).toMatchObject({
      replayed: true,
      runId: created.runId,
      checksumSha256: created.checksumSha256,
    });

    const payPeriodAfterReplay = (
      await admin.query(
        `select exported_at
         from public.pay_periods
         where organization_id = $1::uuid
           and id = $2::uuid`,
        [IDS.orgA, IDS.payPeriodA],
      )
    ).rows[0].exported_at;
    expect(payPeriodAfterReplay.toISOString()).toBe(payPeriodAfterFirst.toISOString());
  });

  it("returns csv only to payroll export actors and blocks lower-privilege readers", async () => {
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "download-export");
    const created = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-download",
      IDS.adminA,
    );

    const exportPayload = await getPayrollExport(admin, created.runId, IDS.adminA);
    expect(exportPayload).toMatchObject({
      runId: created.runId,
      payPeriodId: IDS.payPeriodA,
      adapterVersion: "provider-neutral-v1",
    });
    expect(exportPayload.csv).toContain("schema_version");
    expect(exportPayload.csv).not.toMatch(
      /session|client|patient|diagnosis|goal|note|authorization/i,
    );

    await expect(getPayrollExport(admin, created.runId, IDS.employeeA)).rejects.toThrow();
    await expect(getPayrollExport(admin, created.runId, IDS.managerA)).rejects.toThrow();
  });

  it("writes cumulative delta-only adjustments against the immediately prior run and persists only emitted rows", async () => {
    const initial = await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "adjustment-base");
    const firstRun = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-base",
      IDS.adminA,
    );

    await transitionApproval(
      admin,
      {
        action: "reopen",
        snapshotId: initial.snapshotId,
        snapshotHash: initial.snapshotHash,
        reason: "Correction required",
      },
      "reopen-for-adjustment",
      IDS.adminA,
    );
    await insertWorkedShift(admin, "2026-08-12T21:00:00Z", "2026-08-12T22:00:00Z");
    await seedLockedSnapshot(admin, "adjustment-next");

    const adjusted = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-adjustment",
      IDS.adminA,
    );
    expect(adjusted).toMatchObject({
      replayed: false,
      adjustsRunId: firstRun.runId,
    });

    const adjustedPayload = await getPayrollExport(admin, adjusted.runId, IDS.adminA);
    const adjustedLines = adjustedPayload.csv.trim().split("\r\n");
    expect(adjustedLines).toHaveLength(2);
    expect(adjustedPayload.csv).toContain(firstRun.runId);
    expect(adjustedPayload.csv).toContain(",2026-08-12,REG,1.000000,30.00,1.00,30.00,Y,");
    expect(await readPersistedCsv(admin, adjusted.runId)).toBe(adjustedPayload.csv);

    await transitionApproval(
      admin,
      {
        action: "reopen",
        snapshotId: initial.snapshotId,
        snapshotHash: initial.snapshotHash,
        reason: "Second correction required",
      },
      "reopen-for-adjustment-2",
      IDS.adminA,
    );
    await insertWorkedShift(admin, "2026-08-12T22:00:00Z", "2026-08-12T23:00:00Z");
    await seedLockedSnapshot(admin, "adjustment-third");

    const thirdRun = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-adjustment-2",
      IDS.adminA,
    );
    expect(thirdRun).toMatchObject({
      replayed: false,
      adjustsRunId: adjusted.runId,
    });

    const thirdPayload = await getPayrollExport(admin, thirdRun.runId, IDS.adminA);
    const thirdLines = thirdPayload.csv.trim().split("\r\n");
    expect(thirdLines).toHaveLength(2);
    expect(thirdPayload.csv).toContain(adjusted.runId);
    expect(thirdPayload.csv).toContain(",2026-08-12,REG,1.000000,30.00,1.00,30.00,Y,");

    const administration = await getAdministration(admin, IDS.adminA);
    const exportedPeriod = administration.payPeriods.find(
      (period: { id: string }) => period.id === IDS.payPeriodA,
    );
    expect(exportedPeriod).toMatchObject({
      exportedAt: thirdRun.exportedAt,
      latestExport: {
        runId: thirdRun.runId,
        exportedAt: thirdRun.exportedAt,
        reconciliationStatus: "reconciled",
        adjustsRunId: adjusted.runId,
      },
    });

    const employeePeriod = await getTimesheetPeriod(admin, IDS.employeeA);
    expect(employeePeriod).toMatchObject({
      exportedAt: thirdRun.exportedAt,
      exportKind: "adjustment",
    });
  });

  it("rejects incomplete locked populations, unresolved blockers, formula values, idempotency conflicts, bad adapter versions, unknown fields, and cross-tenant access", async () => {
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "guardrails-population");
    await addAssignedActiveEmploymentWithoutSnapshot(admin);
    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
        "create-payroll-export-incomplete-population",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await seedBase(admin);
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "guardrails-blockers");
    await addUnresolvedBlocker(admin);
    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
        "create-payroll-export-unresolved-blocker",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await seedBase(admin);
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "guardrails-formula");
    await admin.query(
      `update public.employment_profiles
       set payroll_employee_id = '=BAD'
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
        "create-payroll-export-formula",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await seedBase(admin);
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "guardrails-idempotency");
    const created = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-conflict",
      IDS.adminA,
    );
    expect(created.runId).toBeTruthy();

    await admin.query(
      `insert into public.pay_periods (
         id, organization_id, pay_group_id, starts_on, ends_on
       ) values ($1::uuid, $2::uuid, $3::uuid, '2026-08-18'::date, '2026-08-24'::date)`,
      [IDS.payPeriodB, IDS.orgA, IDS.payGroupA],
    );
    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodB, adapterVersion: "provider-neutral-v1" },
        "create-payroll-export-conflict",
        IDS.adminA,
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);

    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v2" },
        "create-payroll-export-bad-adapter",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1", unexpected: true },
        "create-payroll-export-unknown-field",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await expect(
      createPayrollExport(
        admin,
        { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
        "create-payroll-export-cross-tenant",
        IDS.employeeB,
      ),
    ).rejects.toThrow();
  });

  it("denies direct authenticated and service_role mutations on export ledger tables", async () => {
    await seedExportReadySnapshotWithTwoDatesAndRateChange(admin, "direct-mutation");
    const created = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-direct-mutation",
      IDS.adminA,
    );

    await expect(
      withRole(
        admin,
        "authenticated",
        IDS.adminA,
        async () =>
          admin.query(
            `insert into public.payroll_export_runs (
               organization_id,
               pay_period_id,
               pay_group_id,
               actor_user_id,
               canonical_hash,
               csv_sha256,
               csv_bytes,
               row_count,
               total_gross_cents
             ) values (
               $1::uuid,
               $2::uuid,
               $3::uuid,
               $4::uuid,
               repeat('a', 64),
               repeat('b', 64),
               convert_to('x', 'utf8'),
               1,
               1
             )`,
            [IDS.orgA, IDS.payPeriodA, IDS.payGroupA, IDS.adminA],
          ),
      ),
    ).rejects.toThrow();

    await expect(
      withRole(
        admin,
        "service_role",
        IDS.adminA,
        async () =>
          admin.query(
            `update public.payroll_export_runs
             set csv_sha256 = repeat('c', 64)
             where organization_id = $1::uuid
               and id = $2::uuid`,
            [IDS.orgA, created.runId],
          ),
      ),
    ).rejects.toThrow();
  });

  it("adds canExportPeriod to payroll administration capabilities while keeping canGeneratePeriods tied to configure authority", async () => {
    const administration = await getAdministration(admin, IDS.adminA);
    expect(administration.capabilities).toMatchObject({
      canConfigureEmployment: false,
      canGeneratePeriods: false,
      canExportPeriod: true,
    });
    expect(administration).toMatchObject({
      state: "ok",
      employments: expect.any(Array),
      payGroups: expect.any(Array),
      generationVersions: expect.any(Array),
      payPeriods: expect.any(Array),
      bounds: expect.any(Object),
    });
    expect(administration.policies[0]).toHaveProperty("mutationsReadOnlyInV1", true);

    await admin.query(
      `delete from public.payroll_capability_grants
       where organization_id = $1::uuid
         and user_id = $2::uuid
         and capability in ('payroll.lock_period', 'payroll.reopen_period')`,
      [IDS.orgA, IDS.adminA],
    );
    await expect(getAdministration(admin, IDS.adminA)).rejects.toThrow(
      /payroll administration capability is required/i,
    );
  });

  it("adds a top-level exportedAt to get_payroll_timesheet_period while preserving the nested period contract", async () => {
    await insertWorkedShift(admin, "2026-08-11T16:00:00Z", "2026-08-11T20:00:00Z");
    const beforeExport = await getTimesheetPeriod(admin, IDS.employeeA);
    expect(beforeExport.exportedAt).toBeNull();
    expect(beforeExport.exportKind).toBeNull();
    expect(beforeExport.period).toMatchObject({
      payPeriodId: IDS.payPeriodA,
      periodStart: "2026-08-11",
      periodEnd: "2026-08-17",
    });

    await seedLockedSnapshot(admin, "timesheet-exported-at");
    const created = await createPayrollExport(
      admin,
      { payPeriodId: IDS.payPeriodA, adapterVersion: "provider-neutral-v1" },
      "create-payroll-export-timesheet-period",
      IDS.adminA,
    );

    const afterExport = await getTimesheetPeriod(admin, IDS.employeeA);
    expect(afterExport.exportedAt).toBeTruthy();
    expect(afterExport.exportKind).toBe("initial");
    expect(new Date(afterExport.exportedAt).toISOString()).toBe(new Date(created.createdAt).toISOString());
    expect(afterExport.period).toMatchObject({
      payPeriodId: IDS.payPeriodA,
      periodStart: "2026-08-11",
      periodEnd: "2026-08-17",
    });
  });
});
