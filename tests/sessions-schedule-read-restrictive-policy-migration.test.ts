// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260810190000_enforce_sessions_schedule_read_scope.sql",
);
const smokePath = path.join(
  process.cwd(),
  "tests",
  "sql",
  "employee_role_capability_smoke.sql",
);

describe("sessions schedule read restrictive policy migration", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const smokeSql = readFileSync(smokePath, "utf8");

  it("adds a restrictive SELECT policy using the shared schedule predicate", () => {
    expect(sql).toContain("CREATE POLICY sessions_schedule_read_scope");
    expect(sql).toContain("AS RESTRICTIVE");
    expect(sql).toContain("FOR SELECT");
    expect(sql).toContain("TO authenticated");
    expect(sql).toContain(
      "app.current_user_can_read_schedule_client(organization_id, client_id)",
    );
  });

  it("does not rewrite schedule write grants, helpers, or public RPCs", () => {
    expect(sql).not.toContain("CREATE POLICY org_write_sessions");
    expect(sql).not.toContain("current_user_can_manage_schedule");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION");
  });

  it("runtime-smokes assigned and unassigned therapist mutation visibility", () => {
    expect(smokeSql).toContain("therapist_assigned_session_update_allowed");
    expect(smokeSql).toContain("therapist_unassigned_session_update_denied");
  });

  it("documents a bounded rollback", () => {
    expect(sql).toContain(
      "DROP POLICY IF EXISTS sessions_schedule_read_scope ON public.sessions",
    );
  });
});
