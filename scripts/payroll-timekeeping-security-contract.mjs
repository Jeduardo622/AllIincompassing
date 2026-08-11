import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Client } from "pg";

const databaseUrl = process.env.PAYROLL_LOCAL_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "BLOCKED: local payroll smoke execution requires PAYROLL_LOCAL_DATABASE_URL.",
  );
  process.exit(1);
}

const parsedDatabaseUrl = new URL(databaseUrl);
const isExactLocalDatabase =
  parsedDatabaseUrl.protocol === "postgresql:" &&
  parsedDatabaseUrl.hostname === "127.0.0.1" &&
  parsedDatabaseUrl.port === "54322" &&
  parsedDatabaseUrl.pathname === "/postgres" &&
  parsedDatabaseUrl.username === "postgres";
if (!isExactLocalDatabase) {
  console.error(
    "BLOCKED: payroll security contract requires the exact local Supabase loopback database.",
  );
  process.exit(1);
}

const smokePath = path.join(
  process.cwd(),
  "tests",
  "sql",
  "payroll_timekeeping_foundation_smoke.sql",
);
if (!existsSync(smokePath)) {
  throw new Error("Missing payroll smoke SQL file.");
}

const IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000011",
  userB: "10000000-0000-4000-8000-000000000012",
  schedulerA: "10000000-0000-4000-8000-000000000013",
  managerA: "10000000-0000-4000-8000-000000000014",
  payrollAdminA: "10000000-0000-4000-8000-000000000015",
  clientA: "10000000-0000-4000-8000-000000000021",
  clientB: "10000000-0000-4000-8000-000000000022",
  sessionA: "10000000-0000-4000-8000-000000000031",
  sessionB: "10000000-0000-4000-8000-000000000032",
  delegatedSessionA: "10000000-0000-4000-8000-000000000033",
  employmentA: "10000000-0000-4000-8000-000000000041",
  employmentB: "10000000-0000-4000-8000-000000000042",
  employmentAHistorical: "10000000-0000-4000-8000-000000000043",
  employmentManagerLocked: "10000000-0000-4000-8000-000000000044",
  weeklyGroup: "10000000-0000-4000-8000-000000000051",
  biweeklyGroup: "10000000-0000-4000-8000-000000000053",
  monthlyGroup: "10000000-0000-4000-8000-000000000052",
  lockedPeriod: "10000000-0000-4000-8000-000000000061",
  unlockedBiweeklyPeriod: "10000000-0000-4000-8000-000000000062",
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const connect = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
};

const withRole = async (client, role, userId, callback, commit = false) => {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role }),
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

const expectReject = async (callback, pattern, label) => {
  try {
    await callback();
  } catch (error) {
    assert(
      pattern.test(`${error?.code ?? ""} ${error?.message ?? error}`),
      `${label}: unexpected error ${error?.code ?? ""} ${error?.message ?? error}`,
    );
    return;
  }
  throw new Error(`${label}: expected rejection`);
};

