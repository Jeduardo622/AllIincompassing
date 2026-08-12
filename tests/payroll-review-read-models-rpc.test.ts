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
  managerB: "10000000-0000-4000-8000-000000000016",
  linkOnlyA: "10000000-0000-4000-8000-000000000017",
  employmentA: "10000000-0000-4000-8000-000000000041",
  employmentB: "10000000-0000-4000-8000-000000000042",
  payGroupA: "90000000-0000-4000-8000-000000000002",
  payPeriodA: "90000000-0000-4000-8000-000000000003",
} as const;

const selectedLocalDate = "2026-08-13";
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
  IDS.managerB,
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
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
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
         ($1::uuid, $2::uuid, 'time.review_assigned', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $4::uuid, 'time.review_assigned', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.lock_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.resolve_exceptions', '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.managerA, IDS.adminA, IDS.managerB],
    );
    await client.query(
      `insert into public.pay_groups (id, organization_id, name, cadence, timezone)
       values ($1::uuid, $2::uuid, 'Weekly Payroll', 'weekly', 'America/Los_Angeles')`,
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
    await client.query(
      `delete from public.employee_manager_assignments
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid`,
      [IDS.orgA, IDS.employmentA],
    );
    await client.query(
      `insert into public.employee_manager_assignments (
         organization_id, employment_profile_id, manager_user_id, effective_from
       ) values ($1::uuid, $2::uuid, $3::uuid, '2026-08-01T00:00:00Z'::timestamptz)`,
      [IDS.orgA, IDS.employmentA, IDS.managerA],
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
  actorUserId = IDS.employeeA,
) => {
  await client.query(
    `insert into public.employee_time_events (
       organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location
     ) values ($1::uuid, $2::uuid, $3::public.payroll_event_type, $4::timestamptz, $5::uuid, 'America/Los_Angeles', 'office')`,
    [IDS.orgA, IDS.employmentA, eventType, eventAt, actorUserId],
  );
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
          [selectedLocalDate, idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

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

const getSelfApproval = async (client: Client, userId: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_self_approval($1::date) as result",
          [selectedLocalDate],
        )
      ).rows[0].result,
  );

const getReviewQueue = async (client: Client, userId: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_review_queue($1::date) as result",
          [selectedLocalDate],
        )
      ).rows[0].result,
  );

const getReviewDetails = async (client: Client, userId: string, snapshotId: string, snapshotHash: string) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.get_payroll_review_details($1::uuid, $2::text) as result",
          [snapshotId, snapshotHash],
        )
      ).rows[0].result,
  );

