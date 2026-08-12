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
  payGroupA: "90000000-0000-4000-8000-000000000002",
  payPeriodA: "90000000-0000-4000-8000-000000000003",
  policyA: "90000000-0000-4000-8000-000000000001",
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
         ($1::uuid, $2::uuid, 'time.approve_assigned', '2026-08-01T00:00:00Z', $2::uuid),
         ($1::uuid, $3::uuid, 'payroll.lock_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.reopen_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $3::uuid, 'payroll.resolve_exceptions', '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.managerA, IDS.adminA],
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
          ["2026-08-13", idempotencyKey],
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

const resolveBlocker = async (
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
          "select public.resolve_payroll_blocker($1::jsonb, $2::text) as result",
          [JSON.stringify(payload), idempotencyKey],
        )
      ).rows[0].result,
    true,
  );

const readLatestApproval = async (client: Client) =>
  (
    await client.query(
      `select action, snapshot_hash, payload_hash, comment, reason
       from public.timesheet_approvals
       where organization_id = $1::uuid
         and employment_profile_id = $2::uuid
         and pay_period_id = $3::uuid
       order by occurred_at desc, received_at desc, id desc
       limit 1`,
      [IDS.orgA, IDS.employmentA, IDS.payPeriodA],
    )
  ).rows[0];

const readLatestResolution = async (client: Client) =>
  (
    await client.query(
      `select action, previous_resolution_id, payload_hash
       from public.payroll_blocker_resolutions
       where organization_id = $1::uuid
       order by occurred_at desc, received_at desc, id desc
       limit 1`,
      [IDS.orgA],
    )
  ).rows[0];

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

