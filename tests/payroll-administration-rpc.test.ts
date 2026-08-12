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
