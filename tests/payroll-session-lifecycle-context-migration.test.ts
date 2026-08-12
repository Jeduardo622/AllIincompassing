import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPayrollSessionAttendancePayload } from "../src/features/payroll/api";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const baseMigrationName = "20260812103000_payroll_session_lifecycle_context.sql";
const additiveMigrationName =
  "20260812113000_payroll_session_lifecycle_context_disabled_state.sql";
const baseMigrationPath = path.join(migrationsDir, baseMigrationName);
const additiveMigrationPath = path.join(migrationsDir, additiveMigrationName);
const baseMigrationExists = existsSync(baseMigrationPath);
const additiveMigrationExists = existsSync(additiveMigrationPath);
const baseMigrationSql = baseMigrationExists
  ? readFileSync(baseMigrationPath, "utf8")
  : "";
const additiveMigrationSql = additiveMigrationExists
  ? readFileSync(additiveMigrationPath, "utf8")
  : "";
const effectiveSql = `${baseMigrationSql}\n${additiveMigrationSql}`;

const functionDefinition = (qualifiedName: string): string => {
  const matches = effectiveSql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "gi",
    ),
  );
  return matches?.at(-1) ?? "";
};

const IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000011",
  userB: "10000000-0000-4000-8000-000000000012",
  schedulerA: "10000000-0000-4000-8000-000000000013",
  managerA: "10000000-0000-4000-8000-000000000014",
  payrollAdminA: "10000000-0000-4000-8000-000000000015",
  priorEmployeeA: "10000000-0000-4000-8000-000000000016",
  linkOnlyA: "10000000-0000-4000-8000-000000000017",
  sessionA: "10000000-0000-4000-8000-000000000031",
  sessionB: "10000000-0000-4000-8000-000000000032",
  employmentA: "10000000-0000-4000-8000-000000000041",
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

const assertPgError = async (
  callback: () => Promise<unknown>,
  pattern: RegExp,
) => {
  await expect(callback()).rejects.toMatchObject({
    message: expect.stringMatching(pattern),
  });
};