const cleanup = async (client) => {
  await client.query("begin");
  try {
    await client.query("set local session_replication_role = replica");
    const organizations = [IDS.orgA, IDS.orgB];
    const users = [
      IDS.userA,
      IDS.userB,
      IDS.schedulerA,
      IDS.managerA,
      IDS.payrollAdminA,
    ];
    for (const table of [
      "session_attendance_correction_requests",
      "time_correction_requests",
      "session_attendance_events",
      "employee_time_events",
      "payroll_audit_events",
      "payroll_mutation_receipts",
      "pay_periods",
      "pay_group_assignments",
      "pay_groups",
      "employee_rate_versions",
      "employee_manager_assignments",
      "payroll_capability_grants",
      "payroll_policy_versions",
      "organization_feature_flags",
      "employment_profiles",
      "sessions",
      "clients",
      "therapists",
    ]) {
      await client.query(
        `delete from public.${table} where organization_id = any($1::uuid[])`,
        [organizations],
      );
    }
    for (const [table, column] of [
      ["public.user_roles", "user_id"],
      ["public.profiles", "id"],
      ["auth.users", "id"],
    ]) {
      await client.query(
        `delete from ${table} where ${column} = any($1::uuid[])`,
        [users],
      );
    }
    await client.query(
      "delete from public.organizations where id = any($1::uuid[])",
      [organizations],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const setFeature = async (client, enabled) => {
  await client.query(
    `update public.organization_feature_flags
     set is_enabled = $1, updated_at = now()
     where organization_id = any($2::uuid[])`,
    [enabled, [IDS.orgA, IDS.orgB]],
  );
};

const timePayload = (eventType, occurredAt, extra = {}) => ({
  occurredAt,
  timezone: "America/Los_Angeles",
  workLocation: "office",
  data: { eventType, ...extra },
});

const attendancePayload = (eventType, occurredAt, sessionId = IDS.sessionA) => ({
  occurredAt,
  timezone: "America/Los_Angeles",
  workLocation: "client_site",
  data: { eventType, sessionId },
});

const recordTime = (client, userId, payload, key, commit = true) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.record_employee_time_event($1::jsonb, $2::text) as result",
          [payload, key],
        )
      ).rows[0].result,
    commit,
  );

const recordAttendance = (client, userId, payload, key, commit = true) =>
  withRole(
    client,
    "authenticated",
    userId,
    async () =>
      (
        await client.query(
          "select public.record_session_attendance_event($1::jsonb, $2::text) as result",
          [payload, key],
        )
      ).rows[0].result,
    commit,
  );

