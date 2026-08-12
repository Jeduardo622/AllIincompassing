import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000011",
  userB: "10000000-0000-4000-8000-000000000012",
  schedulerA: "10000000-0000-4000-8000-000000000013",
  managerA: "10000000-0000-4000-8000-000000000014",
  adminA: "10000000-0000-4000-8000-000000000015",
  priorEmployeeA: "10000000-0000-4000-8000-000000000016",
  linkOnlyA: "10000000-0000-4000-8000-000000000017",
  employmentA: "10000000-0000-4000-8000-000000000041",
  employmentB: "10000000-0000-4000-8000-000000000042",
  priorEmploymentA: "10000000-0000-4000-8000-000000000043",
  policyA: "90000000-0000-4000-8000-000000000001",
  payGroupA: "90000000-0000-4000-8000-000000000002",
  payPeriodA: "90000000-0000-4000-8000-000000000003",
  shiftBPayGroup: "90000000-0000-4000-8000-000000000012",
  shiftBPayPeriod: "90000000-0000-4000-8000-000000000013",
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

const periodStart = "2026-08-11";
const periodEnd = "2026-08-17";
const selectedLocalDate = "2026-08-13";
const secondPeriodSelectedLocalDate = "2026-08-19";
const fixtureUserIds = [
  IDS.userA,
  IDS.userB,
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

const withRole = async <T>(
  client: Client,
  role: "authenticated" | "service_role",
  userId: string | null,
  callback: () => Promise<T>,
  commit = false,
) => {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, sub: userId }),
    ]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
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
      "timesheet_snapshot_lines",
      "timesheet_snapshot_current_heads",
      "timesheet_snapshots",
      "timesheet_meal_resolutions",
      "timekeeping_exceptions",
      "session_attendance_correction_requests",
      "time_correction_requests",
      "session_attendance_events",
      "employee_time_events",
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
      await client.query(`delete from public.${table} where organization_id = any($1::uuid[])`, [fixtureOrgIds]);
    }
    await client.query("delete from public.user_therapist_links where user_id = any($1::uuid[])", [[IDS.linkOnlyA]]);
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
      "delete from public.employee_rate_versions where organization_id = $1 and employment_profile_id = $2",
      [IDS.orgA, IDS.employmentA],
    );
    await client.query(
      `insert into public.employee_rate_versions (
         organization_id, employment_profile_id, hourly_rate_cents, effective_from, created_by
       ) values ($1::uuid, $2::uuid, 2000, '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.employmentA, IDS.userA],
    );
    await client.query(
      `insert into public.pay_groups (id, organization_id, name, cadence, timezone)
       values ($1::uuid, $2::uuid, 'Weekly Payroll', 'weekly', 'America/Los_Angeles')`,
      [IDS.payGroupA, IDS.orgA],
    );
    await client.query(
      `insert into public.pay_group_assignments (
         organization_id, employment_profile_id, pay_group_id, effective_from
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::date)`,
      [IDS.orgA, IDS.employmentA, IDS.payGroupA, periodStart],
    );
    await client.query(
      `insert into public.pay_periods (
         id, organization_id, pay_group_id, starts_on, ends_on
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date)`,
      [IDS.payPeriodA, IDS.orgA, IDS.payGroupA, periodStart, periodEnd],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const insertTimeEvent = async (
  client: Client,
  eventType: "shift_started" | "shift_ended" | "meal_started" | "meal_ended",
  eventAt: string,
  options: {
    organizationId?: string;
    employmentProfileId?: string;
    actorUserId?: string;
  } = {},
) => {
  const result = await client.query<{ id: string }>(
    `insert into public.employee_time_events (
       organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location
     ) values ($1::uuid, $2::uuid, $3::public.payroll_event_type, $4::timestamptz, $5::uuid, 'America/Los_Angeles', 'office')
     returning id`,
    [
      options.organizationId ?? IDS.orgA,
      options.employmentProfileId ?? IDS.employmentA,
      eventType,
      eventAt,
      options.actorUserId ?? IDS.userA,
    ],
  );
  return result.rows[0].id;
};

const insertTimeCorrection = async (client: Client, createdAt: string) => {
  const originalEvent = await client.query(
    `select id from public.employee_time_events
     where organization_id = $1::uuid and employment_profile_id = $2::uuid
     order by event_at asc, created_at asc, id asc
     limit 1`,
    [IDS.orgA, IDS.employmentA],
  );
  await client.query(
    `insert into public.time_correction_requests (
       organization_id, employment_profile_id, original_event_id, requested_by, reason_code, replacement_payload, created_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'missed_punch', '{}'::jsonb, $5::timestamptz)`,
    [IDS.orgA, IDS.employmentA, originalEvent.rows[0].id, IDS.userA, createdAt],
  );
};

const insertMealResolution = async (
  client: Client,
  params: {
    organizationId?: string;
    employmentProfileId?: string;
    payPeriodId?: string;
    shiftStartEventId: string;
    mealOrdinal: 1 | 2;
    deadlineAt: string;
    mealStartEventId?: string | null;
    mealEndEventId?: string | null;
    resolutionCode: "premium_owed" | "premium_not_owed" | "waived_first_meal" | "waived_second_meal";
    resolvedBy?: string;
    resolutionReason?: string | null;
  },
) => {
  const result = await client.query<{ id: string }>(
    `insert into public.timesheet_meal_resolutions (
       organization_id,
       employment_profile_id,
       pay_period_id,
       shift_start_event_id,
       meal_ordinal,
       deadline_at,
       meal_start_event_id,
       meal_end_event_id,
       resolution_code,
       resolved_by,
       resolution_reason
     ) values (
       $1::uuid,
       $2::uuid,
       $3::uuid,
       $4::uuid,
       $5::int,
       $6::timestamptz,
       $7::uuid,
       $8::uuid,
       $9::text,
       $10::uuid,
       $11::text
     )
     returning id`,
    [
      params.organizationId ?? IDS.orgA,
      params.employmentProfileId ?? IDS.employmentA,
      params.payPeriodId ?? IDS.payPeriodA,
      params.shiftStartEventId,
      params.mealOrdinal,
      params.deadlineAt,
      params.mealStartEventId ?? null,
      params.mealEndEventId ?? null,
      params.resolutionCode,
      params.resolvedBy ?? IDS.userA,
      params.resolutionReason ?? null,
    ],
  );
  return result.rows[0].id;
};

const setWorkweekStartsOn = async (client: Client, workweekStartsOn: number) => {
  await client.query(
    `update public.payroll_organization_settings
     set workweek_starts_on = $2::integer
     where organization_id = $1::uuid`,
    [IDS.orgA, workweekStartsOn],
  );
};

const insertRateVersion = async (
  client: Client,
  hourlyRateCents: number,
  effectiveFrom: string,
  effectiveThrough?: string | null,
) => {
  await client.query(
    `insert into public.employee_rate_versions (
       organization_id, employment_profile_id, hourly_rate_cents, effective_from, effective_through, created_by
     ) values ($1::uuid, $2::uuid, $3::integer, $4::timestamptz, $5::timestamptz, $6::uuid)`,
    [IDS.orgA, IDS.employmentA, hourlyRateCents, effectiveFrom, effectiveThrough ?? null, IDS.userA],
  );
};

const deriveSnapshot = async (
  client: Client,
  idempotencyKey: string,
  localDate = selectedLocalDate,
  userId = IDS.userA,
) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.derive_timesheet_snapshot($1::date, $2::text) as result",
          [localDate, idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const getTimesheetPeriod = async (
  client: Client,
  localDate = selectedLocalDate,
  userId = IDS.userA,
) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_timesheet_period($1::date) as result",
          [localDate],
        )
      ).rows[0].result,
  );

const snapshotCounts = async (client: Client) =>
  (
    await client.query(`
      select
        (select count(*)::int from public.timesheet_snapshots where organization_id = '${IDS.orgA}') as snapshots,
        (select count(*)::int from public.timesheet_snapshot_lines where organization_id = '${IDS.orgA}') as lines,
        (select count(*)::int from public.timesheet_snapshot_current_heads where organization_id = '${IDS.orgA}') as heads,
        (select count(*)::int from public.payroll_mutation_receipts where organization_id = '${IDS.orgA}' and operation = 'derive_timesheet_snapshot') as receipts,
        (select count(*)::int from public.payroll_audit_events where organization_id = '${IDS.orgA}' and operation = 'derive_timesheet_snapshot') as audits
    `)
  ).rows[0];

const expectBlockedAuditOnly = async (client: Client, before: Record<string, number>) => {
  expect(await snapshotCounts(client)).toEqual({
    snapshots: before.snapshots,
    lines: before.lines,
    heads: before.heads,
    receipts: before.receipts + 1,
    audits: before.audits + 1,
  });
};

const readSnapshot = async (client: Client, snapshotId: string) =>
  (
    await client.query(
      `select
         lockable,
         regular_seconds,
         overtime_seconds,
         double_time_seconds,
         meal_premium_cents,
         gross_earnings_cents,
         canonical_payload,
         source_high_water
       from public.timesheet_snapshots
       where organization_id = $1::uuid and id = $2::uuid`,
      [IDS.orgA, snapshotId],
    )
  ).rows[0];

const readSnapshotLines = async (client: Client, snapshotId: string) =>
  (
    await client.query(
      `select line_type, line_code, line_payload
       from public.timesheet_snapshot_lines
       where organization_id = $1::uuid and snapshot_id = $2::uuid
       order by line_type, line_code, id`,
      [IDS.orgA, snapshotId],
    )
  ).rows;

const readCurrentHead = async (client: Client) =>
  (
    await client.query(
      `select snapshot_id, prior_snapshot_id, source_hash
       from public.timesheet_snapshot_current_heads
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid
         and pay_period_id = $3::uuid
       order by created_at desc, id desc
       limit 1`,
      [IDS.orgA, IDS.employmentA, IDS.payPeriodA],
    )
  ).rows[0];

const seedSecondPayPeriod = async (client: Client) => {
  await client.query(
    `update public.pay_group_assignments
     set effective_through = $1::date
     where organization_id = $2::uuid
       and employment_profile_id = $3::uuid
       and pay_group_id = $4::uuid`,
    ["2026-08-17", IDS.orgA, IDS.employmentA, IDS.payGroupA],
  );
  await client.query(
    `insert into public.pay_groups (id, organization_id, name, cadence, timezone)
     values ($1::uuid, $2::uuid, 'Weekly Payroll B', 'weekly', 'America/Los_Angeles')`,
    [IDS.shiftBPayGroup, IDS.orgA],
  );
  await client.query(
    `insert into public.pay_group_assignments (
       organization_id, employment_profile_id, pay_group_id, effective_from
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::date)`,
    [IDS.orgA, IDS.employmentA, IDS.shiftBPayGroup, "2026-08-18"],
  );
  await client.query(
    `insert into public.pay_periods (
       id, organization_id, pay_group_id, starts_on, ends_on
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date)`,
    [IDS.shiftBPayPeriod, IDS.orgA, IDS.shiftBPayGroup, "2026-08-18", "2026-08-24"],
  );
};

const seedBiweeklyPayPeriod = async (client: Client) => {
  await client.query(
    `update public.pay_groups
     set cadence = 'biweekly'
     where organization_id = $1::uuid
       and id = $2::uuid`,
    [IDS.orgA, IDS.payGroupA],
  );
  await client.query(
    `update public.pay_periods
     set ends_on = $1::date
     where organization_id = $2::uuid
       and id = $3::uuid`,
    ["2026-08-24", IDS.orgA, IDS.payPeriodA],
  );
};

const expectBlockedResult = (result: unknown, code?: string) => {
  expect(result).toMatchObject({
    state: "blocked",
    snapshotId: null,
    lockable: false,
    ...(code
      ? { exceptions: [expect.objectContaining({ code, blocking: true })] }
      : {}),
  });
};

describe.skipIf(!hasSafeLocalDatabase)("payroll timesheet snapshot rpc runtime contract", () => {
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

  it("revokes direct execute on internal lock helpers for non-owner roles", async () => {
    const helperPrivileges = await admin.query(
      `
        select
          has_function_privilege('authenticated', 'app.payroll_timesheet_global_config_lock(boolean)', 'EXECUTE') as authenticated_global_config,
          has_function_privilege('service_role', 'app.payroll_timesheet_global_config_lock(boolean)', 'EXECUTE') as service_role_global_config,
          has_function_privilege('authenticated', 'app.payroll_timesheet_org_lock(uuid)', 'EXECUTE') as authenticated_org_lock,
          has_function_privilege('service_role', 'app.payroll_timesheet_org_lock(uuid)', 'EXECUTE') as service_role_org_lock,
          has_function_privilege('authenticated', 'app.payroll_timesheet_derivation_lock(uuid)', 'EXECUTE') as authenticated_derivation_lock,
          has_function_privilege('service_role', 'app.payroll_timesheet_derivation_lock(uuid)', 'EXECUTE') as service_role_derivation_lock,
          has_function_privilege('authenticated', 'app.payroll_timesheet_derivation_mutation_guard()', 'EXECUTE') as authenticated_mutation_guard,
          has_function_privilege('service_role', 'app.payroll_timesheet_derivation_mutation_guard()', 'EXECUTE') as service_role_mutation_guard,
          has_function_privilege('authenticated', 'app.payroll_timesheet_policy_mutation_guard()', 'EXECUTE') as authenticated_policy_guard,
          has_function_privilege('service_role', 'app.payroll_timesheet_policy_mutation_guard()', 'EXECUTE') as service_role_policy_guard,
          has_function_privilege('authenticated', 'app.payroll_timesheet_global_mutation_guard()', 'EXECUTE') as authenticated_global_guard,
          has_function_privilege('service_role', 'app.payroll_timesheet_global_mutation_guard()', 'EXECUTE') as service_role_global_guard
      `,
    );
    expect(Object.values(helperPrivileges.rows[0])).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("resolves the containing non-Sunday weekly and biweekly pay periods from selected_local_date and omits raw self hourly rates", async () => {
    await admin.query(
      `update public.employee_rate_versions
       set effective_through = '2026-08-14T00:00:00Z'
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    await insertRateVersion(admin, 2500, "2026-08-14T00:00:00Z");
    await admin.query(
      `insert into public.employee_rate_versions (
         organization_id, employment_profile_id, hourly_rate_cents, effective_from, created_by
       ) values ($1::uuid, $2::uuid, 9999, '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.priorEmploymentA, IDS.priorEmployeeA],
    );

    const weekly = await getTimesheetPeriod(admin, selectedLocalDate);
    expect(weekly).toMatchObject({
      state: "ok",
      period: expect.objectContaining({
        periodStart,
        periodEnd,
        payPeriodId: IDS.payPeriodA,
      }),
    });
    expect(weekly.period.rateVersions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), effectiveFrom: expect.any(String) }),
    ]));
    expect(JSON.stringify(weekly.period.rateVersions)).not.toContain("hourlyRateCents");
    expect(JSON.stringify(weekly.period.rateVersions)).not.toContain("9999");

    await seedBase(admin);
    await seedBiweeklyPayPeriod(admin);
    const biweekly = await getTimesheetPeriod(admin, secondPeriodSelectedLocalDate);
    expect(biweekly).toMatchObject({
      state: "ok",
      period: expect.objectContaining({
        periodStart,
        periodEnd: "2026-08-24",
        payPeriodId: IDS.payPeriodA,
      }),
    });
  });

  it("keeps raw immutable snapshot compensation private from self and assigned-review readers", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
    const result = await deriveSnapshot(admin, "derive-private-compensation");

    for (const userId of [IDS.userA, IDS.managerA]) {
      const raw = await withRole(admin, "authenticated", userId, async () => ({
        snapshots: Number((await admin.query(
          "select count(*)::int as count from public.timesheet_snapshots where id = $1::uuid",
          [result.snapshotId],
        )).rows[0].count),
        lines: Number((await admin.query(
          "select count(*)::int as count from public.timesheet_snapshot_lines where snapshot_id = $1::uuid",
          [result.snapshotId],
        )).rows[0].count),
      }));
      expect(raw).toEqual({ snapshots: 0, lines: 0 });
    }
  });

  it("rejects snapshot lineage that crosses employment or pay-period identity inside one organization", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
    const result = await deriveSnapshot(admin, "derive-lineage-invariants");

    await expect(admin.query(
      `insert into public.timesheet_snapshot_lines (
         organization_id, snapshot_id, employment_profile_id, pay_period_id, line_type, line_code, line_payload
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'summary', 'invalid', '{}'::jsonb)`,
      [IDS.orgA, result.snapshotId, IDS.priorEmploymentA, IDS.payPeriodA],
    )).rejects.toMatchObject({ code: "23503" });

    await expect(admin.query(
      `insert into public.timesheet_snapshot_current_heads (
         organization_id, employment_profile_id, pay_period_id, snapshot_id, source_hash, created_by
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid)`,
      [IDS.orgA, IDS.priorEmploymentA, IDS.payPeriodA, result.snapshotId, "a".repeat(64), IDS.userA],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("fails closed for disabled feature flags, unsupported jurisdictions, and self-only callers without an active employment", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");

    await admin.query(
      `update public.organization_feature_flags
       set is_enabled = false
       where organization_id = $1::uuid
         and feature_flag_id = (
           select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
         )`,
      [IDS.orgA],
    );
    expect(await getTimesheetPeriod(admin)).toMatchObject({ state: "feature_disabled" });
    const beforeFeatureDisabled = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-feature-disabled"), "feature_disabled");
    await expectBlockedAuditOnly(admin, beforeFeatureDisabled);

    await seedBase(admin);
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
    await admin.query(
      `update public.employment_profiles
       set home_jurisdiction = 'TX'
       where organization_id = $1::uuid and id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    expect(await getTimesheetPeriod(admin)).toMatchObject({ state: "unsupported_jurisdiction" });
    const beforeUnsupportedJurisdiction = await snapshotCounts(admin);
    expectBlockedResult(
      await deriveSnapshot(admin, "derive-unsupported-jurisdiction"),
      "unsupported_jurisdiction",
    );
    await expectBlockedAuditOnly(admin, beforeUnsupportedJurisdiction);

    const otherTenantPeriod = await getTimesheetPeriod(admin, selectedLocalDate, IDS.userB);
    expect(otherTenantPeriod).toMatchObject({ state: "no_employment_profile" });
    expectBlockedResult(
      await deriveSnapshot(admin, "derive-other-tenant-self-denied", selectedLocalDate, IDS.userB),
      "no_employment_profile",
    );
  });

  it("derives a 10-hour California day with unpaid meal, overtime, summary, and segment lines", async () => {
    const shiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-11T20:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-11T20:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T02:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: shiftStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-12T02:00:00Z",
      resolutionCode: "premium_not_owed",
    });

    const result = await deriveSnapshot(admin, "derive-10h");
    expect(result).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, result.snapshotId);
    expect(snapshot).toMatchObject({
      lockable: true,
      regular_seconds: 8 * 3600,
      overtime_seconds: 2 * 3600,
      double_time_seconds: 0,
      meal_premium_cents: 0,
      gross_earnings_cents: 22000,
      source_high_water: expect.objectContaining({
        employeeTimeEvents: expect.objectContaining({ rowCount: 4 }),
      }),
    });
    expect(snapshot.canonical_payload).toEqual(
      expect.objectContaining({
        payPeriodId: IDS.payPeriodA,
        policyVersionId: expect.any(String),
      }),
    );

    const lines = await readSnapshotLines(admin, result.snapshotId);
    const segmentLines = lines.filter((line) => line.line_type === "segment");
    const secondsByBucket = segmentLines.reduce<Record<string, number>>((totals, line) => {
      totals[line.line_code] = (totals[line.line_code] ?? 0) + Number(line.line_payload.seconds);
      return totals;
    }, {});
    expect(secondsByBucket).toEqual({ overtime: 2 * 3600, regular: 8 * 3600 });
    expect(segmentLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        line_code: "regular",
        line_payload: expect.objectContaining({
          startAt: "2026-08-11T16:00:00+00:00",
          endAt: "2026-08-11T20:00:00+00:00",
          seconds: 4 * 3600,
        }),
      }),
      expect.objectContaining({
        line_code: "regular",
        line_payload: expect.objectContaining({
          startAt: "2026-08-11T20:30:00+00:00",
          endAt: "2026-08-12T00:30:00+00:00",
          seconds: 4 * 3600,
        }),
      }),
      expect.objectContaining({
        line_code: "overtime",
        line_payload: expect.objectContaining({
          startAt: "2026-08-12T00:30:00+00:00",
          endAt: "2026-08-12T02:30:00+00:00",
          seconds: 2 * 3600,
        }),
      }),
    ]));
    expect(lines).toContainEqual(expect.objectContaining({
      line_type: "summary",
      line_code: "totals",
      line_payload: {
        regularSeconds: 8 * 3600,
        overtimeSeconds: 2 * 3600,
        doubleTimeSeconds: 0,
        mealPremiumCents: 0,
        grossEarningsCents: 22000,
      },
    }));
  });

  it("reclassifies only daily-regular seconds above 40 hours to weekly overtime inside one fixed workweek", async () => {
    await setWorkweekStartsOn(admin, 2);

    for (let day = 0; day < 6; day += 1) {
      const workDate = 11 + day;
      const nextDate = 12 + day;
      const dayText = String(workDate).padStart(2, "0");
      const nextDayText = String(nextDate).padStart(2, "0");
      await insertTimeEvent(admin, "shift_started", `2026-08-${dayText}T16:00:00Z`);
      await insertTimeEvent(admin, "meal_started", `2026-08-${dayText}T20:00:00Z`);
      await insertTimeEvent(admin, "meal_ended", `2026-08-${dayText}T20:30:00Z`);
      await insertTimeEvent(admin, "shift_ended", `2026-08-${nextDayText}T00:30:00Z`);
    }

    const result = await deriveSnapshot(admin, "derive-weekly-overtime");
    expect(result).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, result.snapshotId);
    expect(snapshot).toMatchObject({
      regular_seconds: 40 * 3600,
      overtime_seconds: 8 * 3600,
      double_time_seconds: 0,
      meal_premium_cents: 0,
      gross_earnings_cents: 104000,
    });

    const lines = await readSnapshotLines(admin, result.snapshotId);
    const segmentLines = lines.filter((line) => line.line_type === "segment");
    const bucketTotals = segmentLines.reduce<Record<string, number>>((totals, line) => {
      totals[line.line_code] = (totals[line.line_code] ?? 0) + Number(line.line_payload.seconds);
      return totals;
    }, {});

    expect(bucketTotals).toEqual({
      regular: 40 * 3600,
      overtime: 8 * 3600,
    });
    expect(segmentLines).toContainEqual(expect.objectContaining({
      line_code: "overtime",
      line_payload: expect.objectContaining({
        startAt: "2026-08-16T20:30:00+00:00",
        endAt: "2026-08-17T00:30:00+00:00",
        seconds: 4 * 3600,
        dayKey: "2026-08-16",
        weekKey: "2026-08-11",
      }),
    }));
  });

  it("classifies the seventh consecutive worked day as overtime even when the workweek stays below 40 regular hours", async () => {
    await setWorkweekStartsOn(admin, 2);

    for (let day = 0; day < 7; day += 1) {
      const dayText = String(11 + day).padStart(2, "0");
      await insertTimeEvent(admin, "shift_started", `2026-08-${dayText}T16:00:00Z`);
      await insertTimeEvent(admin, "shift_ended", `2026-08-${dayText}T20:00:00Z`);
    }

    const result = await deriveSnapshot(admin, "derive-seventh-day");
    expect(result).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, result.snapshotId);
    expect(snapshot).toMatchObject({
      regular_seconds: 24 * 3600,
      overtime_seconds: 4 * 3600,
      double_time_seconds: 0,
      meal_premium_cents: 0,
      gross_earnings_cents: 60000,
    });

    const lines = await readSnapshotLines(admin, result.snapshotId);
    expect(lines).toContainEqual(expect.objectContaining({
      line_type: "segment",
      line_code: "overtime",
      line_payload: expect.objectContaining({
        startAt: "2026-08-17T16:00:00+00:00",
        endAt: "2026-08-17T20:00:00+00:00",
        seconds: 4 * 3600,
        dayKey: "2026-08-17",
        weekKey: "2026-08-11",
      }),
    }));
  });

  it("derives daily double-time for paid time above 12 hours and preserves exact cents", async () => {
    const shiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-11T20:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-11T20:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T05:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: shiftStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-12T02:00:00Z",
      resolutionCode: "premium_not_owed",
    });

    const result = await deriveSnapshot(admin, "derive-double-time");
    expect(result).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, result.snapshotId);
    expect(snapshot).toMatchObject({
      regular_seconds: 8 * 3600,
      overtime_seconds: 4 * 3600,
      double_time_seconds: 1 * 3600,
      meal_premium_cents: 0,
      gross_earnings_cents: 32000,
    });

    const lines = await readSnapshotLines(admin, result.snapshotId);
    expect(lines).toContainEqual(expect.objectContaining({
      line_type: "segment",
      line_code: "doubletime",
      line_payload: expect.objectContaining({
        startAt: "2026-08-12T04:30:00+00:00",
        endAt: "2026-08-12T05:30:00+00:00",
        seconds: 1 * 3600,
        dayKey: "2026-08-11",
      }),
    }));
  });

  it("splits one paid day at a rate boundary and preserves summed earnings across the segment rates", async () => {
    await admin.query(
      "delete from public.employee_rate_versions where organization_id = $1::uuid and employment_profile_id = $2::uuid",
      [IDS.orgA, IDS.employmentA],
    );
    await insertRateVersion(admin, 2000, "2026-08-01T00:00:00Z", "2026-08-11T20:00:00Z");
    await insertRateVersion(admin, 2300, "2026-08-11T20:00:00Z");

    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-11T20:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-11T20:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T00:30:00Z");

    const result = await deriveSnapshot(admin, "derive-rate-boundary");
    expect(result).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, result.snapshotId);
    expect(snapshot).toMatchObject({
      regular_seconds: 8 * 3600,
      overtime_seconds: 0,
      double_time_seconds: 0,
      meal_premium_cents: 0,
      gross_earnings_cents: 17200,
    });

    const lines = await readSnapshotLines(admin, result.snapshotId);
    const segmentLines = lines.filter((line) => line.line_type === "segment");
    expect(segmentLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        line_code: "regular",
        line_payload: expect.objectContaining({
          startAt: "2026-08-11T16:00:00+00:00",
          endAt: "2026-08-11T20:00:00+00:00",
          seconds: 4 * 3600,
          hourlyRateCents: 2000,
          grossCents: 8000,
        }),
      }),
      expect.objectContaining({
        line_code: "regular",
        line_payload: expect.objectContaining({
          startAt: "2026-08-11T20:30:00+00:00",
          endAt: "2026-08-12T00:30:00+00:00",
          seconds: 4 * 3600,
          hourlyRateCents: 2300,
          grossCents: 9200,
        }),
      }),
    ]));
  });

  it("fails closed with zero snapshot writes and one replayable audit receipt for blocked source states", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    const beforeOpenPunch = await snapshotCounts(admin);
    const blockedOpenPunch = await deriveSnapshot(admin, "derive-open-punch");
    expectBlockedResult(blockedOpenPunch, "open_shift");
    await expectBlockedAuditOnly(admin, beforeOpenPunch);
    const afterBlockedOpenPunch = await snapshotCounts(admin);
    expect(await deriveSnapshot(admin, "derive-open-punch")).toMatchObject({
      ...blockedOpenPunch,
      replayed: true,
    });
    expect(await snapshotCounts(admin)).toEqual(afterBlockedOpenPunch);

    await seedBase(admin);
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:00:00Z");
    const beforeMeal = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-unresolved-meal"), "meal_unresolved");
    await expectBlockedAuditOnly(admin, beforeMeal);

    await seedBase(admin);
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-11T20:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-11T20:15:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-12T00:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-12T00:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T03:00:00Z");
    const beforeShortFirstMeal = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-short-first-meal"), "meal_unresolved");
    await expectBlockedAuditOnly(admin, beforeShortFirstMeal);

    await seedBase(admin);
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
    await insertTimeCorrection(admin, "2026-08-20T12:00:00Z");
    const beforeCorrection = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-pending-correction"), "correction_pending_review");
    await expectBlockedAuditOnly(admin, beforeCorrection);

    await seedBase(admin);
    await admin.query(
      `
        insert into public.employee_time_events (
          organization_id,
          employment_profile_id,
          event_type,
          event_at,
          actor_user_id,
          source_timezone,
          work_location
        )
        select
          $1::uuid,
          $2::uuid,
          case when value % 2 = 1 then 'shift_started'::public.payroll_event_type else 'shift_ended'::public.payroll_event_type end,
          ('2026-08-11T16:00:00Z'::timestamptz + ((value - 1) * interval '5 minute')),
          $3::uuid,
          'America/Los_Angeles',
          'office'::public.work_location
        from generate_series(1, 502) as value
      `,
      [IDS.orgA, IDS.employmentA, IDS.userA],
    );
    const beforeRowLimit = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-row-limit"), "event_limit_exceeded");
    await expectBlockedAuditOnly(admin, beforeRowLimit);
  });

  it("consumes shift-scoped meal resolutions, hashes them canonically, and persists premium detail exactly once", async () => {
    const shiftAStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:00:00Z");
    const shiftBStart = await insertTimeEvent(admin, "shift_started", "2026-08-12T14:00:00Z");
    const mealBStart = await insertTimeEvent(admin, "meal_started", "2026-08-12T19:30:00Z");
    const mealBEnd = await insertTimeEvent(admin, "meal_ended", "2026-08-12T19:50:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-13T01:30:00Z");

    const unresolvedCounts = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-meal-shift-unresolved"), "meal_unresolved");
    await expectBlockedAuditOnly(admin, unresolvedCounts);

    await insertMealResolution(admin, {
      shiftStartEventId: shiftAStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    const stillBlockedCounts = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-meal-shift-a-only"), "meal_unresolved");
    await expectBlockedAuditOnly(admin, stillBlockedCounts);

    await insertMealResolution(admin, {
      shiftStartEventId: shiftBStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-12T19:00:00Z",
      mealStartEventId: mealBStart,
      mealEndEventId: mealBEnd,
      resolutionCode: "premium_owed",
    });
    await insertMealResolution(admin, {
      shiftStartEventId: shiftBStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-13T00:00:00Z",
      resolutionCode: "premium_not_owed",
    });

    const period = await getTimesheetPeriod(admin);
    expect(period).toMatchObject({
      state: "ok",
      period: expect.objectContaining({
        mealResolutions: expect.arrayContaining([
          expect.objectContaining({
            shiftStartEventId: shiftAStart,
            mealOrdinal: 1,
            deadlineAt: "2026-08-11T21:00:00+00:00",
            code: "waived_first_meal",
          }),
          expect.objectContaining({
            shiftStartEventId: shiftBStart,
            mealOrdinal: 1,
            deadlineAt: "2026-08-12T19:00:00+00:00",
            mealStartEventId: mealBStart,
            mealEndEventId: mealBEnd,
            code: "premium_owed",
          }),
          expect.objectContaining({
            shiftStartEventId: shiftBStart,
            mealOrdinal: 2,
            deadlineAt: "2026-08-13T00:00:00+00:00",
            code: "premium_not_owed",
          }),
        ]),
      }),
    });

    const first = await deriveSnapshot(admin, "derive-meal-shift-green");
    expect(first).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });

    const snapshot = await readSnapshot(admin, first.snapshotId);
    expect(snapshot).toMatchObject({
      regular_seconds: 14 * 3600,
      overtime_seconds: 3 * 3600 + 10 * 60,
      double_time_seconds: 0,
      meal_premium_cents: 2000,
      gross_earnings_cents: 39500,
      source_high_water: expect.objectContaining({
        employeeTimeEvents: expect.objectContaining({ rowCount: 6 }),
        mealResolutions: expect.objectContaining({ rowCount: 3 }),
      }),
      canonical_payload: expect.objectContaining({
        period: expect.objectContaining({
          mealResolutions: expect.arrayContaining([
            expect.objectContaining({
              shiftStartEventId: shiftBStart,
              mealOrdinal: 1,
              code: "premium_owed",
            }),
          ]),
        }),
      }),
    });

    const lines = await readSnapshotLines(admin, first.snapshotId);
    expect(lines).toContainEqual(expect.objectContaining({
      line_type: "premium",
      line_code: "meal",
      line_payload: expect.objectContaining({
        shiftStartEventId: shiftBStart,
        mealOrdinal: 1,
        deadlineAt: "2026-08-12T19:00:00+00:00",
        rateVersionId: expect.any(String),
        cents: 2000,
      }),
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      line_type: "summary",
      line_code: "totals",
      line_payload: expect.objectContaining({
        mealPremiumCents: 2000,
        overtimeSeconds: 3 * 3600 + 10 * 60,
        grossEarningsCents: 39500,
      }),
    }));

    const replay = await deriveSnapshot(admin, "derive-meal-shift-green");
    expect(replay).toMatchObject({
      snapshotId: first.snapshotId,
      sourceHash: first.sourceHash,
      replayed: true,
    });

    await seedSecondPayPeriod(admin);
    const unrelatedShiftStart = await insertTimeEvent(
      admin,
      "shift_started",
      "2026-08-18T16:00:00Z",
    );
    await insertTimeEvent(admin, "shift_ended", "2026-08-18T22:00:00Z");
    await insertMealResolution(admin, {
      payPeriodId: IDS.shiftBPayPeriod,
      shiftStartEventId: unrelatedShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-18T21:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    const unchanged = await deriveSnapshot(admin, "derive-meal-shift-unchanged");
    expect(unchanged).toMatchObject({
      snapshotId: first.snapshotId,
      sourceHash: first.sourceHash,
      replayed: true,
    });
  });

  it("requires a second meal after 10 elapsed hours even when a compliant first meal reduces paid time to 10 hours", async () => {
    const shiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T14:00:00Z");
    await insertTimeEvent(admin, "meal_started", "2026-08-11T18:00:00Z");
    await insertTimeEvent(admin, "meal_ended", "2026-08-11T18:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T00:30:00Z");

    const beforeUnresolvedSecondMeal = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-elapsed-second-meal-red"), "meal_unresolved");
    await expectBlockedAuditOnly(admin, beforeUnresolvedSecondMeal);

    await insertMealResolution(admin, {
      shiftStartEventId: shiftStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-12T00:00:00Z",
      resolutionCode: "premium_not_owed",
    });
    expect(await deriveSnapshot(admin, "derive-elapsed-second-meal-green")).toMatchObject({
      replayed: false,
      snapshotId: expect.any(String),
    });
  });

  it("enforces waiver, premium, semantic, and foreign-key meal-resolution failures with zero writes", async () => {
    await seedBase(admin);
    const waiverTooLongShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: waiverTooLongShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    const beforeWaiverTooLong = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-waiver-too-long"), "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, beforeWaiverTooLong);

    await seedBase(admin);
    const wrongDeadlineStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:00:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: wrongDeadlineStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T20:59:59Z",
      resolutionCode: "waived_first_meal",
    });
    const beforeWrongDeadline = await snapshotCounts(admin);
    const wrongDeadlineResult = await deriveSnapshot(admin, "derive-wrong-deadline");
    expectBlockedResult(wrongDeadlineResult, "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, beforeWrongDeadline);

    await seedBase(admin);
    const secondMealStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T14:00:00Z");
    const firstMealStart = await insertTimeEvent(admin, "meal_started", "2026-08-11T18:00:00Z");
    const firstMealEnd = await insertTimeEvent(admin, "meal_ended", "2026-08-11T18:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T02:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: secondMealStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T19:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    await insertMealResolution(admin, {
      shiftStartEventId: secondMealStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-12T00:00:00Z",
      resolutionCode: "waived_second_meal",
      mealStartEventId: firstMealStart,
      mealEndEventId: firstMealEnd,
    });
    const beforeSecondWaiver = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-second-waiver-invalid"), "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, beforeSecondWaiver);

    await seedBase(admin);
    const firstIssueShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T14:00:00Z");
    const lateMealStart = await insertTimeEvent(admin, "meal_started", "2026-08-11T19:30:00Z");
    const lateMealEnd = await insertTimeEvent(admin, "meal_ended", "2026-08-11T19:50:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T01:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: firstIssueShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T19:00:00Z",
      mealStartEventId: lateMealStart,
      mealEndEventId: lateMealEnd,
      resolutionCode: "premium_owed",
    });
    const beforeFirstIssue = await snapshotCounts(admin);
    const unresolvedSecond = await deriveSnapshot(admin, "derive-second-unresolved");
    expectBlockedResult(unresolvedSecond, "meal_unresolved");
    await expectBlockedAuditOnly(admin, beforeFirstIssue);

    await insertMealResolution(admin, {
      shiftStartEventId: firstIssueShiftStart,
      mealOrdinal: 2,
      deadlineAt: "2026-08-12T00:00:00Z",
      resolutionCode: "premium_not_owed",
    });
    const resolvedLongShift = await deriveSnapshot(admin, "derive-second-resolved");
    expect(resolvedLongShift).toMatchObject({
      snapshotId: expect.any(String),
      replayed: false,
    });

    await seedBase(admin);
    const cleanShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    const cleanMealStart = await insertTimeEvent(admin, "meal_started", "2026-08-11T20:00:00Z");
    const cleanMealEnd = await insertTimeEvent(admin, "meal_ended", "2026-08-11T20:30:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T00:00:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: cleanShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      mealStartEventId: cleanMealStart,
      mealEndEventId: cleanMealEnd,
      resolutionCode: "premium_owed",
    });
    const compliantCounts = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-compliant-premium"), "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, compliantCounts);

    await seedBase(admin);
    const semanticShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:00:00Z");
    const otherShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-12T14:00:00Z");
    const otherMealStart = await insertTimeEvent(admin, "meal_started", "2026-08-12T19:30:00Z");
    const otherMealEnd = await insertTimeEvent(admin, "meal_ended", "2026-08-12T19:50:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-13T01:30:00Z");
    await insertMealResolution(admin, {
      shiftStartEventId: semanticShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      mealStartEventId: otherMealStart,
      mealEndEventId: otherMealEnd,
      resolutionCode: "premium_not_owed",
    });
    const semanticCounts = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-semantic-mismatch"), "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, semanticCounts);

    await seedBase(admin);
    const orphanShiftInsert = insertMealResolution(admin, {
      shiftStartEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    await expect(orphanShiftInsert).rejects.toMatchObject({ code: "23503" });

    await seedBase(admin);
    const wrongOrgShiftStart = await insertTimeEvent(
      admin,
      "shift_started",
      "2026-08-11T16:00:00Z",
      {
        organizationId: IDS.orgB,
        employmentProfileId: IDS.employmentB,
        actorUserId: IDS.userB,
      },
    );
    const wrongOrgResolution = insertMealResolution(admin, {
      shiftStartEventId: wrongOrgShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      resolutionCode: "waived_first_meal",
    });
    await expect(wrongOrgResolution).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects same-organization meal-resolution event links owned by another employment", async () => {
    const foreignShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z", {
      employmentProfileId: IDS.priorEmploymentA,
      actorUserId: IDS.priorEmployeeA,
    });

    await expect(insertMealResolution(admin, {
      shiftStartEventId: foreignShiftStart,
      mealOrdinal: 1,
      deadlineAt: "2026-08-11T21:00:00Z",
      resolutionCode: "premium_not_owed",
    })).rejects.toMatchObject({ code: "23503" });
  });

  it("hides corrupted foreign-employment meal links and fails derivation closed with zero writes", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T22:00:00Z");
    const foreignShiftStart = await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z", {
      employmentProfileId: IDS.priorEmploymentA,
      actorUserId: IDS.priorEmployeeA,
    });

    await admin.query("set session_replication_role = replica");
    let corruptResolutionId: string;
    try {
      corruptResolutionId = await insertMealResolution(admin, {
        shiftStartEventId: foreignShiftStart,
        mealOrdinal: 1,
        deadlineAt: "2026-08-11T21:00:00Z",
        resolutionCode: "premium_not_owed",
      });
    } finally {
      await admin.query("set session_replication_role = origin");
    }

    const period = await getTimesheetPeriod(admin);
    expect(period.period.mealResolutions).not.toContainEqual(
      expect.objectContaining({ id: corruptResolutionId }),
    );

    const beforeDerive = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-foreign-employment-link"), "invalid_meal_resolution");
    await expectBlockedAuditOnly(admin, beforeDerive);
  });

  it("replays canonically and preserves uniqueness under concurrent derives", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");

    const first = await deriveSnapshot(admin, "derive-replay");
    const replay = await deriveSnapshot(admin, "derive-replay");
    expect(replay).toMatchObject({
      snapshotId: first.snapshotId,
      replayed: true,
      sourceHash: first.sourceHash,
    });

    const clientA = await connect();
    const clientB = await connect();
    try {
      const [left, right] = await Promise.all([
        deriveSnapshot(clientA, "derive-concurrent-a"),
        deriveSnapshot(clientB, "derive-concurrent-b"),
      ]);
      expect(left.sourceHash).toBe(right.sourceHash);
      expect(left.snapshotId).toBe(right.snapshotId);
      const counts = await snapshotCounts(admin);
      expect(counts.snapshots).toBe(1);
      expect(counts.heads).toBe(1);
      expect(counts.lines).toBe(2);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("blocks monthly California derivation with zero writes", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
    await admin.query(
      `update public.pay_groups
       set cadence = 'monthly'
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.payGroupA],
    );

    expect(await getTimesheetPeriod(admin)).toMatchObject({
      state: "unsupported_policy",
    });

    const beforeMonthlyBlocked = await snapshotCounts(admin);
    expectBlockedResult(await deriveSnapshot(admin, "derive-monthly-block"), "unsupported_policy");
    await expectBlockedAuditOnly(admin, beforeMonthlyBlocked);
  });

  it("appends a prior/current supersession chain when the canonical source changes", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");

    const first = await deriveSnapshot(admin, "derive-supersession-v1");
    const firstHead = await readCurrentHead(admin);
    expect(firstHead).toMatchObject({
      snapshot_id: first.snapshotId,
      prior_snapshot_id: null,
    });

    await insertTimeEvent(admin, "shift_started", "2026-08-12T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T20:00:00Z");

    const second = await deriveSnapshot(admin, "derive-supersession-v2");
    expect(second.snapshotId).not.toBe(first.snapshotId);

    const secondHead = await readCurrentHead(admin);
    expect(secondHead).toMatchObject({
      snapshot_id: second.snapshotId,
      prior_snapshot_id: first.snapshotId,
    });

    const allHeads = await admin.query(
      `select snapshot_id, prior_snapshot_id
       from public.timesheet_snapshot_current_heads
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid
         and pay_period_id = $3::uuid
       order by created_at asc, id asc`,
      [IDS.orgA, IDS.employmentA, IDS.payPeriodA],
    );
    expect(allHeads.rows).toEqual([
      { snapshot_id: first.snapshotId, prior_snapshot_id: null },
      { snapshot_id: second.snapshotId, prior_snapshot_id: first.snapshotId },
    ]);
  });

  it("uses the real org derivation helper lock for source mutations and holds it through the derive transaction", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");

    const lockHolder = await connect();
    const deriveClient = await connect();
    const mutateClient = await connect();
    const mutateAfterDeriveClient = await connect();

    try {
      await lockHolder.query("begin");
      await lockHolder.query("select app.payroll_timesheet_derivation_lock($1::uuid)", [IDS.orgA]);

      await mutateClient.query("begin");
      await mutateClient.query("set local lock_timeout = '250ms'");
      await expect(
        mutateClient.query(
          `insert into public.employee_time_events (
             organization_id,
             employment_profile_id,
             event_type,
             event_at,
             actor_user_id,
             source_timezone,
             work_location
           ) values (
             $1::uuid,
             $2::uuid,
             'shift_started'::public.payroll_event_type,
             '2026-08-12T16:00:00Z'::timestamptz,
             $3::uuid,
             'America/Los_Angeles',
             'office'
           )`,
          [IDS.orgA, IDS.employmentA, IDS.userA],
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      await mutateClient.query("rollback");
      await lockHolder.query("rollback");

      await deriveClient.query("begin");
      await deriveClient.query("set local role authenticated");
      await deriveClient.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "authenticated", sub: IDS.userA }),
      ]);
      await deriveClient.query("select set_config('request.jwt.claim.sub', $1, true)", [IDS.userA]);
      const deriveResult = (
        await deriveClient.query(
          "select public.derive_timesheet_snapshot($1::date, $2::text) as result",
          [selectedLocalDate, "derive-interleave"],
        )
      ).rows[0].result;
      expect(deriveResult).toMatchObject({
        snapshotId: expect.any(String),
        replayed: false,
      });

      await mutateAfterDeriveClient.query("begin");
      await mutateAfterDeriveClient.query("set local lock_timeout = '250ms'");
      await expect(
        mutateAfterDeriveClient.query(
          `insert into public.employee_time_events (
             organization_id,
             employment_profile_id,
             event_type,
             event_at,
             actor_user_id,
             source_timezone,
             work_location
           ) values (
             $1::uuid,
             $2::uuid,
             'shift_started'::public.payroll_event_type,
             '2026-08-12T16:00:00Z'::timestamptz,
             $3::uuid,
             'America/Los_Angeles',
             'office'
           )`,
          [IDS.orgA, IDS.employmentA, IDS.userA],
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      await mutateAfterDeriveClient.query("rollback");

      await deriveClient.query("commit");

      const counts = await snapshotCounts(admin);
      expect(counts).toMatchObject({
        snapshots: 1,
        heads: 1,
        receipts: 1,
        audits: 1,
      });
      const eventCount = await admin.query(
        `select count(*)::int as count
         from public.employee_time_events
         where organization_id = $1::uuid
           and employment_profile_id = $2::uuid`,
        [IDS.orgA, IDS.employmentA],
      );
      expect(eventCount.rows[0].count).toBe(2);
    } finally {
      try { await lockHolder.query("rollback"); } catch {}
      try { await deriveClient.query("rollback"); } catch {}
      try { await mutateClient.query("rollback"); } catch {}
      try { await mutateAfterDeriveClient.query("rollback"); } catch {}
      await lockHolder.end();
      await deriveClient.end();
      await mutateClient.end();
      await mutateAfterDeriveClient.end();
    }
  }, 20000);

  it("fails closed for missing settings, assignment, pay period, policy, and rates", async () => {
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");

    for (const [table, predicate] of [
      ["public.payroll_organization_settings", `organization_id = '${IDS.orgA}'`],
      ["public.pay_group_assignments", `organization_id = '${IDS.orgA}' and employment_profile_id = '${IDS.employmentA}'`],
      ["public.pay_periods", `organization_id = '${IDS.orgA}' and id = '${IDS.payPeriodA}'`],
      ["public.payroll_policy_versions", `organization_id = '${IDS.orgA}'`],
      ["public.employee_rate_versions", `organization_id = '${IDS.orgA}' and employment_profile_id = '${IDS.employmentA}'`],
    ] as const) {
      await seedBase(admin);
      await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
      await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
      await admin.query(`delete from ${table} where ${predicate}`);
      const beforeMissingPrerequisite = await snapshotCounts(admin);
      expectBlockedResult(await deriveSnapshot(admin, `derive-missing-${table}`));
      await expectBlockedAuditOnly(admin, beforeMissingPrerequisite);
    }
  });
});