const getSnapshotHash = async (client: Client, snapshotId: string) =>
  (
    await client.query(
      `select canonical_snapshot_hash
       from public.timesheet_snapshots
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, snapshotId],
    )
  ).rows[0].canonical_snapshot_hash as string;

const seedSubmittedSnapshot = async (client: Client) => {
  await insertTimeEvent(client, "shift_started", "2026-08-11T16:00:00Z");
  await insertTimeEvent(client, "shift_ended", "2026-08-11T20:00:00Z");
  const snapshot = await deriveSnapshot(client, "review-read-model-snapshot");
  const snapshotHash = await getSnapshotHash(client, snapshot.snapshotId as string);
  await transitionApproval(
    client,
    {
      action: "submit",
      snapshotId: snapshot.snapshotId,
      snapshotHash,
      attestation: true,
    },
    "review-read-model-submit",
    IDS.employeeA,
  );
  return {
    snapshotId: snapshot.snapshotId as string,
    snapshotHash,
  };
};

describe.skipIf(!hasSafeLocalDatabase)("payroll review read models rpc runtime contract", () => {
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

  it("returns self approval state to the employee only and fails closed for feature-disabled or unsupported monthly policy states", async () => {
    const seeded = await seedSubmittedSnapshot(admin);

    const selfApproval = await getSelfApproval(admin, IDS.employeeA);
    expect(selfApproval).toMatchObject({
      state: "ok",
      approval: {
        currentState: "submitted",
        snapshot: {
          id: seeded.snapshotId,
          hash: seeded.snapshotHash,
          isCurrent: true,
        },
      },
    });
    expect(JSON.stringify(selfApproval)).not.toContain("hourlyRateCents");
    expect(JSON.stringify(selfApproval)).not.toContain("otherEmployee");

    await expect(getSelfApproval(admin, IDS.managerA)).resolves.toMatchObject({
      state: expect.stringMatching(/no_employment_profile|missing_prerequisite/),
    });
    await expect(getSelfApproval(admin, IDS.linkOnlyA)).rejects.toThrow(/time\.view_self capability is required/i);

    await admin.query(
      `update public.organization_feature_flags
       set is_enabled = false
       where organization_id = $1::uuid
         and feature_flag_id = (
           select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
         )`,
      [IDS.orgA],
    );
    await expect(getSelfApproval(admin, IDS.employeeA)).resolves.toMatchObject({
      state: "feature_disabled",
    });

    await admin.query(
      `update public.organization_feature_flags
       set is_enabled = true
       where organization_id = $1::uuid
         and feature_flag_id = (
           select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
         )`,
      [IDS.orgA],
    );
    await admin.query(
      `update public.pay_groups
       set cadence = 'monthly'::public.pay_group_cadence
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.payGroupA],
    );
    await expect(getSelfApproval(admin, IDS.employeeA)).resolves.toMatchObject({
      state: "unsupported_policy",
    });
  });

  it("uses current exact manager assignment for queue and details and hides compensation until an explicit grant exists", async () => {
    const seeded = await seedSubmittedSnapshot(admin);

    const managerQueue = await getReviewQueue(admin, IDS.managerA);
    expect(managerQueue).toMatchObject({
      state: "ok",
      queue: [
        expect.objectContaining({
          state: "submitted",
          snapshot: {
            id: seeded.snapshotId,
            hash: seeded.snapshotHash,
          },
        }),
      ],
    });

    const managerDetails = await getReviewDetails(admin, IDS.managerA, seeded.snapshotId, seeded.snapshotHash);
    expect(managerDetails).toMatchObject({
      state: "ok",
      snapshotId: seeded.snapshotId,
      snapshotHash: seeded.snapshotHash,
    });
    expect(managerDetails.compensation).toBeUndefined();
    expect(JSON.stringify(managerDetails)).not.toContain("hourlyRateCents");
    expect(JSON.stringify(managerDetails)).not.toContain("canonicalPayload");
    expect(JSON.stringify(managerDetails)).not.toContain("sessionId");
    expect(JSON.stringify(managerDetails)).not.toContain("clientId");

    await admin.query(
      `insert into public.payroll_capability_grants (
         organization_id, user_id, capability, effective_from, granted_by
       ) values ($1::uuid, $2::uuid, 'payroll.view_compensation', '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.managerA, IDS.adminA],
    );

    await expect(getReviewDetails(admin, IDS.managerA, seeded.snapshotId, seeded.snapshotHash)).resolves.toMatchObject({
      state: "ok",
      compensation: expect.any(Object),
    });

    await admin.query(
      `update public.employee_manager_assignments
       set effective_through = pg_catalog.now() - interval '1 second'
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid
         and manager_user_id = $3::uuid`,
      [IDS.orgA, IDS.employmentA, IDS.managerA],
    );
    await admin.query(
      `insert into public.employee_manager_assignments (
         organization_id, employment_profile_id, manager_user_id, effective_from
       ) values ($1::uuid, $2::uuid, $3::uuid, pg_catalog.now() - interval '1 second')`,
      [IDS.orgA, IDS.employmentA, IDS.managerB],
    );

    await expect(getReviewQueue(admin, IDS.managerA)).rejects.toThrow();
    await expect(getReviewDetails(admin, IDS.managerA, seeded.snapshotId, seeded.snapshotHash)).rejects.toThrow();
    await expect(getReviewQueue(admin, IDS.managerB)).resolves.toMatchObject({
      state: "ok",
      queue: [
        expect.objectContaining({
          snapshot: expect.objectContaining({
            id: seeded.snapshotId,
          }),
        }),
      ],
    });
  });

  it("requires explicit payroll-admin grants for org-wide review access and rejects stale snapshot bindings", async () => {
    const adminRoleId = (
      await admin.query(`select id from public.roles where name = 'admin' limit 1`)
    ).rows[0].id;
    await admin.query(
      `insert into public.user_roles (user_id, role_id, is_active)
       values ($1::uuid, $2::uuid, true)
       on conflict do nothing`,
      [IDS.schedulerA, adminRoleId],
    );

    const seeded = await seedSubmittedSnapshot(admin);

    await expect(getReviewQueue(admin, IDS.schedulerA)).rejects.toThrow();
    await expect(getReviewDetails(admin, IDS.schedulerA, seeded.snapshotId, seeded.snapshotHash)).rejects.toThrow();

    const adminQueue = await getReviewQueue(admin, IDS.adminA);
    expect(adminQueue).toMatchObject({
      state: "ok",
      queue: [
        expect.objectContaining({
          snapshot: expect.objectContaining({
            id: seeded.snapshotId,
          }),
        }),
      ],
    });

    await insertTimeEvent(admin, "shift_started", "2026-08-12T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T20:00:00Z");
    await deriveSnapshot(admin, "review-read-model-snapshot-v2");

    await expect(getReviewDetails(admin, IDS.adminA, seeded.snapshotId, seeded.snapshotHash)).rejects.toThrow();
  });
});