describe("payroll session lifecycle context migration contract", () => {
  it("keeps the governed base migration and adds one additive disabled-state override", () => {
    expect(baseMigrationExists).toBe(true);
    expect(additiveMigrationExists).toBe(true);
    expect(additiveMigrationSql).toMatch(
      /@migration-dependencies:\s*20260812103000_payroll_session_lifecycle_context\.sql/i,
    );
    expect(additiveMigrationSql).toMatch(
      /@migration-rollback:.*get_session_payroll_context/i,
    );
  });

  it("overrides session payroll context with the exact disabled-or-ok union and fail-closed gating", () => {
    const definition = functionDefinition("public.get_session_payroll_context");
    expect(definition).toMatch(/returns jsonb/i);
    expect(definition).toMatch(/stable/i);
    expect(definition).toMatch(/security definer/i);
    expect(definition).toMatch(/set search_path = ''/i);
    expect(definition).toMatch(/auth\.uid\(\)/i);
    expect(definition).toMatch(/app\.resolve_user_organization_id/i);
    expect(definition).toMatch(/session_attendance\.record_assigned/i);
    expect(definition).toMatch(/time\.clock_self/i);
    expect(definition).toMatch(/from public\.feature_flags flag/i);
    expect(definition).toMatch(/left join public\.organization_feature_flags org_override/i);
    expect(definition).toMatch(/payroll timekeeping feature flag is not configured/i);
    expect(definition).not.toMatch(/app\.payroll_feature_enabled/i);
    expect(definition).toMatch(/'state',\s*'feature_disabled'/i);
    expect(definition).toMatch(/'sessionId',\s*v_session\.id/i);
    expect(definition).toMatch(/'organizationId',\s*v_actor_org/i);
    expect(definition).toMatch(/'state',\s*'ok'/i);
    expect(definition).toMatch(/'employmentProfileId',\s*v_employment\.id/i);
    expect(definition).toMatch(/'employmentTimezone',\s*v_employment\.timezone/i);
    expect(definition).toMatch(/'actorIsAssignedEmployee',\s*v_actor_is_assigned_employee/i);
    expect(definition).toMatch(/'canClockSelf',\s*v_can_clock_self/i);
    expect(definition).toMatch(/'canonicalWorkLocation',\s*v_canonical_work_location/i);
    expect(definition).toMatch(/'activeShiftEventId',\s*v_active_shift\.id/i);
    expect(definition).toMatch(/unsupported payroll jurisdiction/i);
    expect(definition).toMatch(/active payroll policy is required/i);
    expect(definition).toMatch(
      /session assignment must resolve to exactly one active payroll employment profile/i,
    );
    expect(definition).toMatch(/session attendance actor is out of scope/i);
    expect(additiveMigrationSql).toMatch(
      /revoke all on function public\.get_session_payroll_context\(uuid\) from public, anon, authenticated/i,
    );
    expect(additiveMigrationSql).toMatch(
      /revoke all on function public\.get_session_payroll_context\(uuid\) from service_role/i,
    );
    expect(additiveMigrationSql).toMatch(
      /grant execute on function public\.get_session_payroll_context\(uuid\) to authenticated/i,
    );
  });

  it("keeps attendance mutation fail-closed and server-derived instead of returning a disabled union", () => {
    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).not.toMatch(/'state',\s*'feature_disabled'/i);
    expect(definition).toMatch(/app\.payroll_feature_enabled\(v_actor_org,\s*v_employment\.home_jurisdiction,\s*null\)/i);
    expect(definition).toMatch(/raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled'/i);
    expect(definition).not.toMatch(/public\.get_session_payroll_context/i);
    expect(baseMigrationSql).toMatch(
      /revoke all on function public\.record_session_attendance_event\(jsonb, text\) from public, anon, authenticated/i,
    );
    expect(baseMigrationSql).toMatch(
      /revoke all on function public\.record_session_attendance_event\(jsonb, text\) from service_role/i,
    );
    expect(baseMigrationSql).toMatch(
      /grant execute on function public\.record_session_attendance_event\(jsonb, text\) to authenticated/i,
    );
    expect(baseMigrationSql).not.toMatch(
      /grant execute on function public\.record_session_attendance_event\(jsonb, text\) to service_role/i,
    );
  });
});

