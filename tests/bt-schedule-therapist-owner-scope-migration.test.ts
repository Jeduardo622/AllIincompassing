// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260812160246_restrict_bt_schedule_to_linked_therapist.sql",
);
const deepLinkMigrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260812170000_restrict_schedule_deep_link_to_linked_therapist.sql",
);
const schedulePagePath = path.join(process.cwd(), "src", "pages", "Schedule.tsx");
const smokePath = path.join(
  process.cwd(),
  "tests",
  "sql",
  "employee_role_capability_smoke.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const deepLinkSql = readFileSync(deepLinkMigrationPath, "utf8");
const schedulePage = readFileSync(schedulePagePath, "utf8");
const smokeSql = readFileSync(smokePath, "utf8");

const extractFunction = (name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = sql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? "";
};

describe("BT schedule therapist-owner scope migration", () => {
  it("requires scoped schedule rows to match the caller therapist identity", () => {
    const helper = extractFunction("app.current_user_can_read_schedule_session");
    const normalizedHelper = helper.replace(/\s+/g, " ");

    expect(normalizedHelper).toContain(
      "app.current_user_can_read_full_schedule(target_organization_id)",
    );
    expect(normalizedHelper).toContain("ARRAY['bt', 'therapist']::text[]");
    expect(normalizedHelper).toContain(
      "app.current_user_has_active_schedule_client( target_organization_id, target_client_id )",
    );
    expect(normalizedHelper).toContain(
      "target_therapist_id IS NOT DISTINCT FROM app.current_therapist_id()",
    );
  });

  it.each([
    "public.get_sessions_optimized",
    "public.get_schedule_data_batch",
  ])("scopes %s by client and therapist ownership", (name) => {
    const functionSql = extractFunction(name);

    expect(functionSql).toContain(
      "app.current_user_can_read_schedule_session(v_org, s.client_id, s.therapist_id)",
    );
    expect(functionSql).not.toContain(
      "app.current_user_can_read_schedule_client(v_org, s.client_id)",
    );
  });

  it("preserves direct assigned-client session RLS for clinical reads", () => {
    expect(sql).not.toContain("CREATE POLICY org_read_sessions");
    expect(sql).not.toContain("CREATE POLICY sessions_schedule_read_scope");
    expect(sql).not.toContain("DROP POLICY");
  });

  it("restricts helper and scheduling RPC execution", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid) TO authenticated, service_role;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM PUBLIC, anon;",
    );
  });

  it("adds synthetic matching and foreign therapist probes", () => {
    expect(smokeSql).toContain("bt_schedule_matching_therapist_allowed");
    expect(smokeSql).toContain("bt_schedule_foreign_therapist_denied");
    expect(smokeSql).toContain("therapist_schedule_matching_therapist_allowed");
    expect(smokeSql).toContain("therapist_schedule_foreign_therapist_denied");
    expect(smokeSql).toContain("admin_schedule_full_schedule_session_allowed");
    expect(smokeSql).toContain("admin_schedule_full_schedule_rpc_rows_preserved");
    expect(smokeSql).toContain("00000000-0000-4000-8000-000000000507");
  });

  it("documents a bounded rollback", () => {
    expect(sql).toContain(
      "DROP FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid)",
    );
  });

  it("routes schedule deep-link lookups through the therapist-owned predicate", () => {
    expect(deepLinkSql).toContain(
      "CREATE OR REPLACE FUNCTION public.get_schedule_session_by_id(p_session_id uuid)",
    );
    expect(deepLinkSql).toContain(
      "app.current_user_can_read_schedule_session(v_org, s.client_id, s.therapist_id)",
    );
    expect(deepLinkSql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_schedule_session_by_id(uuid) FROM PUBLIC, anon;",
    );
    expect(schedulePage).toContain('.rpc("get_schedule_session_by_id"');
    expect(schedulePage).not.toContain('.from("sessions")\n        .select("*")');
    expect(smokeSql).toContain("therapist_schedule_deep_link_scope");
    expect(smokeSql).toContain("bt_schedule_deep_link_scope");
  });
});