const readPayPeriodProjection = async (client: Client) =>
  (
    await client.query(
      `select locked_at, exported_at
       from public.pay_periods
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.payPeriodA],
    )
  ).rows[0];

const countWorkflowRows = async (client: Client) =>
  (
    await client.query(
      `select
         (select count(*)::int from public.timesheet_approvals where organization_id = $1::uuid) as approvals,
         (select count(*)::int from public.payroll_blocker_resolutions where organization_id = $1::uuid) as resolutions,
         (select count(*)::int from public.payroll_mutation_receipts where organization_id = $1::uuid and operation in ('transition_timesheet_approval', 'resolve_payroll_blocker')) as receipts,
         (select count(*)::int from public.payroll_audit_events where organization_id = $1::uuid and operation in ('transition_timesheet_approval', 'resolve_payroll_blocker')) as audits`,
      [IDS.orgA],
    )
  ).rows[0];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasSafeLocalDatabase)("payroll approval workflow rpc runtime contract", () => {
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
    await insertTimeEvent(admin, "shift_started", "2026-08-11T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-11T20:00:00Z");
  });

  it("submits a current employee-owned lockable snapshot with canonical binding and idempotent replay", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-snapshot-submit");
    expect(snapshot).toMatchObject({
      snapshotId: expect.any(String),
      replayed: false,
      sourceHash: expect.any(String),
    });

    const snapshotRow = (
      await admin.query(
        `select canonical_snapshot_hash, snapshot_version, calculation_revision
         from public.timesheet_snapshots
         where organization_id = $1::uuid and id = $2::uuid`,
        [IDS.orgA, snapshot.snapshotId],
      )
    ).rows[0];
    expect(snapshotRow).toMatchObject({
      canonical_snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      snapshot_version: expect.any(Number),
      calculation_revision: expect.any(Number),
    });

    const first = await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshotRow.canonical_snapshot_hash,
        attestation: true,
      },
      "submit-approval-1",
      IDS.employeeA,
    );
    expect(first).toMatchObject({
      action: "submitted",
      replayed: false,
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshotRow.canonical_snapshot_hash,
    });

    const replay = await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshotRow.canonical_snapshot_hash,
        attestation: true,
      },
      "submit-approval-1",
      IDS.employeeA,
    );
    expect(replay).toMatchObject({
      action: "submitted",
      replayed: true,
      snapshotId: snapshot.snapshotId,
    });

    await expect(
      transitionApproval(
        admin,
        {
          action: "submit",
          snapshotId: snapshot.snapshotId,
          snapshotHash: snapshotRow.canonical_snapshot_hash,
          attestation: true,
          comment: "conflict",
        },
        "submit-approval-1",
        IDS.employeeA,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("requires the exact assigned non-self manager and a return comment", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-snapshot-manager");
    const snapshotHash = (
      await admin.query(
        `select canonical_snapshot_hash
         from public.timesheet_snapshots
         where organization_id = $1::uuid and id = $2::uuid`,
        [IDS.orgA, snapshot.snapshotId],
      )
    ).rows[0].canonical_snapshot_hash;

    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-for-manager",
      IDS.employeeA,
    );

    await expect(
      transitionApproval(
        admin,
        {
          action: "return",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "return-missing-comment",
        IDS.managerA,
      ),
    ).rejects.toThrow();

    const returned = await transitionApproval(
      admin,
      {
        action: "return",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        comment: "Fix the missing punch",
      },
      "return-with-comment",
      IDS.managerA,
    );
    expect(returned).toMatchObject({
      action: "returned",
      replayed: false,
    });

    await expect(
      transitionApproval(
        admin,
        {
          action: "manager_approve",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "self-approve",
        IDS.employeeA,
      ),
    ).rejects.toThrow();

    await expect(
      transitionApproval(
        admin,
        {
          action: "manager_approve",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "cross-tenant-approve",
        IDS.employeeB,
      ),
    ).rejects.toThrow();
  });

  it("rejects stale approval invalidation rewrites before authority checks with zero writes", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-stale-authority");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-before-unauthorized-stale",
      IDS.employeeA,
    );

    await insertTimeEvent(admin, "shift_started", "2026-08-12T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T20:00:00Z");
    await deriveSnapshot(admin, "approval-stale-authority-v2");

    for (const [action, payload] of [
      ["manager_approve", {}],
      ["return", { comment: "Not authorized" }],
      ["lock", {}],
    ] as const) {
      const before = await countWorkflowRows(admin);
      await expect(
        transitionApproval(
          admin,
          {
            action,
            snapshotId: snapshot.snapshotId,
            snapshotHash,
            ...payload,
          },
          `unauthorized-stale-${action}`,
          IDS.schedulerA,
        ),
      ).rejects.toThrow();
      expect(await countWorkflowRows(admin)).toEqual(before);
      expect((await readLatestApproval(admin)).action).toBe("submitted");
    }
  });

  it("invalidates stale submitted work when the current head changes before manager approval", async () => {
    const firstSnapshot = await deriveSnapshot(admin, "approval-snapshot-v1");
    const firstHash = await readSnapshotHash(admin, firstSnapshot.snapshotId);

    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: firstSnapshot.snapshotId,
        snapshotHash: firstHash,
        attestation: true,
      },
      "submit-before-drift",
      IDS.employeeA,
    );

    await insertTimeEvent(admin, "shift_started", "2026-08-12T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T20:00:00Z");
    const secondSnapshot = await deriveSnapshot(admin, "approval-snapshot-v2");
    expect(secondSnapshot.snapshotId).not.toBe(firstSnapshot.snapshotId);
    const secondHash = await readSnapshotHash(admin, secondSnapshot.snapshotId);

    const invalidated = await transitionApproval(
      admin,
      {
        action: "manager_approve",
        snapshotId: firstSnapshot.snapshotId,
        snapshotHash: firstHash,
      },
      "approve-after-drift",
      IDS.managerA,
    );
    expect(invalidated).toMatchObject({
      action: "approval_invalidated",
      replayed: false,
      snapshotId: firstSnapshot.snapshotId,
    });

    expect((await readLatestApproval(admin)).action).toBe("approval_invalidated");

    const recovered = await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: secondSnapshot.snapshotId,
        snapshotHash: secondHash,
        attestation: true,
      },
      "resubmit-after-invalidation",
      IDS.employeeA,
    );
    expect(recovered).toMatchObject({
      action: "submitted",
      snapshotId: secondSnapshot.snapshotId,
      replayed: false,
    });

    const approved = await transitionApproval(
      admin,
      {
        action: "manager_approve",
        snapshotId: secondSnapshot.snapshotId,
        snapshotHash: secondHash,
      },
      "approve-recovered-snapshot",
      IDS.managerA,
    );
    expect(approved).toMatchObject({
      action: "manager_approved",
      snapshotId: secondSnapshot.snapshotId,
      replayed: false,
    });
  });

  it("requires blocker resolution before payroll lock, preserves projection columns, and allows reopen with reason", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-snapshot-lock");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);

    const originalEventId = (
      await admin.query(
        `select id
         from public.employee_time_events
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by event_at asc, created_at asc, id asc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;
    await admin.query(
      `insert into public.time_correction_requests (
         organization_id, employment_profile_id, original_event_id, requested_by, reason_code, replacement_payload
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'missed_punch', '{}'::jsonb)`,
      [IDS.orgA, IDS.employmentA, originalEventId, IDS.employeeA],
    );

    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-for-lock",
      IDS.employeeA,
    );
    await transitionApproval(
      admin,
      {
        action: "manager_approve",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
      },
      "approve-for-lock",
      IDS.managerA,
    );
    expect(await readPayPeriodProjection(admin)).toEqual({
      locked_at: null,
      exported_at: null,
    });

    await expect(
      transitionApproval(
        admin,
        {
          action: "lock",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "lock-with-blocker",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    const blockerId = (
      await admin.query(
        `select id
         from public.time_correction_requests
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by created_at desc, id desc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;
    const resolution = await resolveBlocker(
      admin,
      {
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        blockerType: "time_correction_request",
        blockerId,
        payPeriodId: IDS.payPeriodA,
        action: "resolved",
      },
      "resolve-blocker-1",
      IDS.adminA,
    );
    expect(resolution).toMatchObject({
      action: "resolved",
      replayed: false,
    });

    const beforeLockProjection = await readPayPeriodProjection(admin);
    const locked = await transitionApproval(
      admin,
      {
        action: "lock",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
      },
      "lock-after-resolution",
      IDS.adminA,
    );
    expect(locked).toMatchObject({
      action: "locked",
      replayed: false,
    });
    expect(await readPayPeriodProjection(admin)).toEqual(beforeLockProjection);

    const lockState = (
      await admin.query(
        "select app.payroll_event_is_locked($1::uuid, $2::uuid, $3::timestamptz) as locked",
        [IDS.orgA, IDS.employmentA, "2026-08-11T17:00:00Z"],
      )
    ).rows[0].locked;
    expect(lockState).toBe(true);

    await expect(
      transitionApproval(
        admin,
        {
          action: "reopen",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "reopen-without-reason",
        IDS.adminA,
      ),
    ).rejects.toThrow();

    const reopened = await transitionApproval(
      admin,
      {
        action: "reopen",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        reason: "Adjustment required",
      },
      "reopen-with-reason",
      IDS.adminA,
    );
    expect(reopened).toMatchObject({
      action: "reopened",
      replayed: false,
    });
    expect(await readPayPeriodProjection(admin)).toEqual(beforeLockProjection);
  });

  it("keeps successful transitions atomic with one receipt and one audit event per mutation", async () => {
    const before = await countWorkflowRows(admin);
    const snapshot = await deriveSnapshot(admin, "approval-atomic");
    const snapshotHash = (
      await admin.query(
        `select canonical_snapshot_hash
         from public.timesheet_snapshots
         where organization_id = $1::uuid and id = $2::uuid`,
        [IDS.orgA, snapshot.snapshotId],
      )
    ).rows[0].canonical_snapshot_hash;

    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-atomic",
      IDS.employeeA,
    );

    expect(await countWorkflowRows(admin)).toEqual({
      approvals: before.approvals + 1,
      resolutions: before.resolutions,
      receipts: before.receipts + 1,
      audits: before.audits + 1,
    });
  });

  it("fails closed with zero writes when the feature flag is disabled for approval transitions", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-feature-disabled");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    await admin.query(
      `update public.organization_feature_flags
       set is_enabled = false
       where organization_id = $1::uuid
         and feature_flag_id = (
           select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
         )`,
      [IDS.orgA],
    );

    const before = await countWorkflowRows(admin);
    await expect(
      transitionApproval(
        admin,
        {
          action: "submit",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          attestation: true,
        },
        "submit-feature-disabled",
        IDS.employeeA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(before);
  });

  it("fails closed with zero writes for monthly California nonexempt approval transitions", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-monthly-ca");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    await admin.query(
      `update public.pay_groups
       set cadence = 'monthly'::public.pay_group_cadence
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.payGroupA],
    );

    const before = await countWorkflowRows(admin);
    await expect(
      transitionApproval(
        admin,
        {
          action: "submit",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          attestation: true,
        },
        "submit-monthly-ca",
        IDS.employeeA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(before);
  });

  it("rejects self lock and reopen even with admin membership and explicit payroll capability grants", async () => {
    const adminRoleId = (
      await admin.query(`select id from public.roles where name = 'admin' limit 1`)
    ).rows[0].id;
    await admin.query(
      `insert into public.user_roles (user_id, role_id, is_active)
       values ($1::uuid, $2::uuid, true)
       on conflict do nothing`,
      [IDS.employeeA, adminRoleId],
    );
    await admin.query(
      `insert into public.payroll_capability_grants (
         organization_id, user_id, capability, effective_from, granted_by
       ) values
         ($1::uuid, $2::uuid, 'payroll.lock_period', '2026-08-01T00:00:00Z', $3::uuid),
         ($1::uuid, $2::uuid, 'payroll.reopen_period', '2026-08-01T00:00:00Z', $3::uuid)`,
      [IDS.orgA, IDS.employeeA, IDS.adminA],
    );

    const snapshot = await deriveSnapshot(admin, "approval-self-lock");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-self-lock",
      IDS.employeeA,
    );
    await transitionApproval(
      admin,
      {
        action: "manager_approve",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
      },
      "approve-self-lock",
      IDS.managerA,
    );

    const beforeSelfLock = await countWorkflowRows(admin);
    await expect(
      transitionApproval(
        admin,
        {
          action: "lock",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
        },
        "self-lock-attempt",
        IDS.employeeA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(beforeSelfLock);

    await transitionApproval(
      admin,
      {
        action: "lock",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
      },
      "admin-lock-after-self-reject",
      IDS.adminA,
    );

    const beforeSelfReopen = await countWorkflowRows(admin);
    await expect(
      transitionApproval(
        admin,
        {
          action: "reopen",
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          reason: "Self reopen should fail",
        },
        "self-reopen-attempt",
        IDS.employeeA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(beforeSelfReopen);
  });

  it("enforces the blocker resolution graph and explicit replay/conflict semantics with zero-write duplicates", async () => {
    const snapshot = await deriveSnapshot(admin, "blocker-graph-snapshot");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    const originalEventId = (
      await admin.query(
        `select id
         from public.employee_time_events
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by event_at asc, created_at asc, id asc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;
    await admin.query(
      `insert into public.time_correction_requests (
         organization_id, employment_profile_id, original_event_id, requested_by, reason_code, replacement_payload
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'missed_punch', '{}'::jsonb)`,
      [IDS.orgA, IDS.employmentA, originalEventId, IDS.employeeA],
    );
    const blockerId = (
      await admin.query(
        `select id
         from public.time_correction_requests
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by created_at desc, id desc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;

    const beforeReopen = await countWorkflowRows(admin);
    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          blockerType: "time_correction_request",
          blockerId,
          payPeriodId: IDS.payPeriodA,
          action: "reopened",
          reason: "Cannot reopen before resolve",
        },
        "reopen-before-resolve",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(beforeReopen);

    const resolved = await resolveBlocker(
      admin,
      {
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        blockerType: "time_correction_request",
        blockerId,
        payPeriodId: IDS.payPeriodA,
        action: "resolved",
      },
      "resolve-blocker-graph",
      IDS.adminA,
    );
    expect(resolved).toMatchObject({ action: "resolved", replayed: false });

    const resolvedReplay = await resolveBlocker(
      admin,
      {
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        blockerType: "time_correction_request",
        blockerId,
        payPeriodId: IDS.payPeriodA,
        action: "resolved",
      },
      "resolve-blocker-graph",
      IDS.adminA,
    );
    expect(resolvedReplay).toMatchObject({ action: "resolved", replayed: true });

    const afterReplay = await countWorkflowRows(admin);
    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          blockerType: "time_correction_request",
          blockerId,
          payPeriodId: IDS.payPeriodA,
          action: "resolved",
          comment: "changed payload",
        },
        "resolve-blocker-graph",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect(await countWorkflowRows(admin)).toEqual(afterReplay);

    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          blockerType: "time_correction_request",
          blockerId,
          payPeriodId: IDS.payPeriodA,
          action: "resolved",
        },
        "resolve-blocker-duplicate",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(afterReplay);

    const reopened = await resolveBlocker(
      admin,
      {
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        blockerType: "time_correction_request",
        blockerId,
        payPeriodId: IDS.payPeriodA,
        action: "reopened",
        reason: "Needs further work",
      },
      "reopen-blocker-graph",
      IDS.adminA,
    );
    expect(reopened).toMatchObject({ action: "reopened", replayed: false });

    const afterReopen = await countWorkflowRows(admin);
    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: snapshot.snapshotId,
          snapshotHash,
          blockerType: "time_correction_request",
          blockerId,
          payPeriodId: IDS.payPeriodA,
          action: "reopened",
          reason: "duplicate reopen",
        },
        "reopen-blocker-duplicate",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(afterReopen);

    const resolvedAgain = await resolveBlocker(
      admin,
      {
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        blockerType: "time_correction_request",
        blockerId,
        payPeriodId: IDS.payPeriodA,
        action: "resolved",
      },
      "resolve-blocker-after-reopen",
      IDS.adminA,
    );
    expect(resolvedAgain).toMatchObject({ action: "resolved", replayed: false });
    expect((await readLatestResolution(admin)).action).toBe("resolved");
  });

  it("rejects mismatched or superseded blocker snapshots with zero writes and binds idempotency replay to the snapshot payload", async () => {
    const firstSnapshot = await deriveSnapshot(admin, "blocker-snapshot-bind-v1");
    const firstHash = await readSnapshotHash(admin, firstSnapshot.snapshotId);
    await insertTimeEvent(admin, "shift_started", "2026-08-12T16:00:00Z");
    await insertTimeEvent(admin, "shift_ended", "2026-08-12T20:00:00Z");
    const secondSnapshot = await deriveSnapshot(admin, "blocker-snapshot-bind-v2");
    const secondHash = await readSnapshotHash(admin, secondSnapshot.snapshotId);
    expect(secondSnapshot.snapshotId).not.toBe(firstSnapshot.snapshotId);
    const originalEventId = (
      await admin.query(
        `select id
         from public.employee_time_events
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by event_at asc, created_at asc, id asc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;
    await admin.query(
      `insert into public.time_correction_requests (
         organization_id, employment_profile_id, original_event_id, requested_by, reason_code, replacement_payload
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'missed_punch', '{}'::jsonb)`,
      [IDS.orgA, IDS.employmentA, originalEventId, IDS.employeeA],
    );
    const blockerId = (
      await admin.query(
        `select id
         from public.time_correction_requests
         where organization_id = $1::uuid and employment_profile_id = $2::uuid
         order by created_at desc, id desc
         limit 1`,
        [IDS.orgA, IDS.employmentA],
      )
    ).rows[0].id;

    const beforeMismatch = await countWorkflowRows(admin);
    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: secondSnapshot.snapshotId,
          snapshotHash: "f".repeat(64),
          blockerType: "time_correction_request",
          blockerId,
          action: "resolved",
        },
        "resolve-blocker-mismatch",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(beforeMismatch);

    const resolved = await resolveBlocker(
      admin,
      {
        snapshotId: secondSnapshot.snapshotId,
        snapshotHash: secondHash,
        blockerType: "time_correction_request",
        blockerId,
        action: "resolved",
      },
      "resolve-blocker-snapshot-bind",
      IDS.adminA,
    );
    expect(resolved).toMatchObject({ action: "resolved", replayed: false });

    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: firstSnapshot.snapshotId,
          snapshotHash: firstHash,
          blockerType: "time_correction_request",
          blockerId,
          action: "resolved",
        },
        "resolve-blocker-snapshot-bind",
        IDS.adminA,
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const beforeStale = await countWorkflowRows(admin);
    await expect(
      resolveBlocker(
        admin,
        {
          snapshotId: firstSnapshot.snapshotId,
          snapshotHash: firstHash,
          blockerType: "time_correction_request",
          blockerId,
          action: "reopened",
          reason: "Attempted with superseded snapshot",
        },
        "resolve-blocker-stale-snapshot",
        IDS.adminA,
      ),
    ).rejects.toThrow();
    expect(await countWorkflowRows(admin)).toEqual(beforeStale);
  });

  it("keeps exported pay periods locked before Task 5 export authority arrives", async () => {
    await admin.query(
      `update public.pay_periods
       set exported_at = '2026-08-15T12:00:00Z'::timestamptz
       where organization_id = $1::uuid
         and id = $2::uuid`,
      [IDS.orgA, IDS.payPeriodA],
    );

    const lockState = (
      await admin.query(
        "select app.payroll_event_is_locked($1::uuid, $2::uuid, $3::timestamptz) as locked",
        [IDS.orgA, IDS.employmentA, "2026-08-11T17:00:00Z"],
      )
    ).rows[0].locked;
    expect(lockState).toBe(true);
  });

  it("repairs preexisting snapshot canonical hashes through the migration-safe trigger window and restores append-only enforcement", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-upgrade-backfill");
    const initialHash = await readSnapshotHash(admin, snapshot.snapshotId);

    await admin.query("begin");
    try {
      await admin.query("set local session_replication_role = replica");
      await admin.query(
        `update public.timesheet_snapshots
         set canonical_snapshot_hash = $1
         where organization_id = $2::uuid
           and id = $3::uuid`,
        ["0".repeat(64), IDS.orgA, snapshot.snapshotId],
      );
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }

    await admin.query("begin");
    try {
      await admin.query("alter table public.timesheet_snapshots disable trigger timesheet_snapshots_append_only");
      await admin.query(
        `update public.timesheet_snapshots snapshot_row
         set canonical_snapshot_hash = app.payroll_hash_payload(
               app.timesheet_snapshot_canonical_binding_payload(
                 snapshot_row.snapshot_version,
                 snapshot_row.calculation_revision,
                 snapshot_row.canonical_payload,
                 snapshot_row.regular_seconds,
                 snapshot_row.overtime_seconds,
                 snapshot_row.double_time_seconds,
                 snapshot_row.meal_premium_cents,
                 snapshot_row.gross_earnings_cents
               )
             )
         where snapshot_row.organization_id = $1::uuid
           and snapshot_row.id = $2::uuid`,
        [IDS.orgA, snapshot.snapshotId],
      );
      await admin.query("alter table public.timesheet_snapshots enable trigger timesheet_snapshots_append_only");
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }

    expect(await readSnapshotHash(admin, snapshot.snapshotId)).toBe(initialHash);

    await expect(
      admin.query(
        `update public.timesheet_snapshots
         set canonical_snapshot_hash = $1
         where organization_id = $2::uuid
           and id = $3::uuid`,
        ["f".repeat(64), IDS.orgA, snapshot.snapshotId],
      ),
    ).rejects.toThrow();
  });

  it("serializes same-chain approval attempts so exactly one winner writes one receipt and one audit", async () => {
    const snapshot = await deriveSnapshot(admin, "approval-concurrent-chain");
    const snapshotHash = await readSnapshotHash(admin, snapshot.snapshotId);
    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: snapshot.snapshotId,
        snapshotHash,
        attestation: true,
      },
      "submit-concurrent-chain",
      IDS.employeeA,
    );

    const before = await countWorkflowRows(admin);
    const approveClient = await connect();
    const returnClient = await connect();
    try {
      const results = await Promise.allSettled([
        transitionApproval(
          approveClient,
          {
            action: "manager_approve",
            snapshotId: snapshot.snapshotId,
            snapshotHash,
          },
          "concurrent-manager-approve",
          IDS.managerA,
        ),
        transitionApproval(
          returnClient,
          {
            action: "return",
            snapshotId: snapshot.snapshotId,
            snapshotHash,
            comment: "Concurrent review return",
          },
          "concurrent-manager-return",
          IDS.managerA,
        ),
      ]);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<{ action: string }> => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(["manager_approved", "returned"]).toContain(fulfilled[0].value.action);
    } finally {
      await approveClient.end();
      await returnClient.end();
    }

    expect(await countWorkflowRows(admin)).toEqual({
      approvals: before.approvals + 1,
      resolutions: before.resolutions,
      receipts: before.receipts + 1,
      audits: before.audits + 1,
    });
  });

  it("serializes stale approval freshness against the derivation lock so new heads deterministically invalidate the loser", async () => {
    const firstSnapshot = await deriveSnapshot(admin, "approval-freshness-race-v1");
    const firstHash = await readSnapshotHash(admin, firstSnapshot.snapshotId);
    await transitionApproval(
      admin,
      {
        action: "submit",
        snapshotId: firstSnapshot.snapshotId,
        snapshotHash: firstHash,
        attestation: true,
      },
      "submit-before-freshness-race",
      IDS.employeeA,
    );

    const locker = await connect();
    const approver = await connect();
    try {
      await locker.query("begin");
      await locker.query("select app.payroll_timesheet_derivation_lock($1::uuid)", [IDS.orgA]);

      let settled = false;
      const approvePromise = transitionApproval(
        approver,
        {
          action: "manager_approve",
          snapshotId: firstSnapshot.snapshotId,
          snapshotHash: firstHash,
        },
        "approve-during-freshness-race",
        IDS.managerA,
      ).finally(() => {
        settled = true;
      });

      await delay(100);
      expect(settled).toBe(false);

      await insertTimeEvent(locker, "shift_started", "2026-08-12T16:00:00Z");
      await insertTimeEvent(locker, "shift_ended", "2026-08-12T20:00:00Z");
      await setRoleContext(locker, "authenticated", IDS.employeeA);
      const derived = (
        await locker.query(
          "select public.derive_timesheet_snapshot($1::date, $2::text) as result",
          ["2026-08-13", "derive-during-freshness-race"],
        )
      ).rows[0].result;
      await locker.query("commit");

      expect(derived.snapshotId).not.toBe(firstSnapshot.snapshotId);
      expect(
        await approvePromise,
      ).toMatchObject({
        action: "approval_invalidated",
        snapshotId: firstSnapshot.snapshotId,
        replayed: false,
      });
    } finally {
      try {
        await locker.query("rollback");
      } catch {}
      await locker.end();
      await approver.end();
    }

    expect((await readLatestApproval(admin)).action).toBe("approval_invalidated");
  });
});