describe.skipIf(!hasSafeLocalDatabase)(
  "payroll session lifecycle context runtime contract",
  () => {
    let admin: Client;

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
    ): Promise<T> => {
      await client.query("begin");
      try {
        await client.query(`set local role ${role}`);
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({
            role,
            sub: userId,
          }),
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
        await client.query(
          "delete from public.user_therapist_links where user_id = any($1::uuid[])",
          [[
            IDS.userA,
            IDS.userB,
            IDS.schedulerA,
            IDS.managerA,
            IDS.payrollAdminA,
            IDS.priorEmployeeA,
            IDS.linkOnlyA,
          ]],
        );
        for (const table of [
          "timekeeping_exceptions",
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
          "payroll_organization_settings",
          "organization_feature_flags",
          "employment_profiles",
          "sessions",
          "clients",
          "therapists",
        ]) {
          await client.query(
            `delete from public.${table} where organization_id = any($1::uuid[])`,
            [[IDS.orgA, IDS.orgB]],
          );
        }
        await client.query(
          "delete from public.user_roles where user_id = any($1::uuid[])",
          [[
            IDS.userA,
            IDS.userB,
            IDS.schedulerA,
            IDS.managerA,
            IDS.payrollAdminA,
            IDS.priorEmployeeA,
            IDS.linkOnlyA,
          ]],
        );
        await client.query(
          "delete from public.profiles where id = any($1::uuid[])",
          [[
            IDS.userA,
            IDS.userB,
            IDS.schedulerA,
            IDS.managerA,
            IDS.payrollAdminA,
            IDS.priorEmployeeA,
            IDS.linkOnlyA,
          ]],
        );
        await client.query(
          "delete from auth.users where id = any($1::uuid[])",
          [[
            IDS.userA,
            IDS.userB,
            IDS.schedulerA,
            IDS.managerA,
            IDS.payrollAdminA,
            IDS.priorEmployeeA,
            IDS.linkOnlyA,
          ]],
        );
        await client.query(
          "delete from public.organizations where id = any($1::uuid[])",
          [[IDS.orgA, IDS.orgB]],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    };

    const seed = async () => {
      await cleanup(admin);
      await admin.query(readFileSync(smokePath, "utf8"));
    };

    const getSessionPayrollContext = async (userId: string, sessionId: string) =>
      withRole(
        admin,
        "authenticated",
        userId,
        async () =>
          (
            await admin.query(
              "select public.get_session_payroll_context($1::uuid) as result",
              [sessionId],
            )
          ).rows[0].result,
      );

    const recordAttendance = async (
      userId: string,
      sessionId: string,
      key: string,
      commit = false,
    ) =>
      withRole(
        admin,
        "authenticated",
        userId,
        async () =>
          (
            await admin.query(
              "select public.record_session_attendance_event($1::jsonb, $2::text) as result",
              [
                buildPayrollSessionAttendancePayload({
                  occurredAt: "2026-08-11T16:05:00Z",
                  eventType: "session_started",
                  sessionId,
                }),
                key,
              ],
            )
          ).rows[0].result,
        commit,
      );

    const recordShiftStart = async (userId: string, key: string) =>
      withRole(
        admin,
        "authenticated",
        userId,
        async () =>
          (
            await admin.query(
              "select public.record_employee_time_event($1::jsonb, $2::text) as result",
              [
                {
                  occurredAt: "2026-08-11T16:00:00Z",
                  timezone: "America/Los_Angeles",
                  workLocation: "community",
                  data: { eventType: "shift_started" },
                },
                key,
              ],
            )
          ).rows[0].result,
        true,
      );

    beforeAll(async () => {
      admin = await connect();
    });

    afterAll(async () => {
      if (!admin) {
        return;
      }
      try {
        await cleanup(admin);
      } finally {
        await admin.end();
      }
    });

    it("returns feature_disabled only after the scoped session and authority gates succeed", async () => {
      await seed();

      const result = await getSessionPayrollContext(IDS.userA, IDS.sessionA);

      expect(result).toEqual({
        state: "feature_disabled",
        sessionId: IDS.sessionA,
        organizationId: IDS.orgA,
      });
      expect(Object.keys(result).sort()).toEqual([
        "organizationId",
        "sessionId",
        "state",
      ]);
    });

    it("returns ok with the exact resolved authority fields when the flag is enabled and policy is active", async () => {
      await seed();
      await admin.query(
        "update public.organization_feature_flags set is_enabled = true where organization_id = $1",
        [IDS.orgA],
      );

      const result = await getSessionPayrollContext(IDS.userA, IDS.sessionA);

      expect(result).toEqual({
        state: "ok",
        sessionId: IDS.sessionA,
        organizationId: IDS.orgA,
        employmentProfileId: IDS.employmentA,
        employmentTimezone: "America/Los_Angeles",
        actorIsAssignedEmployee: true,
        canClockSelf: true,
        canonicalWorkLocation: "office",
        activeShiftEventId: null,
      });
      expect(Object.keys(result).sort()).toEqual([
        "activeShiftEventId",
        "actorIsAssignedEmployee",
        "canClockSelf",
        "canonicalWorkLocation",
        "employmentProfileId",
        "employmentTimezone",
        "organizationId",
        "sessionId",
        "state",
      ]);
    });

    it("fails closed when the payroll feature flag definition is missing", async () => {
      await seed();
      await admin.query("begin");
      try {
        await admin.query("set local session_replication_role = replica");
        await admin.query(
          "delete from public.feature_flags where flag_key = 'payroll_timekeeping_v1'",
        );
        await admin.query("set local role authenticated");
        await admin.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
        await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [IDS.userA]);
        await expect(
          admin.query(
            "select public.get_session_payroll_context($1::uuid) as result",
            [IDS.sessionA],
          ),
        ).rejects.toMatchObject({
          message: expect.stringMatching(/feature flag is not configured/i),
        });
      } finally {
        await admin.query("rollback");
      }
    });

    it("fails closed for unauthenticated, unauthorized, out-of-scope, ambiguous, no-employment, unsupported-jurisdiction, and missing-policy cases", async () => {
      await seed();

      await expect(
        admin.query(
          "select public.get_session_payroll_context($1::uuid) as result",
          [IDS.sessionA],
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/authentication required/i),
      });

      await assertPgError(
        () => getSessionPayrollContext(IDS.linkOnlyA, IDS.sessionA),
        /session attendance actor is out of scope/i,
      );
      await assertPgError(
        () => getSessionPayrollContext(IDS.userA, IDS.sessionB),
        /session is out of scope/i,
      );

      await admin.query(
        `insert into public.employment_profiles (
          organization_id,
          user_id,
          employee_number,
          payroll_employee_id,
          classification,
          home_jurisdiction,
          timezone,
          active_from,
          therapist_id
        ) values ($1, $2, 'SYN-A-AMBIG', 'PAY-A-AMBIG', 'nonexempt', 'CA', 'America/Los_Angeles', '2026-08-01', $3)`,
        [IDS.orgA, IDS.schedulerA, IDS.userA],
      );
      await assertPgError(
        () => getSessionPayrollContext(IDS.userA, IDS.sessionA),
        /exactly one active payroll employment profile/i,
      );
      await admin.query(
        "delete from public.employment_profiles where organization_id = $1 and employee_number = 'SYN-A-AMBIG'",
        [IDS.orgA],
      );

      await admin.query(
        "update public.employment_profiles set active_from = '2026-09-01', active_through = null where id = $1",
        [IDS.employmentA],
      );
      await assertPgError(
        () => getSessionPayrollContext(IDS.userA, IDS.sessionA),
        /exactly one active payroll employment profile/i,
      );

      await seed();
      await admin.query(
        "update public.organization_feature_flags set is_enabled = true where organization_id = $1",
        [IDS.orgA],
      );
      await admin.query(
        "update public.employment_profiles set home_jurisdiction = 'TX' where id = $1",
        [IDS.employmentA],
      );
      await assertPgError(
        () => getSessionPayrollContext(IDS.userA, IDS.sessionA),
        /unsupported payroll jurisdiction/i,
      );

      await seed();
      await admin.query(
        "update public.organization_feature_flags set is_enabled = true where organization_id = $1",
        [IDS.orgA],
      );
      await admin.query(
        "update public.payroll_policy_versions set activation_status = 'inactive' where organization_id = $1",
        [IDS.orgA],
      );
      await assertPgError(
        () => getSessionPayrollContext(IDS.userA, IDS.sessionA),
        /active payroll policy is required/i,
      );
    });

    it("keeps attendance mutation denied when the feature flag is disabled", async () => {
      await seed();

      await assertPgError(
        () => recordAttendance(IDS.userA, IDS.sessionA, "disabled-attendance"),
        /payroll timekeeping feature is disabled/i,
      );
    });

    it("records the production minimal payload with server-derived shift, timezone, and work location", async () => {
      await seed();
      await admin.query(
        "update public.organization_feature_flags set is_enabled = true where organization_id = $1",
        [IDS.orgA],
      );

      const shift = await recordShiftStart(IDS.userA, "derived-shift-start");
      const attendance = await recordAttendance(
        IDS.userA,
        IDS.sessionA,
        "derived-session-attendance",
        true,
      );

      expect(attendance).toMatchObject({
        operation: "record_session_attendance_event",
        replayed: false,
        employee_time_event_id: shift.event_id,
        exception_id: null,
        source_timezone: "America/Los_Angeles",
        work_location: "community",
      });
      const persisted = (
        await admin.query(
          `select organization_id, employment_profile_id, session_id,
                  employee_time_event_id, source_timezone, work_location
             from public.session_attendance_events
            where id = $1::uuid`,
          [attendance.event_id],
        )
      ).rows[0];
      expect(persisted).toEqual({
        organization_id: IDS.orgA,
        employment_profile_id: IDS.employmentA,
        session_id: IDS.sessionA,
        employee_time_event_id: shift.event_id,
        source_timezone: "America/Los_Angeles",
        work_location: "community",
      });
    });
  },
);