const main = async () => {
  const admin = await connect();
  try {
    await cleanup(admin);
    await admin.query(readFileSync(smokePath, "utf8"));

    const signatures = await admin.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[
          'record_employee_time_event',
          'record_session_attendance_event',
          'request_time_correction',
          'request_session_attendance_correction'
        ])
      order by p.proname
    `);
    assert(signatures.rowCount === 4, "Expected exactly four payroll mutation RPCs.");
    assert(
      signatures.rows.every((row) => row.args === "event_payload jsonb, idempotency_key text" || row.args === "correction_payload jsonb, idempotency_key text"),
      "Payroll RPC signatures drifted from the stable jsonb/text contract.",
    );
    for (const row of signatures.rows) {
      const signature = `public.${row.proname}(jsonb,text)`;
      const privileges = await admin.query(
        `select
           has_function_privilege('anon', $1, 'execute') as anon,
           has_function_privilege('authenticated', $1, 'execute') as authenticated,
           has_function_privilege('service_role', $1, 'execute') as service_role`,
        [signature],
      );
      assert(!privileges.rows[0].anon, `${signature} is executable by anon.`);
      assert(privileges.rows[0].authenticated, `${signature} is not executable by authenticated.`);
      assert(privileges.rows[0].service_role, `${signature} is not executable by service_role.`);
    }

    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_started", "2026-08-11T16:00:00Z"), "disabled-start"),
      /42501|feature is disabled/i,
      "feature-disabled time event",
    );
    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_started", "2026-08-11T16:05:00Z"), "disabled-attendance"),
      /42501|feature is disabled/i,
      "feature-disabled attendance event",
    );
    await setFeature(admin, true);

    await admin.query(
      `insert into public.pay_groups (id, organization_id, name, cadence, timezone)
       values ($1, $2, 'Weekly Locked', 'weekly', 'America/Los_Angeles'),
              ($3, $2, 'Monthly Rejected', 'monthly', 'America/Los_Angeles'),
              ($4, $2, 'Biweekly Unlocked', 'biweekly', 'America/Los_Angeles')`,
      [IDS.weeklyGroup, IDS.orgA, IDS.monthlyGroup, IDS.biweeklyGroup],
    );
    await admin.query(
      `insert into public.pay_group_assignments
        (organization_id, employment_profile_id, pay_group_id, effective_from, effective_through)
       values
        ($1, $2, $3, '2026-01-01', null),
        ($1, $4, $5, '2026-07-01', null)`,
      [
        IDS.orgA,
        IDS.employmentManagerLocked,
        IDS.weeklyGroup,
        IDS.employmentA,
        IDS.biweeklyGroup,
      ],
    );
    await admin.query(
      `insert into public.pay_periods (id, organization_id, pay_group_id, starts_on, ends_on, locked_at)
       values ($1, $2, $3, '2026-08-11', '2026-08-17', now())`,
      [IDS.lockedPeriod, IDS.orgA, IDS.weeklyGroup],
    );
    await admin.query(
      `insert into public.pay_periods (id, organization_id, pay_group_id, starts_on, ends_on)
       values ($1, $2, $3, '2026-08-11', '2026-08-24')`,
      [IDS.unlockedBiweeklyPeriod, IDS.orgA, IDS.biweeklyGroup],
    );

    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_ended", "2026-08-11T15:55:00Z"), "end-before-start"),
      /23514|open shift/i,
      "shift end before start",
    );
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("meal_started", "2026-08-11T15:56:00Z"), "meal-before-shift"),
      /23514|open shift/i,
      "meal outside shift",
    );

    const orgBHistorical = await recordTime(
      admin,
      IDS.userB,
      timePayload("shift_started", "2026-06-15T16:00:00Z"),
      "org-b-historical-start",
    );
    assert(orgBHistorical.event_id, "Historical Org-B source event was not created.");
    const orgBHistoricalRead = await withRole(admin, "authenticated", IDS.userB, async () =>
      (
        await admin.query(
          "select count(*)::int as count from public.employee_time_events where employment_profile_id = $1",
          [IDS.employmentB],
        )
      ).rows[0].count,
    );
    assert(orgBHistoricalRead === 1, "Historical own-event read incorrectly requires current employment.");

    const startPayload = timePayload("shift_started", "2026-08-11T16:00:00Z");
    const first = await recordTime(admin, IDS.userA, startPayload, "same-key-replay");
    const replay = await recordTime(admin, IDS.userA, startPayload, "same-key-replay");
    assert(first.event_id === replay.event_id, "Same-key replay created a second event.");
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_started", "2026-08-11T16:01:00Z"), "same-key-replay"),
      /23505|IDEMPOTENCY_CONFLICT/i,
      "different-payload idempotency collision",
    );
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_started", "2026-08-11T16:02:00Z"), "duplicate-start"),
      /23514|duplicate shift start/i,
      "duplicate shift start",
    );
    await recordTime(admin, IDS.userA, timePayload("meal_started", "2026-08-11T18:00:00Z"), "meal-start");
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("meal_started", "2026-08-11T18:01:00Z"), "overlap-meal"),
      /23514|overlaps/i,
      "overlapping meal",
    );
    await recordTime(admin, IDS.userA, timePayload("meal_ended", "2026-08-11T18:30:00Z"), "meal-end");
    await recordTime(admin, IDS.userA, timePayload("shift_ended", "2026-08-11T23:00:00Z"), "shift-end");
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_started", "2026-08-11T23:00:00Z"), "equal-time-chronology"),
      /23514|latest confirmed employee time event/i,
      "equal-time employee chronology guard",
    );
    await expectReject(
      () => recordTime(admin, IDS.userA, timePayload("shift_started", "2026-08-11T22:00:00Z"), "backdated-time-event"),
      /23514|latest confirmed employee time event/i,
      "backdated employee event",
    );

    const seededOrgBCount = await admin.query(
      "select count(*)::int as count from public.employee_time_events where organization_id = $1",
      [IDS.orgB],
    );
    assert(seededOrgBCount.rows[0].count === 1, "Org-B source fixture is missing.");
    const crossTenantCount = await withRole(admin, "authenticated", IDS.userA, async () =>
      (
        await admin.query(
          "select count(*)::int as count from public.employee_time_events where organization_id = $1",
          [IDS.orgB],
        )
      ).rows[0].count,
    );
    assert(crossTenantCount === 0, "Cross-tenant event read was not denied by RLS.");
    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_started", "2026-06-15T16:05:00Z", IDS.sessionB), "cross-session"),
      /42501|assigned|scope/i,
      "cross-tenant session attendance",
    );

    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_ended", "2026-08-11T16:05:00Z"), "attendance-end-first"),
      /23514|started session/i,
      "attendance end before start",
    );
    const attendanceStart = await recordAttendance(
      admin,
      IDS.userA,
      attendancePayload("session_started", "2026-08-11T16:10:00Z"),
      "attendance-start",
    );
    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_started", "2026-08-11T16:11:00Z"), "attendance-duplicate"),
      /23514|duplicate session start/i,
      "duplicate attendance start",
    );
    await recordAttendance(
      admin,
      IDS.userA,
      attendancePayload("session_ended", "2026-08-11T18:10:00Z"),
      "attendance-end",
    );
    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_started", "2026-08-11T18:10:00Z"), "equal-attendance-chronology"),
      /23514|latest confirmed session attendance event/i,
      "equal-time attendance chronology guard",
    );
    await expectReject(
      () => recordAttendance(admin, IDS.userA, attendancePayload("session_started", "2026-08-11T17:00:00Z"), "backdated-attendance"),
      /23514|latest confirmed session attendance event/i,
      "backdated attendance event",
    );

    await expectReject(
      () => recordAttendance(
        admin,
        IDS.managerA,
        attendancePayload(
          "session_started",
          "2026-08-11T18:30:00Z",
          IDS.delegatedSessionA,
        ),
        "delegated-attendance-bcba-denied",
      ),
      /42501|session_attendance\.record_assigned|assigned|capability/i,
      "same-org non-scheduler delegated attendance denied",
    );
    const delegatedHistoricalAttendanceStart = await recordAttendance(
      admin,
      IDS.schedulerA,
      attendancePayload(
        "session_started",
        "2026-06-15T19:00:00Z",
        IDS.delegatedSessionA,
      ),
      "delegated-historical-attendance-start",
    );
    await recordAttendance(
      admin,
      IDS.schedulerA,
      attendancePayload(
        "session_ended",
        "2026-06-15T20:00:00Z",
        IDS.delegatedSessionA,
      ),
      "delegated-historical-attendance-end",
    );
    const delegatedHistoricalEmployment = await admin.query(
      "select employment_profile_id from public.session_attendance_events where id = $1",
      [delegatedHistoricalAttendanceStart.event_id],
    );
    assert(
      delegatedHistoricalEmployment.rows[0]?.employment_profile_id ===
        IDS.employmentAHistorical,
      "Historical delegated attendance did not bind to the event-time employment row.",
    );

    const timeCountBeforeDelegatedAttendance = await admin.query(
      "select count(*)::int as count from public.employee_time_events where organization_id = $1",
      [IDS.orgA],
    );
    await recordAttendance(
      admin,
      IDS.schedulerA,
      attendancePayload(
        "session_started",
        "2026-08-11T19:00:00Z",
        IDS.delegatedSessionA,
      ),
      "delegated-attendance-start",
    );
    await recordAttendance(
      admin,
      IDS.schedulerA,
      attendancePayload(
        "session_ended",
        "2026-08-11T20:00:00Z",
        IDS.delegatedSessionA,
      ),
      "delegated-attendance-end",
    );
    const timeCountAfterDelegatedAttendance = await admin.query(
      "select count(*)::int as count from public.employee_time_events where organization_id = $1",
      [IDS.orgA],
    );
    assert(
      timeCountAfterDelegatedAttendance.rows[0].count ===
        timeCountBeforeDelegatedAttendance.rows[0].count,
      "Delegated attendance mutated payroll time events.",
    );

    const managerScope = await withRole(admin, "authenticated", IDS.managerA, async () => {
      const events = await admin.query(
        "select count(*)::int as count from public.employee_time_events where employment_profile_id = $1",
        [IDS.employmentA],
      );
      const rates = await admin.query(
        "select count(*)::int as count from public.employee_rate_versions where employment_profile_id = $1",
        [IDS.employmentA],
      );
      return { events: events.rows[0].count, rates: rates.rows[0].count };
    });
    assert(managerScope.events > 0, "Assigned manager cannot read employee events.");
    assert(managerScope.rates === 0, "Assigned manager can read employee rates.");

    const adminRatesBeforeGrant = await withRole(admin, "authenticated", IDS.payrollAdminA, async () =>
      (
        await admin.query(
          "select count(*)::int as count from public.employee_rate_versions where employment_profile_id = $1",
          [IDS.employmentA],
        )
      ).rows[0].count,
    );
    assert(adminRatesBeforeGrant === 0, "Payroll admin received compensation access without a grant.");
    await admin.query(
      `insert into public.payroll_capability_grants
        (organization_id, user_id, capability, granted_by)
       values ($1, $2, 'payroll.view_compensation', $2)`,
      [IDS.orgA, IDS.payrollAdminA],
    );
    const adminRatesAfterGrant = await withRole(admin, "authenticated", IDS.payrollAdminA, async () =>
      (
        await admin.query(
        "select count(*)::int as count from public.employee_rate_versions where employment_profile_id = $1",
        [IDS.employmentA],
        )
      ).rows[0].count,
    );
    assert(adminRatesAfterGrant === 1, "Granted payroll admin cannot read compensation.");

    const correction = await withRole(admin, "authenticated", IDS.userA, async () =>
      (
        await admin.query(
          "select public.request_time_correction($1::jsonb, $2::text) as result",
          [{ data: { originalEventId: first.event_id, reasonCode: "missed_punch", replacementPayload: { occurredAt: "2026-08-11T16:05:00Z" } } }, "locked-correction"],
        )
      ).rows[0].result,
      true,
    );
    assert(correction.request_id, "Locked-history correction request was not appended.");
    const historicalCorrection = await withRole(admin, "authenticated", IDS.userB, async () =>
      (
        await admin.query(
          "select public.request_time_correction($1::jsonb, $2::text) as result",
          [{ data: { originalEventId: orgBHistorical.event_id, reasonCode: "historical_adjustment" } }, "historical-correction"],
        )
      ).rows[0].result,
      true,
    );
    assert(
      historicalCorrection.request_id,
      "Historical correction after employment rollover/termination was not appended.",
    );
    const attendanceCorrection = await withRole(admin, "authenticated", IDS.userA, async () =>
      (
        await admin.query(
          "select public.request_session_attendance_correction($1::jsonb, $2::text) as result",
          [{ data: { sessionAttendanceEventId: delegatedHistoricalAttendanceStart.event_id, reasonCode: "audit_adjustment", replacementPayload: { occurredAt: "2026-06-15T19:15:00Z" } } }, "attendance-correction"],
        )
      ).rows[0].result,
      true,
    );
    assert(attendanceCorrection.request_id, "Attendance correction was not appended.");

    await setFeature(admin, false);
    await expectReject(
      () => withRole(admin, "authenticated", IDS.userA, () => admin.query(
        "select public.request_time_correction($1::jsonb, $2::text)",
        [{ data: { originalEventId: first.event_id, reasonCode: "disabled" } }, "disabled-correction"],
      ), true),
      /42501|feature is disabled/i,
      "feature-disabled correction",
    );
    await expectReject(
      () => withRole(admin, "authenticated", IDS.userA, () => admin.query(
        "select public.request_session_attendance_correction($1::jsonb, $2::text)",
        [{ data: { sessionAttendanceEventId: delegatedHistoricalAttendanceStart.event_id, reasonCode: "disabled" } }, "disabled-attendance-correction"],
      ), true),
      /42501|feature is disabled/i,
      "feature-disabled attendance correction",
    );
    await setFeature(admin, true);

    await expectReject(
      () => withRole(admin, "authenticated", IDS.userA, () => admin.query(
        `insert into public.employee_time_events
          (organization_id, employment_profile_id, event_type, event_at, actor_user_id, source_timezone, work_location)
         values ($1, $2, 'shift_started', now(), $3, 'UTC', 'office')`,
        [IDS.orgA, IDS.employmentA, IDS.userA],
      ), true),
      /42501|permission denied|row-level security/i,
      "authenticated direct source insert",
    );
    await expectReject(
      () => withRole(admin, "service_role", IDS.userA, () => admin.query(
        "update public.employee_time_events set source_note = 'tamper' where id = $1",
        [first.event_id],
      ), true),
      /42501|permission denied|append-only/i,
      "service-role source mutation",
    );
    await expectReject(
      () => admin.query(
        "update public.employee_time_events set source_note = 'tamper' where id = $1",
        [first.event_id],
      ),
      /42501|append-only/i,
      "owner append-only trigger",
    );
    await expectReject(
      () => admin.query(
        `insert into public.pay_group_assignments
          (organization_id, employment_profile_id, pay_group_id, effective_from)
         values ($1, $2, $3, current_date)`,
        [IDS.orgA, IDS.employmentA, IDS.monthlyGroup],
      ),
      /23514|Monthly pay groups are inactive/i,
      "monthly nonexempt assignment",
    );

    const concurrentA = await connect();
    const concurrentB = await connect();
    try {
      const sameKeyPayload = timePayload("shift_started", "2026-08-18T16:00:00Z");
      const sameKeySettled = await Promise.allSettled([
        recordTime(concurrentA, IDS.userA, sameKeyPayload, "concurrent-same-key"),
        recordTime(concurrentB, IDS.userA, sameKeyPayload, "concurrent-same-key"),
      ]);
      assert(
        sameKeySettled.every((entry) => entry.status === "fulfilled"),
        "Concurrent same-key replay did not allow both callers to succeed.",
      );
      const sameKeyIds = sameKeySettled.map((entry) => entry.value.event_id);
      assert(
        sameKeyIds[0] === sameKeyIds[1],
        "Concurrent same-key replay did not return the same event id.",
      );
      await recordTime(
        admin,
        IDS.userA,
        timePayload("shift_ended", "2026-08-18T23:00:00Z"),
        "concurrent-same-key-end",
      );

      const payload = timePayload("shift_started", "2026-08-19T16:00:00Z");
      const settled = await Promise.allSettled([
        recordTime(concurrentA, IDS.userA, payload, "concurrent-start-a"),
        recordTime(concurrentB, IDS.userA, payload, "concurrent-start-b"),
      ]);
      assert(
        settled.filter((entry) => entry.status === "fulfilled").length === 1 &&
          settled.filter((entry) => entry.status === "rejected").length === 1,
        "Concurrent duplicate starts did not serialize to one success and one rejection.",
      );
      const rejected = settled.find((entry) => entry.status === "rejected");
      assert(
        /23514|duplicate shift start|latest confirmed event/i.test(
          `${rejected?.reason?.code ?? ""} ${rejected?.reason?.message ?? ""}`,
        ),
        "Concurrent duplicate start failed for an unexpected reason.",
      );
    } finally {
      await concurrentA.end();
      await concurrentB.end();
    }

    console.log("Payroll timekeeping security contract passed (synthetic local database). ");
  } finally {
    try {
      await cleanup(admin);
    } finally {
      await admin.end();
    }
  }
};

await main();
