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
  employmentB: "10000000-0000-4000-8000-000000000042",
  payGroupWeeklyA: "90000000-0000-4000-8000-000000000002",
  payGroupBiweeklyA: "90000000-0000-4000-8000-000000000102",
  payGroupMonthlyA: "90000000-0000-4000-8000-000000000103",
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
      "pay_periods",
      "pay_group_generation_versions",
      "pay_group_assignments",
      "pay_groups",
      "employee_rate_versions",
      "employee_manager_assignments",
      "payroll_capability_grants",
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
    await client.query("delete from public.user_therapist_links where user_id = any($1::uuid[])", [fixtureUserIds]);
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
         ($1::uuid, $2::uuid, 'payroll.configure_employment', '2026-08-01T00:00:00Z', $2::uuid),
         ($1::uuid, $2::uuid, 'payroll.export_period', '2026-08-01T00:00:00Z', $2::uuid),
         ($1::uuid, $2::uuid, 'payroll.view_compensation', '2026-08-01T00:00:00Z', $2::uuid),
         ($1::uuid, $3::uuid, 'payroll.configure_employment', '2026-08-01T00:00:00Z', $2::uuid)`,
      [IDS.orgA, IDS.adminA, IDS.managerA],
    );
    await client.query(
      `insert into public.pay_groups (id, organization_id, name, cadence, timezone)
       values
         ($1::uuid, $2::uuid, 'Weekly Payroll', 'weekly', 'America/Los_Angeles'),
         ($3::uuid, $2::uuid, 'Biweekly Payroll', 'biweekly', 'America/Los_Angeles'),
         ($4::uuid, $2::uuid, 'Monthly Payroll', 'monthly', 'America/Los_Angeles')`,
      [IDS.payGroupWeeklyA, IDS.orgA, IDS.payGroupBiweeklyA, IDS.payGroupMonthlyA],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const executeAdministration = async (
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
          "select public.execute_payroll_administration($1::jsonb, $2::text) as result",
          [JSON.stringify(payload), idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const getAdministration = async (client: Client, userId: string, selectedLocalDate = "2026-08-13") =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_administration($1::date) as result",
          [selectedLocalDate],
        )
      ).rows[0].result,
  );

const getTimesheetPeriod = async (client: Client, userId: string, selectedLocalDate = "2026-08-13") =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_timesheet_period($1::date) as result",
          [selectedLocalDate],
        )
      ).rows[0].result,
  );

const countAdminWrites = async (client: Client) =>
  (
    await client.query(
      `select
         (select count(*)::int from public.pay_group_generation_versions where organization_id = $1::uuid) as generation_versions,
         (select count(*)::int from public.pay_periods where organization_id = $1::uuid) as pay_periods,
         (select count(*)::int from public.payroll_mutation_receipts where organization_id = $1::uuid and operation = 'execute_payroll_administration') as receipts,
         (select count(*)::int from public.payroll_audit_events where organization_id = $1::uuid and operation = 'execute_payroll_administration') as audits`,
      [IDS.orgA],
    )
  ).rows[0];

describe.skipIf(!hasSafeLocalDatabase)("payroll administration rpc runtime contract", () => {
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

  it("denies non-admin and missing-grant callers before any administration writes", async () => {
    const before = await countAdminWrites(admin);

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupWeeklyA,
          cadence: "weekly",
          startsOn: "2026-08-11",
          effectiveFrom: "2026-08-11",
          timezone: "America/Los_Angeles",
        },
        "non-admin-denied",
        IDS.employeeA,
      ),
    ).rejects.toThrow();

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupWeeklyA,
          cadence: "weekly",
          startsOn: "2026-08-11",
          effectiveFrom: "2026-08-11",
          timezone: "America/Los_Angeles",
        },
        "missing-capability-denied",
        IDS.managerA,
      ),
    ).rejects.toThrow();

    expect(await countAdminWrites(admin)).toEqual(before);
  });

  it("rejects recursive authority fields and unsupported actions with zero writes", async () => {
    const before = await countAdminWrites(admin);

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupWeeklyA,
          cadence: "weekly",
          startsOn: "2026-08-11",
          effectiveFrom: "2026-08-11",
          timezone: "America/Los_Angeles",
          nested: {
            actorUserId: IDS.adminA,
          },
        },
        "authority-field-reject",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await expect(
      executeAdministration(
        admin,
        {
          action: "unknown_action",
        },
        "unsupported-action",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    expect(await countAdminWrites(admin)).toEqual(before);
  });

  it("enforces canonical external identifiers and trimmed printable pay-group names before writes", async () => {
    const invalidExternalIdentifiers = [
      "",
      " leading",
      "trailing ",
      "internal space",
      "Org,One",
      'Org"One',
      "Org\rOne",
      "Org\nOne",
      "Org\tOne",
      "-starts-with-punctuation",
      "A".repeat(129),
    ];

    for (const [index, externalPayrollOrganizationId] of invalidExternalIdentifiers.entries()) {
      await expect(
        executeAdministration(
          admin,
          {
            action: "supersede_org_settings",
            externalPayrollOrganizationId,
            timezone: "America/Los_Angeles",
            effectiveFrom: "2026-08-15",
          },
          `reject-external-payroll-organization-id-${index}`,
          IDS.adminA,
        ),
      ).rejects.toMatchObject({ code: "22023" });
    }

    const settings = await executeAdministration(
      admin,
      {
        action: "supersede_org_settings",
        externalPayrollOrganizationId: "Org.1_A:B@C/D-E",
        timezone: "America/Los_Angeles",
        effectiveFrom: "2026-08-15",
      },
      "accept-external-payroll-organization-id",
      IDS.adminA,
    );
    expect(settings).toMatchObject({ action: "supersede_org_settings", replayed: false });

    await expect(
      executeAdministration(
        admin,
        {
          action: "create_employment",
          userId: IDS.schedulerA,
          employeeNumber: "Employee,One",
          payrollEmployeeId: "Payroll-1",
          timezone: "America/Los_Angeles",
          activeFrom: "2026-08-01",
        },
        "reject-employee-number",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "22023" });

    await expect(
      executeAdministration(
        admin,
        {
          action: "create_employment",
          userId: IDS.schedulerA,
          employeeNumber: "Employee-1",
          payrollEmployeeId: "Payroll 1",
          timezone: "America/Los_Angeles",
          activeFrom: "2026-08-01",
        },
        "reject-payroll-employee-id",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "22023" });

    const employment = await executeAdministration(
      admin,
      {
        action: "create_employment",
        userId: IDS.schedulerA,
        employeeNumber: "Emp.1_A:B@C/D-E",
        payrollEmployeeId: "Payroll.1_A:B@C/D-E",
        timezone: "America/Los_Angeles",
        activeFrom: "2026-08-01",
      },
      "accept-employment-external-identifiers",
      IDS.adminA,
    );
    expect(employment).toMatchObject({ action: "create_employment", replayed: false });

    for (const [index, name] of [
      "",
      " leading",
      "trailing ",
      "Line\nBreak",
      "Tab\tName",
      "N".repeat(101),
    ].entries()) {
      await expect(
        executeAdministration(
          admin,
          {
            action: "create_pay_group",
            name,
            cadence: "weekly",
            timezone: "America/Los_Angeles",
            effectiveFrom: "2026-08-01",
          },
          `reject-pay-group-name-${index}`,
          IDS.adminA,
        ),
      ).rejects.toMatchObject({ code: "22023" });
    }

    const payGroup = await executeAdministration(
      admin,
      {
        action: "create_pay_group",
        name: "Clinical Operations - West 2",
        cadence: "weekly",
        timezone: "America/Los_Angeles",
        effectiveFrom: "2026-08-01",
      },
      "accept-printable-pay-group-name",
      IDS.adminA,
    );
    expect(payGroup).toMatchObject({ action: "create_pay_group", replayed: false });

    const storedValues = (
      await admin.query(
        `select
           (select external_payroll_organization_id
            from public.payroll_organization_settings
            where organization_id = $1::uuid
            order by effective_from desc
            limit 1) as external_payroll_organization_id,
           (select employee_number
            from public.employment_profiles
            where organization_id = $1::uuid and user_id = $2::uuid) as employee_number,
           (select payroll_employee_id
            from public.employment_profiles
            where organization_id = $1::uuid and user_id = $2::uuid) as payroll_employee_id,
           (select name
            from public.pay_groups
            where organization_id = $1::uuid and name = 'Clinical Operations - West 2') as pay_group_name`,
        [IDS.orgA, IDS.schedulerA],
      )
    ).rows[0];
    expect(storedValues).toEqual({
      external_payroll_organization_id: "Org.1_A:B@C/D-E",
      employee_number: "Emp.1_A:B@C/D-E",
      payroll_employee_id: "Payroll.1_A:B@C/D-E",
      pay_group_name: "Clinical Operations - West 2",
    });
  });

  it("requires configure and compensation-view capabilities together for rate writes", async () => {
    await admin.query(
      `delete from public.payroll_capability_grants
       where organization_id = $1::uuid
         and user_id = $2::uuid
         and capability = 'payroll.view_compensation'`,
      [IDS.orgA, IDS.adminA],
    );

    const before = await admin.query(
      `select count(*)::int as rate_count
       from public.employee_rate_versions
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    await expect(
      executeAdministration(
        admin,
        {
          action: "add_rate_version",
          employmentProfileId: IDS.employmentA,
          hourlyRateCents: 3300,
          effectiveFrom: "2026-08-15T00:00:01Z",
        },
        "deny-configure-only-rate-version",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const afterDenied = await admin.query(
      `select count(*)::int as rate_count
       from public.employee_rate_versions
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    expect(afterDenied.rows[0]).toEqual(before.rows[0]);

    await executeAdministration(
      admin,
      {
        action: "grant_capability",
        userId: IDS.adminA,
        capability: "payroll.view_compensation",
        effectiveFrom: "2026-08-01T00:00:00Z",
      },
      "restore-view-compensation-for-rate-version",
      IDS.adminA,
    );
    await admin.query(
      `update public.employee_rate_versions
       set effective_through = '2026-08-15T00:00:00Z'
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );

    const accepted = await executeAdministration(
      admin,
      {
        action: "add_rate_version",
        employmentProfileId: IDS.employmentA,
        hourlyRateCents: 3300,
        effectiveFrom: "2026-08-15T00:00:01Z",
      },
      "accept-dual-capability-rate-version",
      IDS.adminA,
    );
    expect(accepted).toMatchObject({ action: "add_rate_version", replayed: false });
  });

  it("accepts same-org target user ids and rejects cross-org capability targets", async () => {
    const grant = await executeAdministration(
      admin,
      {
        action: "grant_capability",
        userId: IDS.managerA,
        capability: "payroll.export_period",
        effectiveFrom: "2026-08-01T00:00:00Z",
      },
      "grant-same-org-capability",
      IDS.adminA,
    );
    expect(grant).toMatchObject({ action: "grant_capability", replayed: false });

    await expect(
      executeAdministration(
        admin,
        {
          action: "grant_capability",
          userId: IDS.employeeB,
          capability: "payroll.export_period",
          effectiveFrom: "2026-08-01T00:00:00Z",
        },
        "grant-cross-org-capability",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const targetRows = await admin.query(
      `select user_id
       from public.payroll_capability_grants
       where organization_id = $1::uuid
         and capability = 'payroll.export_period'
         and user_id = any($2::uuid[])
       order by user_id`,
      [IDS.orgA, [IDS.managerA, IDS.employeeB]],
    );
    expect(targetRows.rows).toEqual([{ user_id: IDS.managerA }]);
  });

  it("creates weekly and biweekly generation versions, generates exact periods, and keeps monthly fail-closed with zero writes", async () => {
    const weeklyVersion = await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-weekly-version",
      IDS.adminA,
    );
    expect(weeklyVersion).toMatchObject({
      action: "set_generation_version",
      replayed: false,
    });

    const biweeklyVersion = await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupBiweeklyA,
        cadence: "biweekly",
        startsOn: "2026-08-04",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-biweekly-version",
      IDS.adminA,
    );
    expect(biweeklyVersion).toMatchObject({
      action: "set_generation_version",
      replayed: false,
    });

    const weeklyPeriods = await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupWeeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-weekly-periods",
      IDS.adminA,
    );
    expect(weeklyPeriods).toMatchObject({
      action: "generate_periods",
      replayed: false,
      generatedCount: 5,
    });

    const biweeklyPeriods = await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupBiweeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-biweekly-periods",
      IDS.adminA,
    );
    expect(biweeklyPeriods).toMatchObject({
      action: "generate_periods",
      replayed: false,
      generatedCount: 3,
    });

    const beforeMonthly = await countAdminWrites(admin);
    await expect(
      executeAdministration(
        admin,
        {
          action: "generate_periods",
          payGroupId: IDS.payGroupMonthlyA,
          from: "2026-08-01",
          to: "2026-08-31",
        },
        "generate-monthly-periods",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countAdminWrites(admin)).toEqual(beforeMonthly);

    const periods = await admin.query(
      `select
         pay_group_id,
         to_char(starts_on, 'YYYY-MM-DD') as starts_on,
         to_char(ends_on, 'YYYY-MM-DD') as ends_on
       from public.pay_periods
       where organization_id = $1::uuid
       order by pay_group_id, starts_on`,
      [IDS.orgA],
    );
    expect(periods.rows).toEqual([
      {
        pay_group_id: IDS.payGroupWeeklyA,
        starts_on: "2026-07-28",
        ends_on: "2026-08-03",
      },
      {
        pay_group_id: IDS.payGroupWeeklyA,
        starts_on: "2026-08-04",
        ends_on: "2026-08-10",
      },
      {
        pay_group_id: IDS.payGroupWeeklyA,
        starts_on: "2026-08-11",
        ends_on: "2026-08-17",
      },
      {
        pay_group_id: IDS.payGroupWeeklyA,
        starts_on: "2026-08-18",
        ends_on: "2026-08-24",
      },
      {
        pay_group_id: IDS.payGroupWeeklyA,
        starts_on: "2026-08-25",
        ends_on: "2026-08-31",
      },
      {
        pay_group_id: IDS.payGroupBiweeklyA,
        starts_on: "2026-07-21",
        ends_on: "2026-08-03",
      },
      {
        pay_group_id: IDS.payGroupBiweeklyA,
        starts_on: "2026-08-04",
        ends_on: "2026-08-17",
      },
      {
        pay_group_id: IDS.payGroupBiweeklyA,
        starts_on: "2026-08-18",
        ends_on: "2026-08-31",
      },
    ]);
  });

  it("replays identical period generation idempotently, rejects key conflicts, and serializes concurrent generation without duplicate periods", async () => {
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-version-concurrency",
      IDS.adminA,
    );

    const first = await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupWeeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-periods-idempotent",
      IDS.adminA,
    );
    expect(first.generatedCount).toBe(5);

    const replay = await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupWeeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-periods-idempotent",
      IDS.adminA,
    );
    expect(replay).toMatchObject({
      replayed: true,
      generatedCount: 5,
    });

    await expect(
      executeAdministration(
        admin,
        {
          action: "generate_periods",
          payGroupId: IDS.payGroupWeeklyA,
          from: "2026-08-01",
          to: "2026-09-30",
        },
        "generate-periods-idempotent",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const clientA = await connect();
    const clientB = await connect();
    try {
      const results = await Promise.all([
        executeAdministration(
          clientA,
          {
            action: "generate_periods",
            payGroupId: IDS.payGroupWeeklyA,
            from: "2026-09-01",
            to: "2026-09-30",
          },
          "generate-periods-concurrent-a",
          IDS.adminA,
        ),
        executeAdministration(
          clientB,
          {
            action: "generate_periods",
            payGroupId: IDS.payGroupWeeklyA,
            from: "2026-09-01",
            to: "2026-09-30",
          },
          "generate-periods-concurrent-b",
          IDS.adminA,
        ),
      ]);

      expect(results[0].generatedCount + results[1].generatedCount).toBe(5);
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const duplicateCheck = await admin.query(
      `select starts_on, ends_on, count(*)::int as duplicate_count
       from public.pay_periods
       where organization_id = $1::uuid
         and pay_group_id = $2::uuid
       group by starts_on, ends_on
       having count(*) > 1`,
      [IDS.orgA, IDS.payGroupWeeklyA],
    );
    expect(duplicateCheck.rows).toEqual([]);
  });

  it("rejects overlapping generation versions and out-of-scope targets", async () => {
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-weekly-overlap-base",
      IDS.adminA,
    );

    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-25",
        effectiveFrom: "2026-08-25",
        timezone: "America/Los_Angeles",
      },
      "set-weekly-overlap-future",
      IDS.adminA,
    );

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupWeeklyA,
          cadence: "weekly",
          startsOn: "2026-08-18",
          effectiveFrom: "2026-08-15",
          effectiveThrough: "2026-08-30",
          timezone: "America/Los_Angeles",
        },
        "set-weekly-overlap-conflict",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    await expect(
      executeAdministration(
        admin,
        {
          action: "create_pay_group_assignment",
          employmentProfileId: IDS.employmentB,
          payGroupId: IDS.payGroupWeeklyA,
          effectiveFrom: "2026-08-11",
        },
        "cross-org-employment-denied",
        IDS.adminA,
      ),
    ).rejects.toThrow();
  });

  it("rejects crossing-period facts under current and proposed definitions while allowing an unaffected future boundary", async () => {
    await executeAdministration(
      admin,
      {
        action: "create_pay_group_assignment",
        employmentProfileId: IDS.employmentA,
        payGroupId: IDS.payGroupWeeklyA,
        effectiveFrom: "2026-08-01",
      },
      "assign-weekly-pay-group-for-facts",
      IDS.adminA,
    );

    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-current-weekly-generation-for-crossing-facts",
      IDS.adminA,
    );

    await admin.query(
      `insert into public.employee_time_events (
         organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location
       ) values (
         $1::uuid, $2::uuid, 'shift_started', '2026-08-10T16:00:00Z', $3::uuid, 'America/Los_Angeles', 'office'
       )`,
      [IDS.orgA, IDS.employmentA, IDS.employeeA],
    );

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupWeeklyA,
          cadence: "biweekly",
          startsOn: "2026-08-14",
          effectiveFrom: "2026-08-12",
          timezone: "America/Los_Angeles",
        },
        "set-generation-after-crossing-source-fact",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const futureVersion = await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "biweekly",
        startsOn: "2026-08-25",
        effectiveFrom: "2026-08-25",
        timezone: "America/Los_Angeles",
      },
      "set-unaffected-future-generation-boundary",
      IDS.adminA,
    );
    expect(futureVersion).toMatchObject({
      action: "set_generation_version",
      replayed: false,
    });

    const configuredVersions = await admin.query(
      `select cadence, to_char(starts_on, 'YYYY-MM-DD') as starts_on,
              to_char(effective_from, 'YYYY-MM-DD') as effective_from,
              to_char(effective_through, 'YYYY-MM-DD') as effective_through
       from public.pay_group_generation_versions
       where organization_id = $1::uuid
         and pay_group_id = $2::uuid
       order by effective_from`,
      [IDS.orgA, IDS.payGroupWeeklyA],
    );
    expect(configuredVersions.rows).toEqual([
      {
        cadence: "weekly",
        starts_on: "2026-08-11",
        effective_from: "2026-08-01",
        effective_through: "2026-08-24",
      },
      {
        cadence: "biweekly",
        starts_on: "2026-08-25",
        effective_from: "2026-08-25",
        effective_through: null,
      },
    ]);

    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupBiweeklyA,
        cadence: "biweekly",
        startsOn: "2026-08-04",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-generation-before-period-facts",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupBiweeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-periods-before-boundary-rewrite",
      IDS.adminA,
    );

    await expect(
      executeAdministration(
        admin,
        {
          action: "set_generation_version",
          payGroupId: IDS.payGroupBiweeklyA,
          cadence: "biweekly",
          startsOn: "2026-08-18",
          effectiveFrom: "2026-08-18",
          timezone: "America/Los_Angeles",
        },
        "rewrite-generation-after-period-facts",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const biweeklyPeriods = await admin.query(
      `select to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
       from public.pay_periods
       where organization_id = $1::uuid
         and pay_group_id = $2::uuid
       order by starts_on`,
      [IDS.orgA, IDS.payGroupBiweeklyA],
    );
    expect(biweeklyPeriods.rows).toEqual([
      { starts_on: "2026-07-21", ends_on: "2026-08-03" },
      { starts_on: "2026-08-04", ends_on: "2026-08-17" },
      { starts_on: "2026-08-18", ends_on: "2026-08-31" },
    ]);
  });

  it("only deactivates open rows and rejects a different key from rewriting already-closed payroll administration rows", async () => {
    const weeklyAssignment = await executeAdministration(
      admin,
      {
        action: "create_pay_group_assignment",
        employmentProfileId: IDS.employmentA,
        payGroupId: IDS.payGroupWeeklyA,
        effectiveFrom: "2026-08-01",
      },
      "create-assignment-for-close-guards",
      IDS.adminA,
    );

    const closeEmployment = await executeAdministration(
      admin,
      {
        action: "deactivate_employment",
        employmentProfileId: IDS.employmentA,
        effectiveThrough: "2026-08-20",
      },
      "close-employment-once",
      IDS.adminA,
    );
    expect(closeEmployment).toMatchObject({ action: "deactivate_employment", replayed: false });
    await expect(
      executeAdministration(
        admin,
        {
          action: "deactivate_employment",
          employmentProfileId: IDS.employmentA,
          effectiveThrough: "2026-08-25",
        },
        "close-employment-twice-different-key",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await executeAdministration(
        admin,
        {
          action: "deactivate_employment",
          employmentProfileId: IDS.employmentA,
          effectiveThrough: "2026-08-20",
        },
        "close-employment-once",
        IDS.adminA,
      ),
    ).toMatchObject({ replayed: true });

    const managerAssignmentId = (
      await admin.query(
        `select id
         from public.employee_manager_assignments
         where organization_id = $1::uuid
           and employment_profile_id = $2::uuid
         order by created_at desc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id as string;
    await executeAdministration(
      admin,
      {
        action: "deactivate_manager_assignment",
        managerAssignmentId,
        effectiveThrough: "2026-08-20T00:00:00Z",
      },
      "close-manager-assignment-once",
      IDS.adminA,
    );
    await expect(
      executeAdministration(
        admin,
        {
          action: "deactivate_manager_assignment",
          managerAssignmentId,
          effectiveThrough: "2026-08-25T00:00:00Z",
        },
        "close-manager-assignment-twice-different-key",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await executeAdministration(
      admin,
      {
        action: "deactivate_pay_group",
        payGroupId: IDS.payGroupWeeklyA,
        effectiveThrough: "2026-08-20",
      },
      "close-pay-group-once",
      IDS.adminA,
    );
    await expect(
      executeAdministration(
        admin,
        {
          action: "deactivate_pay_group",
          payGroupId: IDS.payGroupWeeklyA,
          effectiveThrough: "2026-08-25",
        },
        "close-pay-group-twice-different-key",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await executeAdministration(
      admin,
      {
        action: "deactivate_pay_group_assignment",
        payGroupAssignmentId: weeklyAssignment.payGroupAssignmentId,
        effectiveThrough: "2026-08-20",
      },
      "close-pay-group-assignment-once",
      IDS.adminA,
    );
    await expect(
      executeAdministration(
        admin,
        {
          action: "deactivate_pay_group_assignment",
          payGroupAssignmentId: weeklyAssignment.payGroupAssignmentId,
          effectiveThrough: "2026-08-25",
        },
        "close-pay-group-assignment-twice-different-key",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps payroll organization external ids unique across effective-dated overlap while allowing non-overlapping history for the same org", async () => {
    const superseded = await executeAdministration(
      admin,
      {
        action: "supersede_org_settings",
        externalPayrollOrganizationId: "payroll-contract-org-a",
        timezone: "America/Los_Angeles",
        workdayStartsAt: "05:00",
        workweekStartsOn: 0,
        effectiveFrom: "2026-08-15",
      },
      "supersede-org-settings-same-external-id",
      IDS.adminA,
    );
    expect(superseded).toMatchObject({ action: "supersede_org_settings", replayed: false });

    await expect(
      admin.query(
        `insert into public.payroll_organization_settings (
           organization_id,
           external_payroll_organization_id,
           timezone,
           workday_starts_at,
           workweek_starts_on,
           effective_from
         ) values (
           $1::uuid,
           'payroll-contract-org-a',
           'America/Los_Angeles',
           '05:00',
           0,
           '2026-08-10'
         )`,
        [IDS.orgB],
      ),
    ).rejects.toThrow();
  });

  it("returns missing_prerequisite without broadening events when no pay period covers the selected date, and maps missing policy to unsupported_policy", async () => {
    await executeAdministration(
      admin,
      {
        action: "create_pay_group_assignment",
        employmentProfileId: IDS.employmentA,
        payGroupId: IDS.payGroupWeeklyA,
        effectiveFrom: "2026-08-01",
      },
      "create-assignment-for-timesheet-period",
      IDS.adminA,
    );

    await admin.query(
      `insert into public.employee_time_events (
         organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location
       ) values
         ($1::uuid, $2::uuid, 'shift_started', '2026-08-13T16:00:00Z', $3::uuid, 'America/Los_Angeles', 'office'),
         ($1::uuid, $2::uuid, 'shift_ended', '2026-08-13T23:00:00Z', $3::uuid, 'America/Los_Angeles', 'office')`,
      [IDS.orgA, IDS.employmentA, IDS.employeeA],
    );

    const missingPeriod = await getTimesheetPeriod(admin, IDS.employeeA, "2026-08-13");
    expect(missingPeriod).toMatchObject({
      state: "missing_prerequisite",
      employmentProfileId: IDS.employmentA,
    });
    expect(missingPeriod.snapshot).toBeUndefined();

    const weeklyAssignmentId = (
      await admin.query(
        `select id
         from public.pay_group_assignments
         where organization_id = $1::uuid
           and employment_profile_id = $2::uuid
         order by created_at desc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id as string;
    await executeAdministration(
      admin,
      {
        action: "deactivate_pay_group_assignment",
        payGroupAssignmentId: weeklyAssignmentId,
        effectiveThrough: "2026-08-13",
      },
      "close-weekly-assignment-before-unsupported-policy",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "create_pay_group_assignment",
        employmentProfileId: IDS.employmentA,
        payGroupId: IDS.payGroupBiweeklyA,
        effectiveFrom: "2026-08-14",
      },
      "create-biweekly-assignment-for-unsupported-policy",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupBiweeklyA,
        cadence: "biweekly",
        startsOn: "2026-08-04",
        effectiveFrom: "2026-08-14",
        timezone: "America/Los_Angeles",
      },
      "set-generation-for-unsupported-policy",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupBiweeklyA,
        from: "2026-08-14",
        to: "2026-08-31",
      },
      "generate-periods-for-unsupported-policy",
      IDS.adminA,
    );
    await admin.query(
      `delete from public.payroll_policy_versions
       where organization_id = $1::uuid`,
      [IDS.orgA],
    );

    const unsupportedPolicy = await getTimesheetPeriod(admin, IDS.employeeA, "2026-08-20");
    expect(unsupportedPolicy).toMatchObject({
      state: "unsupported_policy",
      employmentProfileId: IDS.employmentA,
    });
  });

  it("returns sanitized administration reads, redacts compensation without the exact capability, and preserves audit history", async () => {
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-version-read-model",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupWeeklyA,
        from: "2026-08-01",
        to: "2026-08-31",
      },
      "generate-periods-read-model",
      IDS.adminA,
    );

    const adminView = await getAdministration(admin, IDS.adminA);
    expect(adminView).toMatchObject({
      state: "ok",
      capabilities: {
        canConfigureEmployment: true,
        canGeneratePeriods: true,
        canViewCompensation: true,
        canManagePolicyMutations: false,
      },
    });
    expect(adminView.orgSettings).toEqual(expect.any(Array));
    expect(adminView.employments).toEqual(expect.any(Array));
    expect(adminView.payGroups).toEqual(expect.any(Array));
    expect(adminView.generationVersions).toEqual(expect.any(Array));
    expect(adminView.payPeriods).toEqual(expect.any(Array));
    expect(JSON.stringify(adminView)).not.toContain("clientId");
    expect(JSON.stringify(adminView)).not.toContain("sessionId");

    await admin.query(
      `delete from public.payroll_capability_grants
       where organization_id = $1::uuid
         and user_id = $2::uuid
         and capability = 'payroll.view_compensation'`,
      [IDS.orgA, IDS.adminA],
    );
    const redactedAdminView = await getAdministration(admin, IDS.adminA);
    expect(redactedAdminView.capabilities.canViewCompensation).toBe(false);
    expect(JSON.stringify(redactedAdminView)).not.toContain("hourlyRateCents");
    expect(JSON.stringify(redactedAdminView)).not.toContain("grossEarningsCents");

    const auditRows = await admin.query(
      `select operation, payload ->> 'action' as action
       from public.payroll_audit_events
       where organization_id = $1::uuid
         and operation = 'execute_payroll_administration'
       order by created_at asc, id asc`,
      [IDS.orgA],
    );
    expect(auditRows.rows).toEqual([
      { operation: "execute_payroll_administration", action: "set_generation_version" },
      { operation: "execute_payroll_administration", action: "generate_periods" },
    ]);
  });

  it("redacts compensation from audit visibility for export-only and resolve-only readers", async () => {
    await admin.query(
      `update public.employee_rate_versions
       set effective_through = '2026-08-15T00:00:00Z'
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    await executeAdministration(
      admin,
      {
        action: "add_rate_version",
        employmentProfileId: IDS.employmentA,
        hourlyRateCents: 3200,
        effectiveFrom: "2026-08-15T00:00:01Z",
      },
      "add-rate-version-redacted-audit",
      IDS.adminA,
    );

    await admin.query(
      `delete from public.payroll_capability_grants
       where organization_id = $1::uuid
         and user_id = $2::uuid
         and capability = 'payroll.view_compensation'`,
      [IDS.orgA, IDS.adminA],
    );

    const exportAuditRows = await withRole(
      admin,
      "authenticated",
      IDS.adminA,
      async () =>
        (
          await admin.query(
            `select payload
             from public.payroll_audit_events
             where organization_id = $1::uuid
               and operation = 'execute_payroll_administration'
             order by created_at desc
             limit 1`,
            [IDS.orgA],
          )
        ).rows,
    );
    expect(exportAuditRows).toEqual([
      {
        payload: expect.objectContaining({
          action: "add_rate_version",
          compensationRedacted: true,
        }),
      },
    ]);
    expect(JSON.stringify(exportAuditRows)).not.toContain("hourlyRateCents");

    const resolveVisibility = await withRole(
      admin,
      "authenticated",
      IDS.adminA,
      async () =>
        (
          await admin.query(
            `select
               (select payload from public.payroll_audit_events where organization_id = $1::uuid order by created_at desc limit 1) as audit_payload,
               (select result_payload from public.payroll_mutation_receipts where organization_id = $1::uuid and actor_user_id = $2::uuid and idempotency_key = 'add-rate-version-redacted-audit' limit 1) as receipt_payload`,
            [IDS.orgA, IDS.adminA],
          )
        ).rows[0],
    );
    expect(resolveVisibility.audit_payload).toMatchObject({
      action: "add_rate_version",
      compensationRedacted: true,
    });
    expect(JSON.stringify(resolveVisibility)).not.toContain("hourlyRateCents");
  });

  it("bounds payroll administration history by default and keeps the unrelated advisory-lock scope independent from pay-group generation", async () => {
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-generation-bounded-admin-read",
      IDS.adminA,
    );
    await executeAdministration(
      admin,
      {
        action: "generate_periods",
        payGroupId: IDS.payGroupWeeklyA,
        from: "2026-08-01",
        to: "2027-08-31",
      },
      "generate-periods-bounded-admin-read",
      IDS.adminA,
    );

    const boundedView = await getAdministration(admin, IDS.adminA);
    expect(boundedView.bounds).toMatchObject({
      payPeriods: 50,
      employments: 50,
      orgSettings: 50,
      policies: 20,
    });
    expect(boundedView.payPeriods).toHaveLength(50);

    const lockHolder = await connect();
    const unrelatedWriter = await connect();
    try {
      await lockHolder.query("begin");
      await lockHolder.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             app.payroll_administration_lock_scope(
               'generate_periods',
               $1::uuid,
               jsonb_build_object('payGroupId', $2::uuid)
             ),
             0
           )
         )`,
        [IDS.orgA, IDS.payGroupWeeklyA],
      );

      const startedAt = Date.now();
      const unrelatedWritePromise = executeAdministration(
        unrelatedWriter,
        {
          action: "grant_capability",
          userId: IDS.schedulerA,
          capability: "payroll.export_period",
          effectiveFrom: "2026-08-01T00:00:00Z",
        },
        "grant-capability-during-generate-lock",
        IDS.adminA,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      const unrelatedWriteResult = await unrelatedWritePromise;
      const elapsedMs = Date.now() - startedAt;

      expect(unrelatedWriteResult).toMatchObject({ action: "grant_capability", replayed: false });
      expect(elapsedMs).toBeLessThan(1500);
    } finally {
      await lockHolder.query("rollback");
      await lockHolder.end();
      await unrelatedWriter.end();
    }
  });

  it("serializes generation-version changes with period generation and commits one consistent definition", async () => {
    await executeAdministration(
      admin,
      {
        action: "set_generation_version",
        payGroupId: IDS.payGroupWeeklyA,
        cadence: "weekly",
        startsOn: "2026-08-11",
        effectiveFrom: "2026-08-01",
        timezone: "America/Los_Angeles",
      },
      "set-cross-action-base-generation",
      IDS.adminA,
    );

    const versionWriter = await connect();
    const periodWriter = await connect();
    let generationPromise: Promise<Record<string, unknown>> | null = null;
    try {
      await versionWriter.query("begin");
      await setRoleContext(versionWriter, "authenticated", IDS.adminA);
      await versionWriter.query(
        "select public.execute_payroll_administration($1::jsonb, $2::text) as result",
        [
          JSON.stringify({
            action: "set_generation_version",
            payGroupId: IDS.payGroupWeeklyA,
            cadence: "weekly",
            startsOn: "2026-09-03",
            effectiveFrom: "2026-09-01",
            timezone: "America/Los_Angeles",
          }),
          "set-cross-action-future-generation",
        ],
      );

      let generationSettled = false;
      generationPromise = executeAdministration(
        periodWriter,
        {
          action: "generate_periods",
          payGroupId: IDS.payGroupWeeklyA,
          from: "2026-09-01",
          to: "2026-09-15",
        },
        "generate-during-version-change",
        IDS.adminA,
      ).finally(() => {
        generationSettled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      const settledBeforeVersionCommit = generationSettled;
      await versionWriter.query("commit");

      const generationResult = await generationPromise;
      expect(settledBeforeVersionCommit).toBe(false);
      expect(generationResult).toMatchObject({
        action: "generate_periods",
        generatedCount: 3,
        replayed: false,
      });
    } finally {
      await versionWriter.query("rollback");
      if (generationPromise) await Promise.allSettled([generationPromise]);
      await versionWriter.end();
      await periodWriter.end();
    }

    const committedPeriods = await admin.query(
      `select to_char(starts_on, 'YYYY-MM-DD') as starts_on,
              to_char(ends_on, 'YYYY-MM-DD') as ends_on
       from public.pay_periods
       where organization_id = $1::uuid
         and pay_group_id = $2::uuid
       order by starts_on`,
      [IDS.orgA, IDS.payGroupWeeklyA],
    );
    expect(committedPeriods.rows).toEqual([
      { starts_on: "2026-08-27", ends_on: "2026-09-02" },
      { starts_on: "2026-09-03", ends_on: "2026-09-09" },
      { starts_on: "2026-09-10", ends_on: "2026-09-16" },
    ]);
  });

  it("keeps direct delete and RPC grants least-privilege", async () => {
    const grants = (
      await admin.query(
        `select
           has_function_privilege('authenticated', 'public.execute_payroll_administration(jsonb, text)', 'EXECUTE') as auth_execute,
           has_function_privilege('service_role', 'public.execute_payroll_administration(jsonb, text)', 'EXECUTE') as service_execute,
           has_function_privilege('anon', 'public.execute_payroll_administration(jsonb, text)', 'EXECUTE') as anon_execute,
           has_table_privilege('authenticated', 'public.pay_group_generation_versions', 'DELETE') as auth_delete_generation_versions,
           has_table_privilege('authenticated', 'public.pay_periods', 'DELETE') as auth_delete_pay_periods`,
      )
    ).rows[0];

    expect(grants).toEqual({
      auth_execute: true,
      service_execute: false,
      anon_execute: false,
      auth_delete_generation_versions: false,
      auth_delete_pay_periods: false,
    });
  });
});
